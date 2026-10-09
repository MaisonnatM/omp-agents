/**
 * The inbox page's pull requests, per GitHub repository, live from `gh`: as Graphite's inbox gathers them, the
 * viewer's open and recently merged PRs and the open PRs that ask the viewer for a review.
 */
import { createCache } from "./cache";
import { AVATAR, authorOf, CHANGE, CHECK_RUN, dataOf, ghGraphql, parsePerson, REVIEW, REVIEW_EVENT, REVIEWER, repoOf, STATUS } from "./github";
import { errorText, isObject, num, str } from "./json";
import { directoryOf } from "./paths";
import { type CheckRunState, type Inbox, type InboxPullRequest, type InboxRole, type Person, type PullRequest, type PullRequestCheck, type PullRequestComment, type PullRequestCommit, type PullRequestDetail, type PullRequestEvent, type PullRequestFile, type PullRequestThread, prKey, type Repo, type RepoInbox, type Reviewer, type ReviewDecision, repoKey } from "./shared/github";

export { parseRemote, repoOf } from "./github";

const MERGED_DAYS = 7;

/** The most review threads one page lists; a PR with more counts its unresolved threads as a floor. */
const THREADS = 100;

/** The pull request's author, its requested reviewers, and its latest reviews, which the inbox's entry and its details both show. */
const REVIEW_FIELDS = `author { login ${AVATAR} }
	reviewRequests(first: 10) { nodes { requestedReviewer {
		... on User { login ${AVATAR} } ... on Bot { login ${AVATAR} } ... on Mannequin { login ${AVATAR} } ... on Team { slug ${AVATAR} }
	} } }
	latestReviews(first: 10) { nodes { state author { login ${AVATAR} } } }`;

const PR_FIELDS = `... on PullRequest {
	number title isDraft state reviewDecision mergeable headRefName baseRefName updatedAt mergedAt additions deletions
	${REVIEW_FIELDS}
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

const nodesOf = (connection: unknown): unknown[] => (isObject(connection) && Array.isArray(connection.nodes) ? connection.nodes : []);

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

/**
 * GitHub's review decision, except that a change request waits on the reviewers again once the author asked each of
 * them for a new review: GitHub keeps reporting `CHANGES_REQUESTED` until they review, and Graphite's inbox moves the
 * pull request to its waiting-for-review section.
 */
function reviewOf(decision: string | undefined, reviewers: Reviewer[]): ReviewDecision {
	const review = REVIEW[decision ?? ""] ?? "none";
	const reRequested = reviewers.some(({ state }) => state === "requested") && !reviewers.some(({ state }) => state === "changes-requested");
	return review === "changes-requested" && reRequested ? "review-required" : review;
}

function parseUnresolved(threads: unknown): InboxPullRequest["unresolved"] {
	const nodes = nodesOf(threads);
	const total = isObject(threads) && typeof threads.totalCount === "number" ? threads.totalCount : nodes.length;
	return { count: nodes.filter(thread => isObject(thread) && thread.isResolved === false).length, exact: total <= nodes.length };
}

/** GitHub reports an open or draft pull request as `CONFLICTING` with its base branch; `UNKNOWN` means not computed yet. */
const conflictsOf = (node: Record<string, unknown>): boolean => node.state !== "MERGED" && node.state !== "CLOSED" && node.mergeable === "CONFLICTING";

/** What a pull request's inbox entry and its details share, or `null` when GitHub left out its title or branches. */
function parsePullRequestHead(node: Record<string, unknown>) {
	const title = str(node.title);
	const head = str(node.headRefName);
	const base = str(node.baseRefName);
	if (title === undefined || head === undefined || base === undefined) return null;
	const author = authorOf(node.author);
	const reviewers = parseReviewers(node, author.login);
	const commits = nodesOf(node.commits);
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? str(commit.statusCheckRollup.state) : undefined;
	return {
		title,
		head,
		base,
		author,
		reviewers,
		state: node.state === "MERGED" ? ("merged" as const) : node.isDraft === true ? ("draft" as const) : ("open" as const),
		review: reviewOf(str(node.reviewDecision), reviewers),
		checks: STATUS[rollup ?? ""] ?? "none",
		conflicts: conflictsOf(node),
		additions: num(node.additions) ?? 0,
		deletions: num(node.deletions) ?? 0,
		unresolved: parseUnresolved(node.reviewThreads),
	};
}

function parsePullRequest(node: unknown, { owner, repo }: Repo, role: InboxRole): InboxPullRequest | null {
	if (!isObject(node) || typeof node.number !== "number") return null;
	const parsed = parsePullRequestHead(node);
	const updatedAt = Date.parse(str(node.mergedAt) ?? str(node.updatedAt) ?? "");
	if (!parsed || Number.isNaN(updatedAt)) return null;
	const { base, ...head } = parsed;
	const repository = isObject(node.repository) ? node.repository : {};
	const defaultBranch = isObject(repository.defaultBranchRef) ? str(repository.defaultBranchRef.name) : undefined;
	return {
		owner,
		repo,
		number: node.number,
		...head,
		role,
		stackedOn: defaultBranch !== undefined && base !== defaultBranch ? base : null,
		updatedAt,
	};
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
	const answer = await ghGraphql(QUERY, {
		authored: `${scope} is:open author:@me sort:updated-desc`,
		reviewing: `${scope} is:open review-requested:@me sort:updated-desc`,
		merged: `${scope} is:merged author:@me merged:>=${since} sort:updated-desc`,
	});
	return parseInboxAnswer(answer, repo);
}

const loaded = createCache<InboxPullRequest[]>();

const COMMENT_FIELDS = `author { login ${AVATAR} } body createdAt url`;

const DETAIL_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
	repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
		number title body isDraft state reviewDecision mergeable headRefName baseRefName createdAt updatedAt additions deletions changedFiles
		labels(first: 20) { nodes { name color } }
		history: commits(last: 100) { nodes { commit {
			abbreviatedOid messageHeadline committedDate additions deletions author { name ${AVATAR} user { login ${AVATAR} } }
			associatedPullRequests(first: 10) { nodes { number } }
		} } }
		${REVIEW_FIELDS}
		commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
			... on CheckRun { name status conclusion detailsUrl }
			... on StatusContext { context state targetUrl }
		} } } } } }
		files(first: 100) { nodes { path additions deletions changeType } }
		comments(last: 50) { nodes { ${COMMENT_FIELDS} } }
		reviews(last: 50) { nodes { state submittedAt author { login ${AVATAR} } body url } }
		reviewThreads(first: ${THREADS}) { totalCount nodes { isResolved path line comments(first: 20) { nodes { ${COMMENT_FIELDS} } } } }
	} }
}`;

