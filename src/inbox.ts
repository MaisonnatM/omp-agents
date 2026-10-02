/**
 * The inbox page's pull requests, per GitHub repository, live from `gh`: as Graphite's inbox gathers them, the
 * viewer's open and recently merged PRs and the open PRs that ask the viewer for a review.
 */
import { errorText, isObject, num, str } from "./json";
import { run, runJson } from "./proc";
import type {
	CheckRunState,
	CheckState,
	Inbox,
	InboxPullRequest,
	InboxRole,
	Person,
	PullRequest,
	PullRequestCheck,
	PullRequestComment,
	PullRequestDetail,
	PullRequestEvent,
	PullRequestFile,
	PullRequestThread,
	RepoInbox,
	ReviewDecision,
	Reviewer,
	ReviewerState,
} from "./shared";

const GH_TIMEOUT_MS = 20_000;
/** How long one repository's answer serves later loads, so that several tabs and quick switches share one query. */
const FRESH_MS = 30_000;
const MERGED_DAYS = 7;

export interface Repo {
	owner: string;
	repo: string;
}

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

/** Workspaces' repositories, and lookups in flight. `negativeUntil` marks a workspace with no GitHub `origin`, asked again after it. */
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

const AVATAR = "avatarUrl(size: 48)";
/** The most review threads one page lists; a PR with more counts its unresolved threads as a floor. */
const THREADS = 100;

const PR_FIELDS = `... on PullRequest {
	number title isDraft state reviewDecision headRefName baseRefName updatedAt mergedAt
	author { login ${AVATAR} }
	reviewRequests(first: 10) { nodes { requestedReviewer {
		... on User { login ${AVATAR} } ... on Bot { login ${AVATAR} } ... on Mannequin { login ${AVATAR} } ... on Team { slug ${AVATAR} }
	} } }
	latestReviews(first: 10) { nodes { state author { login ${AVATAR} } } }
	repository { defaultBranchRef { name } }
	commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
	reviewThreads(first: ${THREADS}) { totalCount nodes { isResolved } }
}`;

const QUERY = `query($authored: String!, $reviewing: String!, $merged: String!) {
	authored: search(type: ISSUE, query: $authored, first: 50) { nodes { ${PR_FIELDS} } }
	reviewing: search(type: ISSUE, query: $reviewing, first: 50) { nodes { ${PR_FIELDS} } }
	merged: search(type: ISSUE, query: $merged, first: 20) { nodes { ${PR_FIELDS} } }
}`;

/** Each search's alias in `QUERY`, with the viewer's role in what it finds. */
const SEARCHES: [alias: string, role: InboxRole][] = [
	["authored", "author"],
	["reviewing", "reviewer"],
	["merged", "author"],
];

const REVIEW: Record<string, ReviewDecision> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	REVIEW_REQUIRED: "review-required",
};

const CHECKS: Record<string, CheckState> = {
	SUCCESS: "passing",
	FAILURE: "failing",
	ERROR: "failing",
	PENDING: "pending",
	EXPECTED: "pending",
};

/** A latest review's state; a dismissed or pending review leaves its author out. */
const REVIEWER: Record<string, ReviewerState> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
};

const nodesOf = (connection: unknown): unknown[] => (isObject(connection) && Array.isArray(connection.nodes) ? connection.nodes : []);

/** A user, bot, or mannequin by `login`, a team by `slug`. */
function parsePerson(value: unknown): Person | null {
	if (!isObject(value)) return null;
	const login = str(value.login) ?? str(value.slug);
	return login === undefined ? null : { login, avatarUrl: str(value.avatarUrl) ?? null };
}

/** Pending requests first, then latest reviews, each person once; the author's own comments are left out. */
function parseReviewers(node: Record<string, unknown>, author: string): Reviewer[] {
	const reviewers = new Map<string, Reviewer>();
	for (const request of nodesOf(node.reviewRequests)) {
		const person = isObject(request) ? parsePerson(request.requestedReviewer) : null;
		if (person) reviewers.set(person.login, { ...person, state: "requested" });
	}
	for (const review of nodesOf(node.latestReviews)) {
		const person = isObject(review) ? parsePerson(review.author) : null;
		const state = isObject(review) ? REVIEWER[str(review.state) ?? ""] : undefined;
		if (person && state && person.login !== author && !reviewers.has(person.login)) reviewers.set(person.login, { ...person, state });
	}
	return [...reviewers.values()];
}

