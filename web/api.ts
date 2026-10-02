/** The page's HTTP client. Whatever the server answers, a failure is an `ApiError` with a readable message. */
import type { SettingsError } from "../src/shared";

export class ApiError extends Error {
	constructor(
		message: string,
		/** The file changed on disk since the page read it. */
		readonly conflict = false,
	) {
		super(message);
	}
}

/** The JSON body of a successful response. A body that is not JSON, from a proxy or an older server, reports its status and text. */
export async function readJson<T>(response: Response): Promise<T> {
	const text = await response.text();
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
		throw new ApiError(text.trim() ? `${status}: ${text.trim().slice(0, 200)}` : status);
	}
	if (!response.ok) {
		const { error, conflict } = body as Partial<SettingsError>;
		throw new ApiError(typeof error === "string" ? error : `HTTP ${response.status}`, conflict === true);
	}
	return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	return readJson<T>(await fetch(url, { signal }));
}

export async function putJson<T>(url: string, body: unknown): Promise<T> {
	return readJson<T>(
		await fetch(url, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}
