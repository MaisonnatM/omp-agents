/** Settings › Source control: the CLIs the dashboard reads GitHub and Graphite through, automatic pulls, the cleanup after a merge, and merge methods. */

/** GitHub's merge methods, in the order its merge button lists them. */
export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = { merge: "Merge", squash: "Squash and merge", rebase: "Rebase and merge" };

/** The method a pull request's merge button starts with: one of GitHub's, or the one the last merge confirmed in this browser used. */
export type MergeMethodChoice = MergeMethod | "last";

/**
 * The method the merge button starts with: `choice`, or `last` for "last selected", when the repository allows it,
 * else the first method it allows; `null` when it allows none.
 */
export function startingMethod(choice: MergeMethodChoice, last: MergeMethod | null, allowed: readonly MergeMethod[]): MergeMethod | null {
	const wanted = choice === "last" ? last : choice;
	return wanted !== null && allowed.includes(wanted) ? wanted : (allowed[0] ?? null);
}

/** Automatic pulls. */
export interface AutoPull {
	on: boolean;
	/** A repository's own choice, keyed by its main checkout, over {@link on}. */
	repos: Record<string, boolean>;
}

/** What the server keeps in `source-control.json`: automatic pulls, and whether a merge ends the sessions it leaves with nothing to do. */
export interface SourceControlSettings extends AutoPull {
	cleanUp: boolean;
}

export const DEFAULT_SOURCE_CONTROL: SourceControlSettings = { on: false, repos: {}, cleanUp: true };

/** `on: null` drops the repository's own choice, so it follows the default again; `clean-up` turns the cleanup after a merge on or off. */
export type SourceControlChange = { op: "default"; on: boolean } | { op: "repo"; repo: string; on: boolean | null } | { op: "clean-up"; on: boolean };

export function applySourceControl(now: SourceControlSettings, change: SourceControlChange): SourceControlSettings {
	switch (change.op) {
		case "default":
			return now.on === change.on ? now : { ...now, on: change.on };
		case "clean-up":
			return now.cleanUp === change.on ? now : { ...now, cleanUp: change.on };
		case "repo": {
			if ((now.repos[change.repo] ?? null) === change.on) return now;
			const { [change.repo]: _, ...rest } = now.repos;
			return { ...now, repos: change.on === null ? rest : { ...rest, [change.repo]: change.on } };
		}
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
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
	/** Whether a merge ends the idle sessions it leaves with every pull request merged or closed, with their worktrees and branches. */
	cleanUp: boolean;
	repos: PullRepo[];
}
