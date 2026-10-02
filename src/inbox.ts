/**
 * The inbox page's pull requests, per GitHub repository, live from `gh`: as Graphite's inbox gathers them, the
 * viewer's open and recently merged PRs and the open PRs that ask the viewer for a review.
 */
import type { CheckState, Inbox, InboxPullRequest, InboxRole, Person, RepoInbox, ReviewDecision, Reviewer, ReviewerState } from "./shared";
import { isObject } from "./transcript";

const GH_TIMEOUT_MS = 20_000;
/** How long one repository's answer serves later loads, so that several tabs and quick switches share one query. */
const FRESH_MS = 30_000;
const MERGED_DAYS = 7;

export interface Repo {
	owner: string;
	repo: string;
}

/** `git@github.com:o/r.git`, `ssh://git@github.com/o/r.git`, or `https://github.com/o/r`. */
const GITHUB_REMOTE = /^(?:git@github\.com:|(?:https|ssh|git):\/\/(?:[^@/]+@)?github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function parseRemote(url: string): Repo | null {
	const match = GITHUB_REMOTE.exec(url.trim());
	return match ? { owner: match[1]!, repo: match[2]! } : null;
}

/** Workspaces' repositories, and lookups in flight. A workspace with no GitHub `origin` yet is asked again next time. */
const remotes = new Map<string, Promise<Repo | null>>();

/** The GitHub repository that `origin` names in `cwd`. */
function repoOf(cwd: string): Promise<Repo | null> {
	const known = remotes.get(cwd);
	if (known) return known;
	const repo = (async () => {
		try {
			const child = Bun.spawn(["git", "-C", cwd, "remote", "get-url", "origin"], { stdout: "pipe", stderr: "ignore" });
			const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
			return code === 0 ? parseRemote(out) : null;
		} catch {
			return null;
		}
	})();
	remotes.set(cwd, repo);
	void repo.then(found => {
		if (!found) remotes.delete(cwd);
	});
	return repo;
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

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const nodesOf = (connection: unknown): unknown[] => (isObject(connection) && Array.isArray(connection.nodes) ? connection.nodes : []);

/** A user, bot, or mannequin by `login`, a team by `slug`. */
function parsePerson(value: unknown): Person | null {
	if (!isObject(value)) return null;
	const login = text(value.login) ?? text(value.slug);
	return login === null ? null : { login, avatarUrl: text(value.avatarUrl) };
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
		const state = isObject(review) ? REVIEWER[text(review.state) ?? ""] : undefined;
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
	const title = text(node.title);
	const head = text(node.headRefName);
	const base = text(node.baseRefName);
	const updatedAt = Date.parse(text(node.mergedAt) ?? text(node.updatedAt) ?? "");
	if (title === null || head === null || base === null || Number.isNaN(updatedAt)) return null;
	const repository = isObject(node.repository) ? node.repository : {};
	const defaultBranch = isObject(repository.defaultBranchRef) ? text(repository.defaultBranchRef.name) : null;
	const commits = nodesOf(node.commits);
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? text(commit.statusCheckRollup.state) : null;
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
		review: REVIEW[text(node.reviewDecision) ?? ""] ?? "none",
		checks: CHECKS[rollup ?? ""] ?? "none",
		head,
		stackedOn: defaultBranch !== null && base !== defaultBranch ? base : null,
		unresolved: parseUnresolved(node.reviewThreads),
		updatedAt,
	};
}

/** The pull requests in `gh api graphql`'s answer to `QUERY`, each once, in search order. */
export function parseInboxAnswer(answer: unknown, repo: Repo): InboxPullRequest[] {
	const data = isObject(answer) && isObject(answer.data) ? answer.data : null;
	if (!data) {
		const errors = isObject(answer) && Array.isArray(answer.errors) ? answer.errors : [];
		const message = errors.map(error => (isObject(error) ? text(error.message) : null)).filter(Boolean).join("; ");
		throw new Error(message || "GitHub answered without data");
	}
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
	const child = Bun.spawn(
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
		{ stdout: "pipe", stderr: "pipe", timeout: GH_TIMEOUT_MS },
	);
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	let answer: unknown;
	try {
		answer = JSON.parse(stdout);
	} catch {
		throw new Error(stderr.trim() || `gh exited with code ${code}`);
	}
	return parseInboxAnswer(answer, repo);
}

const loaded = new Map<string, { at: number; answer: Promise<InboxPullRequest[]> }>();

function pullRequestsOf(repo: Repo, fresh: boolean): Promise<InboxPullRequest[]> {
	const key = `${repo.owner}/${repo.repo}`.toLowerCase();
	const hit = loaded.get(key);
	if (hit && !fresh && Date.now() - hit.at < FRESH_MS) return hit.answer;
	const answer = queryRepo(repo);
	loaded.set(key, { at: Date.now(), answer });
	// A failure is not kept: the next load asks again.
	answer.catch(() => loaded.get(key)?.answer === answer && loaded.delete(key));
	return answer;
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
				return { ...entry, pullRequests: await pullRequestsOf(entry, fresh) };
			} catch (err) {
				return { ...entry, error: err instanceof Error ? err.message : String(err) };
			}
		}),
	);
	return { repos, unmatched };
}
