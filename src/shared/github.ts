/** GitHub repositories and pull requests: keys, links, the pull request list, one pull request in full, and its changed files. */

import { arrayOf, decoder, fields, isBoolean, isNumber, isString, isTexts, nullable, oneOf, optional, type Parsed, type Shape } from "../json";
import type { ChangedEntry } from "./changes";
import type { MergeMethod } from "./source-control";
import type { ReviewVerdict } from "./review-drafts";

/** A GitHub repository. */
export interface Repo {
	owner: string;
	repo: string;
}

/** A GitHub pull request. */
export interface PullRequest extends Repo {
	number: number;
}

/** GitHub's owner, repository, and login names. */
export const GITHUB_NAME = /^[\w.-]+$/;

/** A pull request named by an owner, repository, and number, as the routes and a new session's work item carry one. */
export function parsePullRequest(owner: unknown, repo: unknown, number: unknown): Parsed<PullRequest> {
	if (typeof owner !== "string" || typeof repo !== "string" || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) return null;
	return typeof number === "number" && Number.isSafeInteger(number) && number >= 1 ? { ok: { owner, repo, number } } : null;
}

/** The most files one `gh pr edit --attach` command takes. */
export const MAX_PULL_REQUEST_ATTACHMENTS = 50;

/** The largest image `gh` uploads, in bytes. */
export const MAX_PULL_REQUEST_IMAGE_BYTES = 10 * 1024 * 1024;

/** The image types `gh` uploads, which it reads from the file's extension. */
export const PULL_REQUEST_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;

/** One image for a pull request's description: its file name, type, bytes in base64, and the alt text it shows with. */
export interface PullRequestImage {
	name: string;
	type: (typeof PULL_REQUEST_IMAGE_TYPES)[number];
	data: string;
	alt: string;
}

/** The body of `PUT /api/pull-request/attachment`: images that `gh pr edit --attach` appends to a pull request's description. */
export interface PullRequestAttachment extends PullRequest {
	files: PullRequestImage[];
}

/** The hosts, besides `github.com/user-attachments/`, that serve the images and videos written on GitHub. */
const MEDIA_HOSTS: Record<string, true> = {
	"private-user-images.githubusercontent.com": true,
	"user-images.githubusercontent.com": true,
	"camo.githubusercontent.com": true,
};

/**
 * `raw` as a URL of an image or video written on GitHub, which `GET /api/github-media` fetches with the user's GitHub
 * sign-in, without its fragment; `null` for any other URL, or one with credentials or a port. A `//` URL is HTTPS.
 */