function parseUnresolved(threads: unknown): InboxPullRequest["unresolved"] {
	const nodes = nodesOf(threads);
	const total = isObject(threads) && typeof threads.totalCount === "number" ? threads.totalCount : nodes.length;
	return { count: nodes.filter(thread => isObject(thread) && thread.isResolved === false).length, exact: total <= nodes.length };
}

function parsePullRequest(node: unknown, { owner, repo }: Repo, role: InboxRole): InboxPullRequest | null {
	if (!isObject(node) || typeof node.number !== "number") return null;
	const title = str(node.title);
	const head = str(node.headRefName);
	const base = str(node.baseRefName);
	const updatedAt = Date.parse(str(node.mergedAt) ?? str(node.updatedAt) ?? "");
	if (title === undefined || head === undefined || base === undefined || Number.isNaN(updatedAt)) return null;
	const repository = isObject(node.repository) ? node.repository : {};
	const defaultBranch = isObject(repository.defaultBranchRef) ? str(repository.defaultBranchRef.name) : undefined;
	const commits = nodesOf(node.commits);
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? str(commit.statusCheckRollup.state) : undefined;
	// A deleted account leaves no author; GitHub shows it as `ghost`.
	const author = parsePerson(node.author) ?? { login: "ghost", avatarUrl: null };
	return {
		owner,
		repo,
		number: node.number,
		title,
		author,
		reviewers: parseReviewers(node, author.login),
		role,
		state: node.state === "MERGED" ? "merged" : node.isDraft === true ? "draft" : "open",
		review: REVIEW[str(node.reviewDecision) ?? ""] ?? "none",
		checks: CHECKS[rollup ?? ""] ?? "none",
		head,
		stackedOn: defaultBranch !== undefined && base !== defaultBranch ? base : null,
		unresolved: parseUnresolved(node.reviewThreads),
		updatedAt,
	};
}

/** The data of a `gh api graphql` answer, or GitHub's errors thrown. */
function dataOf(answer: unknown): Record<string, unknown> {
	if (isObject(answer) && isObject(answer.data)) return answer.data;
	const errors = isObject(answer) && Array.isArray(answer.errors) ? answer.errors : [];
	const message = errors.map(error => (isObject(error) ? str(error.message) : undefined)).filter(Boolean).join("; ");
	throw new Error(message || "GitHub answered without data");
}

/** The pull requests in `gh api graphql`'s answer to `QUERY`, each once, in search order. */
export function parseInboxAnswer(answer: unknown, repo: Repo): InboxPullRequest[] {
	const data = dataOf(answer);
	const found = new Map<number, InboxPullRequest>();
	for (const [alias, role] of SEARCHES) {
		for (const node of nodesOf(data[alias])) {
			const pr = parsePullRequest(node, repo, role);
			if (pr && !found.has(pr.number)) found.set(pr.number, pr);
		}
	}
	return [...found.values()];
}

async function queryRepo(repo: Repo): Promise<InboxPullRequest[]> {
	const scope = `repo:${repo.owner}/${repo.repo} is:pr`;
	const since = new Date(Date.now() - MERGED_DAYS * 86_400_000).toISOString().slice(0, 10);
	const answer = await runJson(
		[
			"gh",
			"api",
			"graphql",
			"-f",
			`query=${QUERY}`,
			"-f",
			`authored=${scope} is:open author:@me sort:updated-desc`,
			"-f",
			`reviewing=${scope} is:open review-requested:@me sort:updated-desc`,
			"-f",
			`merged=${scope} is:merged author:@me merged:>=${since} sort:updated-desc`,
		],
		{ timeoutMs: GH_TIMEOUT_MS },
	);
	return parseInboxAnswer(answer, repo);
}

/** Answers kept for {@link FRESH_MS}, by key; a failure is not kept, so the next load asks again. */
function cached<T>(cache: Map<string, { at: number; answer: Promise<T> }>, key: string, fresh: boolean, load: () => Promise<T>): Promise<T> {
	const hit = cache.get(key);
	if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return hit.answer;
	const answer = load();
	cache.set(key, { at: Date.now(), answer });
	answer.catch(() => cache.get(key)?.answer === answer && cache.delete(key));
	return answer;
}

