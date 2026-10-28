/**
 * GitHub on the server: the repository `origin` names, `gh api` calls, the private repository Settings › Sync creates,
 * and GitHub's enum values in the dashboard's terms. The repository and pull request keys, which the page uses too, live
 * in `shared/github.ts`.
 */
import { createCache } from "./cache";
import { GithubQuota, parseRateLimit } from "./github-quota";
import { errorText, isObject, str } from "./json";
import { limit } from "./map-limit";
import { run, runChecked, runJson } from "./proc";
import type { ChangeStatus } from "./shared/changes";
import { type CheckRunState, MERGE_STATES, type MergeState, parseRemote, type Person, type PullRequestEvent, type PullRequestFile, type Repo, type ReviewDecision, type ReviewerState } from "./shared/github";
import { GitHubAccess, quotaReset, type GitHubBudget } from "../templates/omp/agent/extensions/github/access";
import { CommandError } from "../templates/omp/agent/extensions/github/command";
import { githubStatus } from "./source-control";

const GH_TIMEOUT_MS = 20_000;
const access = new GitHubAccess();

async function resetOf(budget: GitHubBudget): Promise<number | undefined> {
	return quotaReset(await runJson(["gh", "api", "rate_limit"], { timeoutMs: GH_TIMEOUT_MS }), budget);
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

/** The dashboard's share of the user's GraphQL budget, read from `gh api rate_limit`, which spends none of it. */
export const githubQuota = new GithubQuota(async () => parseRateLimit(await runJson(["gh", "api", "rate_limit"], { timeoutMs: GH_TIMEOUT_MS })));

/**
 * GitHub's printed answer even when `gh` exited non-zero, as callers read refusals and GraphQL partial data from it.
 * The access layer saw the failure first: it classified quota exhaustion, which still rejects.
 */
async function answered(request: Promise<unknown>): Promise<unknown> {
	try {
		return await request;
	} catch (error) {
		if (error instanceof CommandError && error.answer !== undefined) return error.answer;
		throw error;
	}
}

/**
 * `gh api graphql`'s answer to `query`: a string variable goes as `-f`, a number as `-F`. Read it with {@link dataOf}; a mutation goes through {@link ghMutation}.
 * `paginate` follows the query's `$endCursor` through every page, answering an array of the pages.
 */
export function ghGraphql(query: string, vars: Record<string, string | number>, paginate = false): Promise<unknown> {
	const fields = Object.entries(vars).flatMap(([name, value]) => [typeof value === "number" ? "-F" : "-f", `${name}=${value}`]);
	const argv = ["gh", "api", "graphql", ...(paginate ? ["--paginate", "--slurp"] : []), "-f", `query=${query}`, ...fields];
	return answered(access.request("graphql", () => runJson(argv, { timeoutMs: GH_TIMEOUT_MS }), () => resetOf("graphql")));
}

/**
 * {@link ghGraphql} for a read the dashboard makes on its own, such as the pull request list it polls: while
 * {@link githubQuota} holds the budget's last points for agents, it throws `GithubQuotaPaused` naming when reads resume, without asking GitHub.
 */
export async function ghPolledGraphql(query: string, vars: Record<string, string | number>, paginate = false): Promise<unknown> {
	await githubQuota.admit();
	return ghGraphql(query, vars, paginate);
}

/** `gh api`'s answer for REST `path`; `paginate` reads every page, answering an array of the pages. */
export function ghRest(path: string, paginate = false): Promise<unknown> {
	const argv = ["gh", "api", ...(paginate ? ["--paginate", "--slurp"] : []), path];
	return answered(access.request("rest", () => runJson(argv, { timeoutMs: GH_TIMEOUT_MS }), () => resetOf("rest")));
}

/** `method` on REST `path` through `gh api`, each field a `-f` of its JSON body, a `name[]` field one item of an array; throws GitHub's refusal. */
export async function ghRestWrite(method: "POST" | "PATCH" | "DELETE", path: string, fields: [name: string, value: string][] = []): Promise<void> {
	await access.request("rest", () => runChecked(["gh", "api", "-X", method, path, ...fields.flatMap(([name, value]) => ["-f", `${name}=${value}`])], { timeoutMs: GH_TIMEOUT_MS }), () => resetOf("rest"));
}

/** `gh api`'s answer to POST `body` on REST `path`, sent whole as JSON for a body that nests, such as a review's comments; GitHub's refusal comes back as its answer. */
export function ghRestPost(path: string, body: unknown): Promise<unknown> {
	return answered(access.request("rest", () => runJson(["gh", "api", "-X", "POST", path, "--input", "-"], { input: JSON.stringify(body), timeoutMs: GH_TIMEOUT_MS }), () => resetOf("rest")));
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
	const user = str(value.login);
	const login = user ?? str(value.slug);
	if (login === undefined) return null;
	return { login, avatarUrl: str(value.avatarUrl) ?? null, ...(value.__typename === "Bot" ? { isBot: true } : {}), ...(user === undefined ? { isTeam: true } : {}) };
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

/** `fullName`'s clone URL in the protocol gh's `git_protocol` names: SSH for `ssh`, else HTTPS, gh's default. */
export const cloneUrl = (fullName: string, protocol: string): string => (protocol.trim() === "ssh" ? `git@github.com:${fullName}.git` : `https://github.com/${fullName}.git`);

/** GitHub's repository `fullName`, or `null` when there is none by that name. */
async function viewRepo(fullName: string): Promise<{ nameWithOwner: string; owner: string; isPrivate: boolean } | null> {
	const value = await runJson(["gh", "repo", "view", fullName, "--json", "nameWithOwner,owner,isPrivate"], { timeoutMs: GH_TIMEOUT_MS }).catch((err: unknown) => {
		if (err instanceof Error && err.message.includes("Could not resolve to a Repository")) return null;
		throw err;
	});
	if (value === null) return null;
	if (!isObject(value) || typeof value.nameWithOwner !== "string" || !isObject(value.owner) || typeof value.owner.login !== "string" || typeof value.isPrivate !== "boolean") {
		throw new Error(`gh did not describe ${fullName}`);
	}
	return { nameWithOwner: value.nameWithOwner, owner: value.owner.login, isPrivate: value.isPrivate };
}

/**
 * The clone URL of the private GitHub repository `name` names, `owner/name` or a name under the signed-in account,
 * created when it does not exist; one that exists must be the account's own, and private.
 */
export async function ensurePrivateRepo(name: string): Promise<string> {
	const github = await githubStatus();
	if (github.state === "missing") throw new Error("gh is not installed: install the GitHub CLI to create a repository");
	if (!github.account) throw new Error("gh is signed out: run gh auth login in a terminal, then try again");
	const fullName = name.includes("/") ? name : `${github.account}/${name}`;
	const [existing, protocol] = await Promise.all([viewRepo(fullName), run(["gh", "config", "get", "git_protocol"])]);
	if (existing && existing.owner !== github.account) throw new Error(`${existing.nameWithOwner} already exists and belongs to ${existing.owner}`);
	if (existing && !existing.isPrivate) throw new Error(`${existing.nameWithOwner} already exists and is public; make it private on GitHub or choose another name`);
	if (!existing) await runChecked(["gh", "repo", "create", fullName, "--private"], { timeoutMs: GH_TIMEOUT_MS });
	return cloneUrl(existing?.nameWithOwner ?? fullName, protocol.code === 0 ? protocol.stdout : "");
}
