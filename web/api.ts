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

/**
 * A page a paired phone opened: it signed in through Phone access's pairing code, which only a phone does.
 * The desktop window's preload writes the token without this mark, so the Mac's own page never counts as one.
 */
export const PHONE_PAGE_KEY = "omp-agents.phone";

/** Whether this page signed in as a paired phone, which hides what only acts on the Mac. */
export const isPhonePage = (): boolean => stored(PHONE_PAGE_KEY) === "1";

/**
 * Trades a `#pair=<code>` fragment for the phone's own token, once, before the page reads whether it is signed in.
 * The fragment never reaches the server; the exchange does, and a failure leaves the page signed out.
 */
export async function exchangePairingCode(): Promise<void> {
	const code = new URLSearchParams(location.hash.slice(1)).get("pair");
	if (!code || !globalThis.localStorage) return;
	history.replaceState(null, "", location.pathname + location.search);
	try {
		const response = await fetch("/api/phone-access/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code, name: navigator.userAgent.includes("Mobile") ? "iPhone" : "Phone" }),
		});
		if (!response.ok) return;
		const body = (await response.json()) as { token?: unknown; mediaKey?: unknown };
		if (typeof body.token !== "string" || typeof body.mediaKey !== "string") return;
		localStorage.setItem(TOKEN_STORAGE_KEY, body.token);
		localStorage.setItem(MEDIA_KEY_STORAGE_KEY, body.mediaKey);
		localStorage.setItem(PHONE_PAGE_KEY, "1");
		signedOut = false;
	} catch {
		// The code expired or the server is unreachable: the sign-in screen says to scan a new one.
	}
}

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
	globalThis.localStorage?.removeItem(PHONE_PAGE_KEY);
	for (const listener of signOutListeners) listener();
}

/** `fetch` with the access token, which signs the page out when the server refuses it. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
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

/** A `PUT`, which counts as the user's action, keyed by its route. */
export async function putJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
	record("action", `put ${url.split("?", 1)[0]}`);
	return readJson<T>(
		await apiFetch(url, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal,
		}),
	);
}

/**
 * A `PUT` to a route that streams its steps, as the server's `answerSteps` does: calls `onStep` with each as it arrives,
 * then answers the last line's result or throws its error; a refusal before the first step throws as `putJson` would.
 */
export async function putSteps<S, T>(url: string, body: unknown, onStep: (step: S) => void): Promise<T> {
	record("action", `put ${url.split("?", 1)[0]}`);
	const response = await apiFetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
	if (!response.ok || !response.body) return readJson<T>(response);
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let partial = "";
	for (let read = await reader.read(); !read.done; read = await reader.read()) {
		const lines = (partial + read.value).split("\n");
		partial = lines.pop() ?? "";
		for (const line of lines) {
			const parsed = JSON.parse(line) as { step: S } | { done: T } | { error: string };
			if ("step" in parsed) onStep(parsed.step);
			else if ("done" in parsed) return parsed.done;
			else throw new ApiError(parsed.error);
		}
	}
	throw new ApiError("The server stopped answering before the work ended.");
}

/** The settings route `part` for `cwd`, or for the user's own files when `cwd` is `null`. */
export function settingsUrl(part: "" | "/routing" | "/model-profiles" | "/agent" | "/file" | "/extensions" | "/extensions/catalog" | "/extensions/contribution" | "/extensions/operation" | "/extensions/approval", cwd: string | null, extra: Record<string, string> = {}): string {
	const query = new URLSearchParams(extra);
	if (cwd !== null) query.set("cwd", cwd);
	return `/api/settings${part}${query.size ? `?${query}` : ""}`;
}

/** The omp memory route `part` for `cwd`; without `cwd` it reads the settings only, since omp keeps memory per workspace. */
export const ompMemoryUrl = (part: "" | "/file" | "/entry" | "/clear" | "/rebuild", cwd: string | null): string =>
	`/api/omp-memory${part}${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`;

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
