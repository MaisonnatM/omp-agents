/** The settings page's requests. Whatever the server answers, a failure is a `SettingsRequestError` with a readable message. */
import type { CatalogModel, FileEdit, OmpSettings, RoutingEdit, SettingsError } from "../src/shared";

export class SettingsRequestError extends Error {
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
		throw new SettingsRequestError(text.trim() ? `${status}: ${text.trim().slice(0, 200)}` : status);
	}
	if (!response.ok) {
		const { error, conflict } = body as Partial<SettingsError>;
		throw new SettingsRequestError(typeof error === "string" ? error : `HTTP ${response.status}`, conflict === true);
	}
	return body as T;
}

const query = (cwd: string | null): string => (cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`);

export const loadSettings = async (cwd: string | null, signal: AbortSignal): Promise<OmpSettings> =>
	readJson<OmpSettings>(await fetch(`/api/settings${query(cwd)}`, { signal }));

export const loadModels = async (): Promise<CatalogModel[]> => (await readJson<{ models: CatalogModel[] }>(await fetch("/api/models"))).models;

async function put(path: string, cwd: string | null, body: RoutingEdit | FileEdit): Promise<OmpSettings> {
	const response = await fetch(`${path}${query(cwd)}`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return readJson<OmpSettings>(response);
}

/** Each save answers with the settings as they load afterwards. */
export const saveRouting = (cwd: string | null, edit: RoutingEdit): Promise<OmpSettings> => put("/api/settings/routing", cwd, edit);
export const saveFile = (cwd: string | null, edit: FileEdit): Promise<OmpSettings> => put("/api/settings/file", cwd, edit);