const loaded = new Map<string, { at: number; answer: Promise<InboxPullRequest[]> }>();

const COMMENT_FIELDS = `author { login ${AVATAR} } body createdAt url`;

const DETAIL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
		number title body isDraft state reviewDecision headRefName baseRefName createdAt additions deletions changedFiles
		author { login ${AVATAR} }
		reviewRequests(first: 10) { nodes { requestedReviewer {
			... on User { login ${AVATAR} } ... on Bot { login ${AVATAR} } ... on Mannequin { login ${AVATAR} } ... on Team { slug ${AVATAR} }
		} } }
		latestReviews(first: 10) { nodes { state author { login ${AVATAR} } } }
		commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
			... on CheckRun { name status conclusion detailsUrl }
			... on StatusContext { context state targetUrl }
		} } } } } }
		files(first: 100) { nodes { path additions deletions changeType } }
		comments(last: 50) { nodes { ${COMMENT_FIELDS} } }
		reviews(last: 50) { nodes { state submittedAt author { login ${AVATAR} } body url } }
		reviewThreads(first: ${THREADS}) { nodes { isResolved path line comments(first: 20) { nodes { ${COMMENT_FIELDS} } } } }
	} }
}`;

/** A check run's conclusion once it completes; any other status is pending. */
const CHECK_RUN: Record<string, CheckRunState> = {
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

/** A commit status's state. */
const STATUS: Record<string, CheckRunState> = { SUCCESS: "passing", FAILURE: "failing", ERROR: "failing", PENDING: "pending", EXPECTED: "pending" };

const CHECK_ORDER: CheckRunState[] = ["failing", "pending", "passing", "skipped"];

/** A submitted review's state; a pending review is the viewer's unsent draft. */
const REVIEW_EVENT: Record<string, NonNullable<PullRequestEvent["review"]>> = {
	APPROVED: "approved",
	CHANGES_REQUESTED: "changes-requested",
	COMMENTED: "commented",
	DISMISSED: "dismissed",
};

const CHANGE: Record<string, PullRequestFile["change"]> = {
	ADDED: "added",
	DELETED: "deleted",
	MODIFIED: "modified",
	RENAMED: "renamed",
	COPIED: "copied",
	CHANGED: "changed",
};

function parseCheck(node: unknown): PullRequestCheck | null {
	if (!isObject(node)) return null;
	const name = str(node.name);
	if (name !== undefined) {
		const state = node.status === "COMPLETED" ? (CHECK_RUN[str(node.conclusion) ?? ""] ?? "skipped") : "pending";
		return { name, state, url: str(node.detailsUrl) ?? null };
	}
	const context = str(node.context);
	return context === undefined ? null : { name: context, state: STATUS[str(node.state) ?? ""] ?? "pending", url: str(node.targetUrl) ?? null };
}

function parseComment(node: unknown, at: unknown): PullRequestComment | null {
	if (!isObject(node)) return null;
	const posted = Date.parse(str(at) ?? "");
	if (Number.isNaN(posted)) return null;
	return { author: parsePerson(node.author) ?? { login: "ghost", avatarUrl: null }, body: str(node.body) ?? "", at: posted, url: str(node.url) ?? null };
}

/** The pull request in `gh api graphql`'s answer to `DETAIL_QUERY`; throws when GitHub has no such PR. */
export function parseDetailAnswer(answer: unknown, pr: PullRequest): PullRequestDetail {
	const data = dataOf(answer);
	const repository = isObject(data.repository) ? data.repository : {};
	const node = repository.pullRequest;
	const name = `${pr.owner}/${pr.repo}#${pr.number}`;
	if (!isObject(node)) throw new Error(`GitHub has no pull request ${name}`);
	const title = str(node.title);
	const head = str(node.headRefName);
	const base = str(node.baseRefName);
	const createdAt = Date.parse(str(node.createdAt) ?? "");
	if (title === undefined || head === undefined || base === undefined || Number.isNaN(createdAt)) throw new Error(`GitHub answered an incomplete ${name}`);
	const author = parsePerson(node.author) ?? { login: "ghost", avatarUrl: null };
	const commits = nodesOf(node.commits);
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? commit.statusCheckRollup.contexts : null;
	const checks = nodesOf(rollup)
		.map(parseCheck)
		.filter(check => check !== null)
		.toSorted((a, b) => CHECK_ORDER.indexOf(a.state) - CHECK_ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
	const files = nodesOf(node.files).flatMap((file): PullRequestFile[] =>
		isObject(file) && typeof file.path === "string"
			? [{ path: file.path, additions: num(file.additions) ?? 0, deletions: num(file.deletions) ?? 0, change: CHANGE[str(file.changeType) ?? ""] ?? "changed" }]
			: [],
	);
	const comments = nodesOf(node.comments).flatMap((comment): PullRequestEvent[] => {
		const parsed = parseComment(comment, isObject(comment) ? comment.createdAt : null);
		return parsed ? [{ ...parsed, review: null }] : [];
	});
	// A review that only comments carries its words in its review threads.
	const reviews = nodesOf(node.reviews).flatMap((review): PullRequestEvent[] => {
		if (!isObject(review)) return [];
		const state = REVIEW_EVENT[str(review.state) ?? ""];
		const parsed = parseComment(review, review.submittedAt);
		return state && parsed && (parsed.body.trim() || state !== "commented") ? [{ ...parsed, review: state }] : [];
	});
	const threads = nodesOf(node.reviewThreads).flatMap((thread): PullRequestThread[] => {
		if (!isObject(thread) || thread.isResolved !== false || typeof thread.path !== "string") return [];
		const threadComments = nodesOf(thread.comments).flatMap(comment => parseComment(comment, isObject(comment) ? comment.createdAt : null) ?? []);
		return [{ path: thread.path, line: typeof thread.line === "number" ? thread.line : null, comments: threadComments }];
	});
	return {
		owner: pr.owner,
		repo: pr.repo,
		number: pr.number,
		title,
		body: str(node.body) ?? "",
		author,
		reviewers: parseReviewers(node, author.login),
		state: node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : node.isDraft === true ? "draft" : "open",
		review: REVIEW[str(node.reviewDecision) ?? ""] ?? "none",
		head,
		base,
		additions: num(node.additions) ?? 0,
		deletions: num(node.deletions) ?? 0,
		changedFiles: num(node.changedFiles) ?? 0,
		files,
		checks,
		threads,
		conversation: [...comments, ...reviews].toSorted((a, b) => a.at - b.at),
		createdAt,
	};
}

