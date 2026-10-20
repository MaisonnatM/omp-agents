/**
 * GitHub on the server: the repository `origin` names, `gh api` calls, and GitHub's enum values in the dashboard's
 * terms. The repository and pull request keys, which the page uses too, live in `shared/github.ts`.
 */
import { createCache } from "./cache";
import { isObject, str } from "./json";
import { limit } from "./map-limit";
import { run, runChecked, runJson } from "./proc";
import type { ChangeStatus } from "./shared/changes";
import { type CheckRunState, MERGE_STATES, type MergeState, type Person, type PullRequestEvent, type PullRequestFile, type Repo, type ReviewDecision, type ReviewerState } from "./shared/github";

const GH_TIMEOUT_MS = 20_000;

/** `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`, or `https://github.com/o/r`; `git push` prints `github.com:o/r.git`. */
const GITHUB_REMOTE = /^(?:(?:[^@/:]+@)?github\.com:|(?:https|ssh|git):\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function parseRemote(url: string): Repo | null {
	const match = GITHUB_REMOTE.exec(url.trim());
	return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** How long a workspace's repository is kept, so that a directory with no GitHub `origin` does not spawn `git` on every load. */
const REMOTE_TTL_MS = 10 * 60_000;

/** Workspaces' repositories, and lookups in flight. A lookup never rejects: a failed `git` reads as no repository. */
const remotes = createCache<Repo | null>(REMOTE_TTL_MS);
/** At most 8 `git` lookups run at once, however many workspaces the sessions have used. */
const lookupSlot = limit(8);

/** The GitHub repository that `origin` names in `cwd`. */
export function repoOf(cwd: string): Promise<Repo | null> {
	return remotes.get(cwd, () =>
		lookupSlot(async () => {
			try {
				const { stdout, code } = await run(["git", "-C", cwd, "remote", "get-url", "origin"]);
				return code === 0 ? parseRemote(stdout) : null;
			} catch {
				return null;
			}
		}),
	);
}

/**
 * `gh api graphql`'s answer to `query`: a string variable goes as `-f`, a number as `-F`. Read it with {@link dataOf}; a mutation goes through {@link ghMutation}.
 * `paginate` follows the query's `$endCursor` through every page, answering an array of the pages.
 */
export function ghGraphql(query: string, vars: Record<string, string | number>, paginate = false): Promise<unknown> {
	const fields = Object.entries(vars).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
	return runJson(["gh", "api", "graphql", ...(paginate ? ["--paginate", "--slurp"] : []), "-f", `query=${query}`, ...fields], { timeoutMs: GH_TIMEOUT_MS });
}

/** `gh api`'s answer for REST `path`; `paginate` reads every page, answering an array of the pages. */
export function ghRest(path: string, paginate = false): Promise<unknown> {
	return runJson(["gh", "api", ...(paginate ? ["--paginate", "--slurp"] : []), path], { timeoutMs: GH_TIMEOUT_MS });
}

/** `method` on REST `path` through `gh api`, each field a `-f` of its JSON body, a `name[]` field one item of an array; throws GitHub's refusal. */
export async function ghRestWrite(method: "POST" | "PATCH" | "DELETE", path: string, fields: [name: string, value: string][] = []): Promise<void> {
	await runChecked(["gh", "api", "-X", method, path, ...fields.flatMap(([name, value]) => ["-f", `${name}=${value}`])], { timeoutMs: GH_TIMEOUT_MS });
}

/** GitHub's error messages in a `gh api graphql` answer, joined; empty when it reports none. */
function errorsOf(answer: unknown): string {
	const errors = isObject(answer) && Array.isArray(answer.errors) ? answer.errors : [];
	return errors.map(error => (isObject(error) ? str(error.message) : undefined)).filter(Boolean).join("; ");
}

/** The data of a `gh api graphql` answer, or GitHub's errors thrown. */
export function dataOf(answer: unknown): Record<string, unknown> {
	if (isObject(answer) && isObject(answer.data)) return answer.data;
	throw new Error(errorsOf(answer) || "GitHub answered without data");
}

/**
 * Runs `mutation` through `gh api graphql` and answers its data, or throws GitHub's errors even beside data: a refused
 * mutation answers its field as `null` next to them, which {@link dataOf} takes as data.
 */
export async function ghMutation(mutation: string, vars: Record<string, string | number>): Promise<Record<string, unknown>> {
	const answer = await ghGraphql(mutation, vars);
	const refused = errorsOf(answer);
	if (refused) throw new Error(refused);
	return dataOf(answer);
}

/** A user, bot, or mannequin by `login`, a team by `slug`. */
export function parsePerson(value: unknown): Person | null {
	if (!isObject(value)) return null;
	const login = str(value.login) ?? str(value.slug);
	return login === undefined ? null : { login, avatarUrl: str(value.avatarUrl) ?? null };
}

/** The avatar field every query asks for a person. */
export const AVATAR = "avatarUrl(size: 48)";

/** A deleted account leaves no author; GitHub shows it as `ghost`. */
export const authorOf = (author: unknown): Person => parsePerson(author) ?? { login: "ghost", avatarUrl: null };

/** A pull request's review decision. */
export const REVIEW: Record<string, ReviewDecision> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	REVIEW_REQUIRED: "review-required",
};

/** A pull request's `mergeStateStatus`, such as `HAS_HOOKS`; `unknown` for a value this version does not know. */
export const mergeStateOf = (value: unknown): MergeState => MERGE_STATES.find(state => state === str(value)?.toLowerCase().replaceAll("_", "-")) ?? "unknown";

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

/** A changed file's status in the REST API; a copy is a new file at the head. */
export const FILE_STATUS: Record<string, ChangeStatus> = {
	added: "added",
	copied: "added",
	removed: "deleted",
	modified: "modified",
	changed: "modified",
	unchanged: "modified",
	renamed: "renamed",
};
