/**
 * The page's HTTP client. Whatever the server answers, a failure is an `ApiError` with a readable message. Every request
 * carries the access token that the sign-in page kept in localStorage; a 401 signs the page out.
 */
import { MEDIA_KEY_PARAM, MEDIA_KEY_STORAGE_KEY, SOCKET_PROTOCOL, SOCKET_TOKEN_PREFIX, TOKEN_STORAGE_KEY } from "../src/shared/access";
import type { BranchRelease } from "../src/shared/git";
import { isObject } from "../src/json";
import type { WorktreeConfirmation, WorktreeInventory, WorktreeMetrics, WorktreeRemovalPlan, WorktreeRemovalRequest, WorktreeRemovalResult, WorktreeTarget } from "../src/worktrees-shared";
import { record } from "./activity";

export class ApiError extends Error {
	constructor(
		message: string,
		/** The file changed on disk since the page read it. */
		readonly conflict = false,
	) {
		super(message);
	}
}

/** What localStorage keeps under `key`, `null` where there is no localStorage, as in tests. */
const stored = (key: string): string | null => globalThis.localStorage?.getItem(key) ?? null;

const signOutListeners = new Set<() => void>();
let signedOut = typeof window !== "undefined" && stored(TOKEN_STORAGE_KEY) === null;

/** Whether the page holds no token the server takes: none was stored, or the server answered 401. */
export const isSignedOut = (): boolean => signedOut;

/** Calls `listener` when the page signs out; answers the unsubscribe, as `useSyncExternalStore` takes it. */
export function onSignOut(listener: () => void): () => void {
	signOutListeners.add(listener);
	return () => signOutListeners.delete(listener);
}

/** Forgets a token the server refused, so a reload shows the sign-in screen too. */
function signOut(): void {
	if (signedOut) return;
	signedOut = true;
	globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
	globalThis.localStorage?.removeItem(MEDIA_KEY_STORAGE_KEY);
	for (const listener of signOutListeners) listener();
}

/** `fetch` with the access token, which signs the page out when the server refuses it. A write counts as the user's action, keyed by its route. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
	if (init.method !== undefined && init.method !== "GET") record("action", `${init.method.toLowerCase()} ${url.split("?", 1)[0]}`);
	const token = stored(TOKEN_STORAGE_KEY);
	const headers = new Headers(init.headers);
	if (token !== null) headers.set("authorization", `Bearer ${token}`);
	const response = await fetch(url, { ...init, headers });
	if (response.status === 401) signOut();
	return response;
}

/**
 * A socket to this server at `path`, `wss:` when the page loaded over https, so a TLS proxy serves the sockets as it
 * serves `fetch`. A browser's socket sends no header, so the token rides as the subprotocol `bearer.<token>`.
 */
export function openSocket(path: string): WebSocket {
	const token = stored(TOKEN_STORAGE_KEY);
	const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${path}`;
	return new WebSocket(url, token === null ? [SOCKET_PROTOCOL] : [SOCKET_PROTOCOL, `${SOCKET_TOKEN_PREFIX}${token}`]);
}

/** `src` as an image, a video, or a frame loads it: one of this server's routes carries the media key, since a tag sends no header. */
export function mediaSrc(src: string): string {
	const key = src.startsWith("/api/") ? stored(MEDIA_KEY_STORAGE_KEY) : null;
	return key === null ? src : `${src}${src.includes("?") ? "&" : "?"}${MEDIA_KEY_PARAM}=${encodeURIComponent(key)}`;
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
		const error = isObject(body) ? body.error : null;
		const conflict = isObject(body) && body.conflict === true;
		throw new ApiError(typeof error === "string" ? error : `HTTP ${response.status}`, conflict);
	}
	return body as T;
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
	return readJson<T>(await apiFetch(url, { signal }));
}

export async function putJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	return readJson<T>(
		await apiFetch(url, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal,
		}),
	);
}

/** The settings route `part` for `cwd`, or for the user's own files when `cwd` is `null`. */
export const settingsUrl = (part: "" | "/routing" | "/file", cwd: string | null): string => `/api/settings${part}${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`;

export const readWorktrees = (cwd: string | null, signal?: AbortSignal): Promise<WorktreeInventory> => getJson(`/api/worktrees${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`, signal);

export const readWorktreeMetrics = (target: WorktreeTarget, signal?: AbortSignal): Promise<WorktreeMetrics> =>
	getJson(`/api/worktrees/metrics?${new URLSearchParams({ repository: target.repository, path: target.path })}`, signal);

export async function changeWorktrees(request: { action: "preview"; targets: WorktreeTarget[]; merged: boolean }, signal?: AbortSignal): Promise<{ plans: WorktreeRemovalPlan[] }>;
export async function changeWorktrees(request: { action: "remove"; plans: WorktreeConfirmation[] }, signal?: AbortSignal): Promise<{ results: WorktreeRemovalResult[] }>;
export async function changeWorktrees(request: WorktreeRemovalRequest, signal?: AbortSignal): Promise<{ plans: WorktreeRemovalPlan[] } | { results: WorktreeRemovalResult[] }> {
	return putJson("/api/worktrees/removal", request, signal);
}

/** Removes the linked worktree of `cwd`'s repository that has `branch` checked out, unless something keeps it. */
export const releaseWorktree = (cwd: string, branch: string): Promise<BranchRelease> => putJson("/api/worktree/release", { cwd, branch });