const details = new Map<string, { at: number; answer: Promise<PullRequestDetail> }>();

/** One pull request in full, live from `gh`. */
export function loadPullRequestDetail(pr: PullRequest): Promise<PullRequestDetail> {
	return cached(details, `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase(), false, async () =>
		parseDetailAnswer(
			await runJson(
				["gh", "api", "graphql", "-f", `query=${DETAIL_QUERY}`, "-f", `owner=${pr.owner}`, "-f", `repo=${pr.repo}`, "-F", `number=${pr.number}`],
				{ timeoutMs: GH_TIMEOUT_MS },
			),
			pr,
		),
	);
}

/** The inbox for `cwds`, one entry per GitHub repository in the order its first workspace comes. `fresh` skips the cache. */
export async function loadInbox(cwds: string[], fresh: boolean): Promise<Inbox> {
	const byRepo = new Map<string, Repo & { cwds: string[] }>();
	const unmatched: string[] = [];
	const resolved = await Promise.all(cwds.map(async cwd => [cwd, await repoOf(cwd)] as const));
	for (const [cwd, repo] of resolved) {
		if (!repo) {
			unmatched.push(cwd);
			continue;
		}
		const key = `${repo.owner}/${repo.repo}`.toLowerCase();
		const entry = byRepo.get(key);
		if (entry) entry.cwds.push(cwd);
		else byRepo.set(key, { ...repo, cwds: [cwd] });
	}
	const repos = await Promise.all(
		[...byRepo.values()].map(async (entry): Promise<RepoInbox> => {
			try {
				const pullRequests = await cached(loaded, `${entry.owner}/${entry.repo}`.toLowerCase(), fresh, () => queryRepo(entry));
				return { ...entry, pullRequests };
			} catch (err) {
				return { ...entry, error: errorText(err) };
			}
		}),
	);
	return { repos, unmatched };
}
