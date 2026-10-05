/** The page's HTTP client. Whatever the server answers, a failure is an `ApiError` with a readable message. */
import type { SettingsError } from "../src/shared";
import type { WorktreeConfirmation, WorktreeInventory, WorktreeMetrics, WorktreeRemovalPlan, WorktreeRemovalRequest, WorktreeRemovalResult, WorktreeTarget } from "../src/worktrees-shared";

export class ApiError extends Error {
	constructor(
		message: string,
		/** The file changed on disk since the page read it. */
		readonly conflict = false,
	) {
		super(message);
	}
}

/** What a failure says to the person reading the page. */
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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

/** The settings route `part` for `cwd`, or for the user's own files when `cwd` is `null`. */
export const settingsUrl = (part: "" | "/routing" | "/file", cwd: string | null): string => `/api/settings${part}${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`;

export const readWorktrees = (cwd: string | null, signal?: AbortSignal): Promise<WorktreeInventory> => getJson(`/api/worktrees${cwd === null ? "" : `?cwd=${encodeURIComponent(cwd)}`}`, signal);

export const readWorktreeMetrics = (target: WorktreeTarget, signal?: AbortSignal): Promise<WorktreeMetrics> =>
	getJson(`/api/worktrees/metrics?${new URLSearchParams({ repository: target.repository, path: target.path })}`, signal);

export async function changeWorktrees(request: { action: "preview"; targets: WorktreeTarget[] }, signal?: AbortSignal): Promise<{ plans: WorktreeRemovalPlan[] }>;
export async function changeWorktrees(request: { action: "remove"; plans: WorktreeConfirmation[] }, signal?: AbortSignal): Promise<{ results: WorktreeRemovalResult[] }>;
export async function changeWorktrees(request: WorktreeRemovalRequest, signal?: AbortSignal): Promise<{ plans: WorktreeRemovalPlan[] } | { results: WorktreeRemovalResult[] }> {
	return readJson(await fetch("/api/worktrees/removal", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal }));
}