const CHECK_ORDER: CheckRunState[] = ["failing", "pending", "passing", "skipped"];

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
	return { author: authorOf(node.author), body: str(node.body) ?? "", at: posted, url: str(node.url) ?? null };
}

/** The pull request in `gh api graphql`'s answer to `DETAIL_QUERY`; throws when GitHub has no such PR. */
export function parseDetailAnswer(answer: unknown, pr: PullRequest): PullRequestDetail {
	const data = dataOf(answer);
	const repository = isObject(data.repository) ? data.repository : {};
	const node = repository.pullRequest;
	const name = `${pr.owner}/${pr.repo}#${pr.number}`;
	if (!isObject(node)) throw new Error(`GitHub has no pull request ${name}`);
	const head = parsePullRequestHead(node);
	const createdAt = Date.parse(str(node.createdAt) ?? "");
	if (!head || Number.isNaN(createdAt)) throw new Error(`GitHub answered an incomplete ${name}`);
	const commits = nodesOf(node.commits);
	const commit = isObject(commits[0]) && isObject(commits[0].commit) ? commits[0].commit : {};
	const rollup = isObject(commit.statusCheckRollup) ? commit.statusCheckRollup.contexts : null;
	const checkRuns = nodesOf(rollup)
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
	// A branch that took in its trunk lists the trunk's commits too; each belongs to another, merged pull request.
	const commitList = nodesOf(node.history).flatMap((entry): PullRequestCommit[] => {
		const commit = isObject(entry) && isObject(entry.commit) ? entry.commit : null;
		const at = Date.parse(str(commit?.committedDate) ?? "");
		if (!commit || Number.isNaN(at)) return [];
		const owners = nodesOf(commit.associatedPullRequests).map(owner => (isObject(owner) ? owner.number : null));
		if (owners.length > 0 && !owners.includes(pr.number)) return [];
		const author = isObject(commit.author) ? commit.author : {};
		const person = parsePerson(author.user) ?? { login: str(author.name) ?? "unknown", avatarUrl: str(author.avatarUrl) ?? null };
		return [{ sha: str(commit.abbreviatedOid) ?? "", headline: str(commit.messageHeadline) ?? "", author: person, at, additions: num(commit.additions) ?? 0, deletions: num(commit.deletions) ?? 0 }];
	});
	const labels = nodesOf(node.labels).flatMap(label => (isObject(label) && typeof label.name === "string" ? [{ name: label.name, color: str(label.color) ?? "888888" }] : []));
	return {
		owner: pr.owner,
		repo: pr.repo,
		number: pr.number,
		...head,
		body: str(node.body) ?? "",
		state: node.state === "CLOSED" ? "closed" : head.state,
		changedFiles: num(node.changedFiles) ?? 0,
		files,
		checkRuns,
		threads,
		conversation: [...comments, ...reviews].toSorted((a, b) => a.at - b.at),
		createdAt,
		updatedAt: Date.parse(str(node.updatedAt) ?? "") || createdAt,
		labels,
		commits: commitList,
	};
}

const details = createCache<PullRequestDetail>();

/** One pull request in full, live from `gh`; `fresh` skips the kept answer, as after a change. */
export function loadPullRequestDetail(pr: PullRequest, fresh = false): Promise<PullRequestDetail> {
	return details.get(prKey(pr), async () => parseDetailAnswer(await ghGraphql(DETAIL_QUERY, { owner: pr.owner, repo: pr.repo, number: pr.number }), pr), fresh);
}

/**
 * The inbox for `cwds`, one entry per GitHub repository in the order its first workspace comes. `fresh` skips the cache.
 * A workspace removed since a session ran there is left out, as a quick action starts its session in a repository's first workspace.
 */
export async function loadInbox(cwds: string[], fresh: boolean): Promise<Inbox> {
	const byRepo = new Map<string, Repo & { cwds: string[] }>();
	const unmatched: string[] = [];
	const resolved = await Promise.all(cwds.filter(cwd => directoryOf(cwd) !== null).map(async cwd => [cwd, await repoOf(cwd)] as const));
	for (const [cwd, repo] of resolved) {
		if (!repo) {
			unmatched.push(cwd);
			continue;
		}
		const key = repoKey(repo);
		const entry = byRepo.get(key);
		if (entry) entry.cwds.push(cwd);
		else byRepo.set(key, { ...repo, cwds: [cwd] });
	}
	const repos = await Promise.all(
		[...byRepo.values()].map(async (entry): Promise<RepoInbox> => {
			try {
				const pullRequests = await loaded.get(repoKey(entry), () => queryRepo(entry), fresh);
				return { ...entry, pullRequests };
			} catch (err) {
				return { ...entry, error: errorText(err) };
			}
		}),
	);
	return { repos, unmatched };
}
