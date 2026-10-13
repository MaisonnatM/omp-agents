/**
 * Bearer-token calls to a service's JSON API. Who holds the token, and what a refused one means, is the caller's:
 * `mcpBearer` in `omp/mcp.ts` supplies omp's sign-in, and `integrationFetch` in `integrations.ts` the one for an integration.
 */
import { isObject, str } from "./json";

const TIMEOUT_MS = 20_000;

/** A server or API answered HTTP `status`, other than a refused sign-in, with its own error message when it gave one. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

/** A POST of `body` as JSON, or a DELETE, for a {@link SignedFetch}. */
export type ApiWrite = { method: "POST"; body: unknown } | { method: "DELETE" };

/**
 * Calls an API address with a sign-in: reads its JSON, or with `init` posts its body as JSON or deletes it, and reads
 * the answer, `null` when empty, such as a 204. A 401 throws the {@link Bearer}'s `refused` error, and another failure an
 * {@link ApiError} with the answer's status and the API's `error.message`.
 */
export type SignedFetch = (url: string, init?: ApiWrite) => Promise<unknown>;

/** The token a {@link SignedFetch} sends, and the error a 401 to it throws once its holder has forgotten it. */
export interface Bearer {
	token: string;
	refused: () => Error;
}

/** `init` as a request with `headers` added: a POST sends its body as JSON, and a DELETE sends nothing. */
function requestOf(init: ApiWrite, headers: Record<string, string>): RequestInit {
	switch (init.method) {
		case "POST":
			return { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(init.body) };
		case "DELETE":
			return { method: "DELETE", headers };
		default: {
			const never: never = init;
			return never;
		}
	}
}

/** The {@link SignedFetch} that signs each call with the {@link Bearer} `bearer` answers then. */
export const signedFetch =
	(bearer: () => Promise<Bearer>): SignedFetch =>
	async (url, init) => {
		const { token, refused } = await bearer();
		const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
		const call: RequestInit = init ? requestOf(init, headers) : { headers };
		const response = await fetch(url, { ...call, signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (response.status === 401) throw refused();
		const text = await response.text();
		const host = new URL(url).host;
		if (response.ok) {
			if (!text) return null;
			try {
				return JSON.parse(text);
			} catch {
				throw new Error(`${host}'s API answered something other than JSON: ${text.slice(0, 200)}`);
			}
		}
		let message: string | undefined;
		try {
			const parsed: unknown = JSON.parse(text);
			message = isObject(parsed) && isObject(parsed.error) ? str(parsed.error.message) : undefined;
		} catch {}
		throw new ApiError(message ?? `${host} answered HTTP ${response.status}`, response.status);
	};
