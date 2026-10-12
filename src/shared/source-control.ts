/** Settings › Source control providers: the CLIs the dashboard reads GitHub and Graphite through, automatic pulls, and merge methods. */

/** GitHub's merge methods, in the order its merge button lists them. */
export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = { merge: "Merge", squash: "Squash and merge", rebase: "Rebase and merge" };

/** The method a pull request's merge button starts with: one of GitHub's, or the one last picked in this browser. */
export type MergeMethodChoice = MergeMethod | "last";

/**
 * The method the merge button starts with: `choice`, or `last` for "last selected", when the repository allows it,
 * else the first method it allows; `null` when it allows none.
 */
export function startingMethod(choice: MergeMethodChoice, last: MergeMethod | null, allowed: readonly MergeMethod[]): MergeMethod | null {
	const wanted = choice === "last" ? last : choice;
	return wanted !== null && allowed.includes(wanted) ? wanted : (allowed[0] ?? null);
}

/** Automatic pulls, kept by the server in `source-control.json`. */
export interface AutoPull {
	on: boolean;
	/** A repository's own choice, keyed by its main checkout, over {@link on}. */
	repos: Record<string, boolean>;
}

export const DEFAULT_AUTO_PULL: AutoPull = { on: false, repos: {} };

/** `on: null` drops the repository's own choice, so it follows the default again. */
export type AutoPullChange = { op: "default"; on: boolean } | { op: "repo"; repo: string; on: boolean | null };

export function applyAutoPull(now: AutoPull, change: AutoPullChange): AutoPull {
	if (change.op === "default") return now.on === change.on ? now : { ...now, on: change.on };
	if ((now.repos[change.repo] ?? null) === change.on) return now;
	const { [change.repo]: _, ...rest } = now.repos;
	return { ...now, repos: change.on === null ? rest : { ...rest, [change.repo]: change.on } };
}

/** What one pull of a repository's default branch did. */
export type PullOutcome =
	| { kind: "current" }
	| { kind: "pulled"; commits: number }
	| { kind: "skipped"; reason: "changes" | "commits" | "no-default-branch" | "failed"; detail: string | null };

export interface PullRepo {
	/** Its main checkout. */
	path: string;
	/** `null` when it follows the default. */
	on: boolean | null;
	last: { at: number; outcome: PullOutcome } | null;
}

export const SOURCE_CONTROL_PROVIDERS = ["github", "graphite"] as const;
export type SourceControlProvider = (typeof SOURCE_CONTROL_PROVIDERS)[number];

/** Whether a provider's CLI is installed and signed in, and as whom when it says. */
export interface ProviderStatus {
	provider: SourceControlProvider;
	state: "missing" | "signed-out" | "signed-in";
	account: string | null;
}

/** `GET /api/source-control`. */
export interface SourceControlAnswer {
	providers: ProviderStatus[];
	autoPull: AutoPull;
	repos: PullRepo[];
}
