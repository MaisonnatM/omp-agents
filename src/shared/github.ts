/** GitHub repositories and pull requests: keys, links, the inbox, and one pull request in full. */

/** A GitHub repository. */
export interface Repo {
	owner: string;
	repo: string;
}

/** A GitHub pull request. */
export interface PullRequest extends Repo {
	number: number;
}

/** A GitHub repository's key in maps and lookups: `owner/repo`, lowercased, since GitHub matches names in any case. */
export const repoKey = ({ owner, repo }: Repo): string => `${owner}/${repo}`.toLowerCase();

/** A pull request's key: `owner/repo#number`, lowercased. */
export const prKey = (pr: PullRequest): string => `${repoKey(pr)}#${pr.number}`;

export const pullRequestUrl = (pr: PullRequest): string => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

const PULL_REQUEST_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]|$)/;

/** The pull request a GitHub address points at, its `/files` or `#discussion` pages too; `null` for any other address. */
export function pullRequestOfUrl(url: string): PullRequest | null {
	const match = PULL_REQUEST_URL.exec(url);
	return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null;
}

/** A branch's key: `owner/repo:branch`, the repository lowercased and the branch, which git keeps case-sensitive, as is. */
export const headKey = (repo: Repo, branch: string): string => `${repoKey(repo)}:${branch}`;

export const samePullRequest = (a: PullRequest, b: PullRequest): boolean => prKey(a) === prKey(b);

/**
 * How a session's tool calls touched a pull request: it submitted it with `gt submit` or `gh pr create`, or it
 * worked on it with `gh pr checkout`, `edit`, `comment`, `review`, `merge`, or `ready`, a `git push` to its branch,
 * or an omp `pr://` read.
 */
export type PullRequestLink = "submitted" | "worked";

export interface LinkedPullRequest extends PullRequest {
	link: PullRequestLink;
}

/** Where the viewer stands on a pull request in the inbox: they wrote it, or someone asked them to review it. */
export type InboxRole = "author" | "reviewer";

/** GitHub's review decision, plus `none` for a repository that requires no review. */
export type ReviewDecision = "approved" | "changes-requested" | "review-required" | "none";

/** The rollup of the head commit's checks. */
export type CheckState = "passing" | "failing" | "pending" | "none";

/** A GitHub user, bot, or team; `avatarUrl` is `null` when GitHub reports none. */
export interface Person {
	login: string;
	avatarUrl: string | null;
}

/** Where one reviewer stands: their latest review, or `requested` while a review from them is pending. */
export type ReviewerState = "approved" | "changes-requested" | "commented" | "requested";

export interface Reviewer extends Person {
	state: ReviewerState;
}

/** A pull request on the inbox page, as GitHub reports it now. */
export interface InboxPullRequest extends PullRequest {
	title: string;
	author: Person;
	/** Requested reviewers first, then the others in GitHub's order of their latest reviews. */
	reviewers: Reviewer[];
	role: InboxRole;
	state: "open" | "draft" | "merged";
	review: ReviewDecision;
	checks: CheckState;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch; false for `MERGEABLE`, `UNKNOWN` (not computed yet), and merged PRs. */
	conflicts: boolean;
	head: string;
	/** The branch it merges into when that is not the repository's default branch: the PR below it in a stack. */
	stackedOn: string | null;
	/** Review threads not yet resolved. `exact` is false when GitHub listed only some threads, so `count` is a floor. */
	unresolved: { count: number; exact: boolean };
	/** Last update, or the merge for a merged PR, in ms since the epoch. */
	updatedAt: number;
}

/** One GitHub repository's inbox, for the workspaces whose `origin` it is. */
export type RepoInbox = Repo & { cwds: string[] } & ({ pullRequests: InboxPullRequest[] } | { error: string });

export interface Inbox {
	repos: RepoInbox[];
	/** Workspaces with no GitHub `origin`, which the inbox cannot show. */
	unmatched: string[];
}

/** How one check on a pull request's head commit went; `skipped` covers neutral and skipped runs. */
export type CheckRunState = "passing" | "failing" | "pending" | "skipped";

export interface PullRequestCheck {
	name: string;
	state: CheckRunState;
	url: string | null;
}

export interface PullRequestFile {
	path: string;
	additions: number;
	deletions: number;
	change: "added" | "deleted" | "modified" | "renamed" | "copied" | "changed";
}

export interface PullRequestComment {
	author: Person;
	/** Markdown, as written on GitHub. */
	body: string;
	/** When it was posted, in ms since the epoch. */
	at: number;
	url: string | null;
}

/** A comment on the pull request, or a submitted review, which may carry no text when it only approves or asks for changes. */
export interface PullRequestEvent extends PullRequestComment {
	/** `null` for a plain comment. */
	review: "approved" | "changes-requested" | "commented" | "dismissed" | null;
}

/** An unresolved review thread on a line of a file; `line` is `null` once the line no longer exists in the diff. */
export interface PullRequestThread {
	path: string;
	line: number | null;
	comments: PullRequestComment[];
}

/** One pull request in full, as the inbox's details show it in place of opening GitHub. */
export interface PullRequestDetail extends PullRequest {
	title: string;
	body: string;
	author: Person;
	reviewers: Reviewer[];
	state: "open" | "draft" | "merged" | "closed";
	review: ReviewDecision;
	head: string;
	base: string;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch, as on {@link InboxPullRequest}. */
	conflicts: boolean;
	additions: number;
	deletions: number;
	/** All files the PR changes; `files` lists at most the first 100. */
	changedFiles: number;
	files: PullRequestFile[];
	/** GitHub's rollup of the head commit's checks, as on {@link InboxPullRequest}; `checkRuns` lists at most the first 100. */
	checks: CheckState;
	/** The head commit's checks, failing first, then pending, passing, and skipped. */
	checkRuns: PullRequestCheck[];
	/** Review threads not yet resolved, as on {@link InboxPullRequest}. */
	unresolved: InboxPullRequest["unresolved"];
	/** The unresolved threads in full: those among the first 100 that GitHub lists. */
	threads: PullRequestThread[];
	/** Comments and reviews, oldest first: the latest 50 of each. */
	conversation: PullRequestEvent[];
	/** In ms since the epoch. */
	createdAt: number;
}

/** `PUT /api/pull-request/sessions`: write links to these sessions, each linked to the PR, into its description on GitHub. */
export interface SessionLinksEdit extends PullRequest {
	sessionIds: string[];
}

/** The answer to a {@link SessionLinksEdit}: whether the description changed. A rerun with the same sessions changes nothing. */
export interface SessionLinksResult {
	changed: boolean;
}
