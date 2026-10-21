/**
 * A review draft on GitHub, through `gh api`: the pull request's head and the lines its diff shows, read anew for each
 * preview and post; the reviews already on it, so a retry finds the one it posted; and the post itself.
 */
import { ghRest, ghRestPost } from "./github";
import { isObject, num, str } from "./json";
import { parseFilesAnswer } from "./pull-request-files";
import type { PullRequest } from "./shared/github";
import { type DiffLines, diffLinesOf, type ReviewPayload } from "./shared/review-drafts";

/** What a draft posts against: the head commit now, and the lines of each file its diff shows. */
export interface ReviewTarget {
	head: string;
	lines: DiffLines;
}

/** A review GitHub holds, as a retry compares it with the review it would post. */
export interface SubmittedReview {
	id: number;
	url: string;
	login: string;
	/** The commit it was made on. */
	commit: string;
	/** GitHub's state: `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`, `DISMISSED`, or `PENDING`. */
	state: string;
	body: string;
}

/** One of a review's line comments, as a retry compares it. */
export interface SubmittedComment {
	path: string;
	body: string;
}

const pullPath = (pr: PullRequest): string => `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`;

/** GitHub's reason for an answer that is not what was asked, with the errors a REST refusal lists. */
function refusal(answer: unknown, fallback: string): Error {
	if (!isObject(answer)) return new Error(fallback);
	const errors = Array.isArray(answer.errors) ? answer.errors.map(error => str(error) ?? (isObject(error) ? str(error.message) : undefined)).filter(Boolean) : [];
	return new Error([str(answer.message) || fallback, ...errors].join(": "));
}

export async function readReviewTarget(pr: PullRequest): Promise<ReviewTarget> {
	const path = pullPath(pr);
	const [pull, pages] = await Promise.all([ghRest(path), ghRest(`${path}/files?per_page=100`, true)]);
	const head = isObject(pull) && isObject(pull.head) ? str(pull.head.sha) : undefined;
	if (!head) throw refusal(pull, "GitHub answered something other than the pull request");
	return { head, lines: diffLinesOf(parseFilesAnswer(pages)) };
}

/** The reviews in `gh api --paginate --slurp`'s answer for `pulls/<n>/reviews`: one array per page. */
export function parseReviewsAnswer(answer: unknown): SubmittedReview[] {
	if (!Array.isArray(answer)) throw refusal(answer, "GitHub answered something other than the reviews");
	return answer.flat().flatMap((review: unknown): SubmittedReview[] => {
		if (!isObject(review) || !isObject(review.user)) return [];
		const id = num(review.id);
		const login = str(review.user.login);
		const commit = str(review.commit_id);
		const state = str(review.state);
		if (id === undefined || login === undefined || commit === undefined || state === undefined) return [];
		return [{ id, url: str(review.html_url) ?? "", login, commit, state, body: str(review.body) ?? "" }];
	});
}

export async function listReviews(pr: PullRequest): Promise<SubmittedReview[]> {
	return parseReviewsAnswer(await ghRest(`${pullPath(pr)}/reviews?per_page=100`, true));
}

export async function listReviewComments(pr: PullRequest, reviewId: number): Promise<SubmittedComment[]> {
	const pages = await ghRest(`${pullPath(pr)}/reviews/${reviewId}/comments?per_page=100`, true);
	if (!Array.isArray(pages)) throw refusal(pages, "GitHub answered something other than the review's comments");
	return pages.flat().flatMap((comment: unknown): SubmittedComment[] => {
		const path = isObject(comment) ? str(comment.path) : undefined;
		const body = isObject(comment) ? str(comment.body) : undefined;
		return path === undefined || body === undefined ? [] : [{ path, body }];
	});
}

let viewer: Promise<string> | null = null;

/** The login `gh` is signed in as, read once per server; a failed read is read again next time. */
export function viewerLogin(): Promise<string> {
	if (!viewer) {
		viewer = ghRest("user").then(answer => {
			const login = isObject(answer) ? str(answer.login) : undefined;
			if (!login) throw refusal(answer, "gh answered without the signed-in user");
			return login;
		});
		viewer.catch(() => (viewer = null));
	}
	return viewer;
}

/** The review GitHub made of `answer` to a post, or its refusal thrown. */
export function parsePostAnswer(answer: unknown): { id: number; url: string } {
	const id = isObject(answer) ? num(answer.id) : undefined;
	if (id === undefined) throw refusal(answer, "GitHub did not take the review");
	return { id, url: (isObject(answer) && str(answer.html_url)) || "" };
}

export async function postReview(pr: PullRequest, payload: ReviewPayload): Promise<{ id: number; url: string }> {
	return parsePostAnswer(await ghRestPost(`${pullPath(pr)}/reviews`, payload));
}