export function githubMediaUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
	if (MEDIA_HOSTS[url.hostname] !== true && !(url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/"))) return null;
	url.hash = "";
	return url;
}

/** `GET /api/github-media` of `raw`, or `null` when {@link githubMediaUrl} refuses it. */
export function githubMediaPath(raw: string): string | null {
	const url = githubMediaUrl(raw);
	return url && `/api/github-media?${new URLSearchParams({ url: url.href })}`;
}

/** A GitHub repository's key in maps and lookups: `owner/repo`, lowercased, since GitHub matches names in any case. */
export const repoKey = ({ owner, repo }: Repo): string => `${owner}/${repo}`.toLowerCase();

/** A pull request's key: `owner/repo#number`, lowercased. */
export const prKey = (pr: PullRequest): string => `${repoKey(pr)}#${pr.number}`;

export const pullRequestUrl = (pr: PullRequest): string => `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

/** A pull request's name as GitHub writes it: `owner/repo#number`. */
export const pullRequestName = (pr: PullRequest): string => `${pr.owner}/${pr.repo}#${pr.number}`;

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

/** Where the viewer stands on a listed pull request: they wrote it, or someone asked them to review it. */
export type PullRequestRole = "author" | "reviewer";

/** GitHub's review decision, plus `none` for a repository that requires no review. */
export type ReviewDecision = "approved" | "changes-requested" | "review-required" | "none";

/** The rollup of the head commit's checks. */
export type CheckState = "passing" | "failing" | "pending" | "none";

/** A GitHub user, bot, or team; `avatarUrl` is `null` when GitHub reports none. */
export interface Person {
	login: string;
	avatarUrl: string | null;
	isBot?: boolean;
}

/** Where one reviewer stands: their latest review, or `requested` while a review from them is pending. */
export type ReviewerState = "approved" | "changes-requested" | "commented" | "requested";

export interface Reviewer extends Person {
	state: ReviewerState;
}

/** A pull request on the Pull requests page, as GitHub reports it now. */
export interface PullRequestSummary extends PullRequest {
	title: string;
	author: Person;
	/** Requested reviewers first, then the others in GitHub's order of their latest reviews. */
	reviewers: Reviewer[];
	role: PullRequestRole;
	state: "open" | "draft" | "merged";
	review: ReviewDecision;
	checks: CheckState;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch; false for `MERGEABLE`, `UNKNOWN` (not computed yet), and merged PRs. */
	conflicts: boolean;
	/** Lines the pull request adds and removes. */
	additions: number;
	deletions: number;
	head: string;
	/** The branch it merges into when that is not the repository's default branch: the PR below it in a stack. */
	stackedOn: string | null;
	/** Review threads not yet resolved. `exact` is false when GitHub listed only some threads, so `count` is a floor. */
	unresolved: { count: number; exact: boolean };
	/** Comments and review threads, resolved ones too, as GitHub's own list counts its conversation. */
	conversations: number;
	/** Last update, or the merge for a merged PR, in ms since the epoch. */
	updatedAt: number;
}

/** One GitHub repository's pull requests, for the workspaces whose `origin` it is. */
export type RepoPullRequests = Repo & { cwds: string[] } & ({ pullRequests: PullRequestSummary[] } | { error: string });

export interface PullRequestList {
	repos: RepoPullRequests[];
	/** Workspaces with no GitHub `origin`, which the Pull requests page cannot show. */
	unmatched: string[];
}

const PERSON_FIELDS: Shape<Person> = { login: isString, avatarUrl: nullable(isString), isBot: optional(isBoolean) };
const isPerson = fields<Person>(PERSON_FIELDS);

const isSummary = fields<PullRequestSummary>({
	owner: isString,
	repo: isString,
	number: isNumber,
	title: isString,
	author: isPerson,
	reviewers: arrayOf(fields<Reviewer>({ ...PERSON_FIELDS, state: oneOf(["approved", "changes-requested", "commented", "requested"]) })),
	role: oneOf(["author", "reviewer"]),
	state: oneOf(["open", "draft", "merged"]),
	review: oneOf(["approved", "changes-requested", "review-required", "none"]),
	checks: oneOf(["passing", "failing", "pending", "none"]),
	conflicts: isBoolean,
	additions: isNumber,
	deletions: isNumber,
	head: isString,
	stackedOn: nullable(isString),
	unresolved: fields<PullRequestSummary["unresolved"]>({ count: isNumber, exact: isBoolean }),
	conversations: isNumber,
	updatedAt: isNumber,
});

const REPO: Shape<Repo & { cwds: string[] }> = { owner: isString, repo: isString, cwds: isTexts };
const isListed = fields<Repo & { cwds: string[]; pullRequests: PullRequestSummary[] }>({ ...REPO, pullRequests: arrayOf(isSummary) });
const isFailed = fields<Repo & { cwds: string[]; error: string }>({ ...REPO, error: isString });

/** A kept {@link PullRequestList} with every repository and pull request whole, or `null`: a read saved before the list carried each PR's diff size reads GitHub again. */
export const decodePullRequestList = decoder(
	fields<PullRequestList>({
		repos: arrayOf((repo: unknown): repo is RepoPullRequests => isListed(repo) || isFailed(repo)),
		unmatched: isTexts,
	}),
);

/** An open or draft pull request of a stack, as a pull request's details list its stack. */
export interface StackedPullRequest extends PullRequest {
	title: string;
	author: Person;
	state: "open" | "draft";
	checks: CheckState;
	head: string;
	/** The branch it merges into: the head of the pull request below it, or the trunk under the bottom one. */
	base: string;
	/** In ms since the epoch. */
	updatedAt: number;
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

export type PullRequestViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

export interface PullRequestChangedEntry extends ChangedEntry {
	viewed?: PullRequestViewedState;
}

/** Every file a pull request changes, as its changes page lists them, beyond the first 100 that its details list. */
export interface PullRequestChanges {
	title: string;
	/** The branch it merges, and the one it merges into. */
	head: string;
	base: string;
	files: PullRequestChangedEntry[];
}

/** GitHub's `ReactionContent` values. */
export const REACTION_CONTENTS = ["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"] as const;
export type ReactionContent = (typeof REACTION_CONTENTS)[number];

/** A nonempty reaction group on a comment or review. */
export interface PullRequestReaction {
	content: ReactionContent;
	count: number;
	viewerHasReacted: boolean;
}

export interface PullRequestComment {
	author: Person;
	/** Markdown, as written on GitHub. */
	body: string;
	/** When it was posted, in ms since the epoch. */
	at: number;
	url: string | null;
	reactions: PullRequestReaction[];
}

/** A comment on the pull request, or a submitted review, which may carry no text when it only approves or asks for changes. */
export interface PullRequestEvent extends PullRequestComment {
	/** `null` for a plain comment. */
	review: "approved" | "changes-requested" | "commented" | "dismissed" | null;
}

/** A review thread on a line of a file; `line` is `null` once the line no longer exists in the diff. */
export interface PullRequestThread {
	/** GitHub's node id, which resolving and replying name. */
	id: string;
	path: string;
	line: number | null;
	resolved: boolean;
	outdated: boolean;
	/** Whether the review of its root, its oldest comment, was dismissed. */
	dismissed: boolean;
	/** Whether GitHub lets you reply to it, resolve it, and unresolve it, so the button a resolve or unresolve shows at once stays right. */
	can: { reply: boolean; resolve: boolean; unresolve: boolean };
	/** All comments, including replies beyond the first 20 loaded in `comments`. */
	commentCount: number;
	/** Oldest first. */
	comments: PullRequestComment[];
}

/** A commit on the pull request's branch. */
export interface PullRequestCommit {
	/** Full Git object id for opening this commit's diff. */
	oid: string;
	sha: string;
	headline: string;
	author: Person;
	/** When it was committed, in ms since the epoch. */
	at: number;
	additions: number;
	deletions: number;
}

export interface PullRequestLabel {
	name: string;
	/** Hex, without `#`. */
	color: string;
}

/** GitHub's `mergeStateStatus`, lowercased: whether its merge button would merge now and, if not, what holds it. */
export const MERGE_STATES = ["clean", "unstable", "has-hooks", "behind", "blocked", "dirty", "draft", "unknown"] as const;
export type MergeState = (typeof MERGE_STATES)[number];

/** Whether GitHub would merge a pull request now, with none of its checks still running: else a merge waits until it is ready. */
export const mergesNow = ({ mergeState, checks }: { mergeState: MergeState; checks: CheckState }): boolean =>
	(mergeState === "clean" || mergeState === "unstable" || mergeState === "has-hooks") && checks !== "pending";

/** One pull request in full, as a pull request's details show it in place of opening GitHub. */
export interface PullRequestDetail extends PullRequest {
	title: string;
	body: string;
	author: Person;
	reviewers: Reviewer[];
	state: "open" | "draft" | "merged" | "closed";
	review: ReviewDecision;
	head: string;
	base: string;
	/** True when GitHub reports the PR as `CONFLICTING` with its base branch, as on {@link PullRequestSummary}. */
	conflicts: boolean;
	additions: number;
	deletions: number;
	/** All files the PR changes; `files` lists at most the first 100. */
	changedFiles: number;
	files: PullRequestFile[];
	/** GitHub's rollup of the head commit's checks, as on {@link PullRequestSummary}; `checkRuns` lists at most the first 100. */
	checks: CheckState;
	/** The head commit's checks, failing first, then pending, passing, and skipped. */
	checkRuns: PullRequestCheck[];
	/** Review threads not yet resolved: those of `threads`, with `exact` as on {@link PullRequestSummary}. */
	unresolved: PullRequestSummary["unresolved"];
	/** The review threads in full, resolved ones too: those among the first 100 that GitHub lists. */
	threads: PullRequestThread[];
	/** Comments and reviews, oldest first: the latest 50 of each. */
	conversation: PullRequestEvent[];
	/** In ms since the epoch. */
	createdAt: number;
	updatedAt: number;
	/** When it merged or closed, in ms since the epoch; null when GitHub reports no valid time. */
	mergedAt: number | null;
	closedAt: number | null;
	labels: PullRequestLabel[];
	/** Its own commits among the branch's latest 100, oldest first: none that GitHub links only to other pull requests. */
	commits: PullRequestCommit[];
	/** The head commit's full id, which a merge names so GitHub refuses it once the branch moved. */
	headOid: string;
	/** The merge methods the repository allows, in GitHub's order. */
	mergeMethods: MergeMethod[];
	/** Whether GitHub would merge it now, and if not, what holds it: a branch behind its base, a pending check or review, conflicts. */
	mergeState: MergeState;
	/** How many commits its base has that its branch lacks; `null` once it merged or closed, or when GitHub could not compare them, as after its branch was deleted. */
	behindBy: number | null;
	/** Whether you may comment on it: its repository is not archived, and its conversation is not locked or you can write to the repository. */
	canComment: boolean;
	/** Whether you opened it: GitHub lets its author review it only with a comment. */
	byViewer: boolean;
}

/** The states the details can set; a merge goes through the merge queue. */
export const SETTABLE_STATES = ["open", "draft", "closed"] as const;
export type SettableState = (typeof SETTABLE_STATES)[number];

/** How the details bring a branch up to date with its base: merge the base into it, or rebase it onto the base. */
export const UPDATE_METHODS = ["merge", "rebase"] as const;
export type UpdateMethod = (typeof UPDATE_METHODS)[number];

/** The longest title GitHub takes for a pull request. */
export const MAX_PULL_REQUEST_TITLE = 256;

/** The longest description GitHub takes for a pull request. */
export const MAX_PULL_REQUEST_BODY = 65_536;

/** One change the details make to a pull request. */
export type PullRequestChange =
	| { field: "title"; title: string }
	| { field: "body"; body: string }
	| { field: "label"; name: string; on: boolean }
	| { field: "reviewer"; login: string; on: boolean }
	| { field: "state"; state: SettableState }
	| { field: "update"; method: UpdateMethod }
	| { field: "thread"; id: string; resolved: boolean }
	| { field: "reply"; thread: string; body: string }
	| { field: "comment"; body: string }
	| { field: "review"; verdict: ReviewVerdict; body: string };

/** The longest reply or comment the details send, GitHub's own limit on a comment's body. */
export const MAX_COMMENT_BODY = 65_536;

/** The body of `PUT /api/pull-request`. */
export interface PullRequestEdit extends PullRequest {
	change: PullRequestChange;
}

/** The body of `PUT /api/pull-request/viewed`: one file of the pull request marked viewed by the viewer, or not. */
export interface PullRequestViewedEdit extends PullRequest {
	path: string;
	on: boolean;
}

/** What the details' Labels and Reviewers pickers offer for a repository. */
export interface PullRequestOptions {
	labels: PullRequestLabel[];
	/** The people a review can be asked of: those GitHub lets the repository assign. */
	reviewers: Person[];
}
