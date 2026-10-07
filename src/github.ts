/**
 * GitHub on the server: the repository `origin` names, `gh api` calls, and GitHub's enum values in the dashboard's
 * terms. The repository and pull request keys, which the page uses too, live in `shared.ts`.
 */
import { isObject, str } from "./json";
import { run, runJson } from "./proc";
import type { CheckRunState, Person, PullRequestEvent, PullRequestFile, Repo, ReviewDecision, ReviewerState } from "./shared/github";

const GH_TIMEOUT_MS = 20_000;

/** `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`, or `https://github.com/o/r`; `git push` prints `github.com:o/r.git`. */
const GITHUB_REMOTE = /^(?:(?:[^@/:]+@)?github\.com:|(?:https|ssh|git):\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function parseRemote(url: string): Repo | null {
	const match = GITHUB_REMOTE.exec(url.trim());
	return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** Negative answers stay this long, so that a directory with no GitHub `origin` does not spawn `git` on every load. */
const NO_REMOTE_TTL_MS = 10 * 60_000;
/** Most `git` lookups running at once, however many workspaces the sessions have used. */
const MAX_LOOKUPS = 8;

/**
 * Workspaces' repositories, and lookups in flight. `negativeUntil` marks a workspace with no GitHub `origin`, asked
 * again after it. Not a `createCache`: that caches answers for a fixed time, while this keeps a found repository for
 * good and forgets only a missing one.
 */
const remotes = new Map<string, { repo: Promise<Repo | null>; negativeUntil?: number }>();
let lookups = 0;
const waiting: (() => void)[] = [];

/** Runs `task` once fewer than {@link MAX_LOOKUPS} others run; a finished task hands its slot to the longest waiter. */
async function withLookupSlot<T>(task: () => Promise<T>): Promise<T> {
	if (lookups >= MAX_LOOKUPS) await new Promise<void>(resolve => waiting.push(resolve));
	else lookups++;
	try {
		return await task();
	} finally {
		const next = waiting.shift();
		if (next) next();
		else lookups--;
	}
}

/** The GitHub repository that `origin` names in `cwd`. */
export function repoOf(cwd: string): Promise<Repo | null> {
	const known = remotes.get(cwd);
	if (known && !(known.negativeUntil !== undefined && known.negativeUntil <= Date.now())) return known.repo;
	const entry: { repo: Promise<Repo | null>; negativeUntil?: number } = {
		repo: withLookupSlot(async () => {
			try {
				const { stdout, code } = await run(["git", "-C", cwd, "remote", "get-url", "origin"]);
				return code === 0 ? parseRemote(stdout) : null;
			} catch {
				return null;
			}
		}),
	};
	remotes.set(cwd, entry);
	void entry.repo.then(found => {
		if (!found) entry.negativeUntil = Date.now() + NO_REMOTE_TTL_MS;
	});
	return entry.repo;
}

/** `gh api graphql`'s answer to `query`: a string variable goes as `-f`, a number as `-F`. Read it with {@link dataOf}. */
export function ghGraphql(query: string, vars: Record<string, string | number>): Promise<unknown> {
	const fields = Object.entries(vars).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
	return runJson(["gh", "api", "graphql", "-f", `query=${query}`, ...fields], { timeoutMs: GH_TIMEOUT_MS });
}

/** The data of a `gh api graphql` answer, or GitHub's errors thrown. */
export function dataOf(answer: unknown): Record<string, unknown> {
	if (isObject(answer) && isObject(answer.data)) return answer.data;
	const errors = isObject(answer) && Array.isArray(answer.errors) ? answer.errors : [];
	const message = errors.map(error => (isObject(error) ? str(error.message) : undefined)).filter(Boolean).join("; ");
	throw new Error(message || "GitHub answered without data");
}

/** A user, bot, or mannequin by `login`, a team by `slug`. */
export function parsePerson(value: unknown): Person | null {
	if (!isObject(value)) return null;
	const login = str(value.login) ?? str(value.slug);
	return login === undefined ? null : { login, avatarUrl: str(value.avatarUrl) ?? null };
}

/** A pull request's review decision. */
export const REVIEW: Record<string, ReviewDecision> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	REVIEW_REQUIRED: "review-required",
};

/** A commit status's state, and the rollup of all the head commit's checks. */
export const STATUS: Record<string, Exclude<CheckRunState, "skipped">> = {
	SUCCESS: "passing",
	FAILURE: "failing",
	ERROR: "failing",
	PENDING: "pending",
	EXPECTED: "pending",
};

/** A latest review's state; a dismissed or pending review leaves its author out. */
export const REVIEWER: Record<string, ReviewerState> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
};

/** A check run's conclusion once it completes; any other status is pending. */
export const CHECK_RUN: Record<string, CheckRunState> = {
	SUCCESS: "passing",
	FAILURE: "failing",
	TIMED_OUT: "failing",
	CANCELLED: "failing",
	ACTION_REQUIRED: "failing",
	STARTUP_FAILURE: "failing",
	NEUTRAL: "skipped",
	SKIPPED: "skipped",
	STALE: "skipped",
};

/** A submitted review's state; a pending review is the viewer's unsent draft. */
export const REVIEW_EVENT: Record<string, NonNullable<PullRequestEvent["review"]>> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
	DISMISSED: "dismissed",
};

/** A changed file's change type. */
export const CHANGE: Record<string, PullRequestFile["change"]> = {
	ADDED: "added",
	DELETED: "deleted",
	MODIFIED: "modified",
	RENAMED: "renamed",
	COPIED: "copied",
	CHANGED: "changed",
};
