/**
 * Review drafts: the review a Review session wrote for someone else's pull request, which the user accepts, edits, and
 * posts from the pull request's details. The session never posts on GitHub; the dashboard posts the draft once, as one
 * review pinned to the head commit the session read.
 */
import { arrayOf, fields, type Guard, isNumber, isString, nullable, oneOf } from "../json";
import { parseFullDiff } from "./changes";
import { type PullRequest, samePullRequest } from "./github";

/** The tool a Review session saves its draft through, which the server serves and the Review prompt names. */
export const REVIEW_DRAFT_TOOL = "save_review_draft";

export const REVIEW_VERDICTS = ["approve", "request-changes", "comment"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

/** A finding waits on the user until accepted, which posts it, or dismissed, which leaves it out. */
export const FINDING_STATES = ["pending", "accepted", "dismissed"] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface ReviewFinding {
	id: string;
	/** The file it is about, relative to the repository's root. */
	path: string;
	/** The line of the file at the head it is about; `null` for the file as a whole. */
	line: number | null;
	body: string;
	state: FindingState;
}

/** The review GitHub took for a draft. */
export interface PostedReview {
	id: number;
	url: string;
	/** When it posted, in ms since the epoch. */
	at: number;
}

export interface ReviewDraft {
	pr: PullRequest;
	/** The head commit the session reviewed, its full id; the review posts on it, and only while it is still the head. */
	head: string;
	verdict: ReviewVerdict;
	summary: string;
	findings: ReviewFinding[];
	/** When the session saved it, in ms since the epoch. */
	savedAt: number;
	/** The review it posted as; a posted draft takes no more edits. */
	posted: PostedReview | null;
}

/** A session that reviews a pull request: it keeps the review tool when it resumes. */
export interface Reviewer {
	sessionId: string;
	pr: PullRequest;
}

/** What `review-drafts.json` holds. */
export interface ReviewDraftState {
	drafts: ReviewDraft[];
	reviewers: Reviewer[];
}

export const NO_REVIEW_DRAFTS: ReviewDraftState = { drafts: [], reviewers: [] };

/** A change the page makes to the draft for `pr`. */
export type ReviewDraftEdit =
	| { op: "verdict"; pr: PullRequest; verdict: ReviewVerdict }
	| { op: "summary"; pr: PullRequest; summary: string }
	| { op: "finding"; pr: PullRequest; id: string; path: string; line: number | null; body: string }
	| { op: "finding-state"; pr: PullRequest; ids: string[]; state: FindingState }
	| { op: "discard"; pr: PullRequest };

/** A page's edit, or what the server does: a session saves a draft, a review posts, a session starts or resumes as another id. */
export type ReviewDraftChange =
	| ReviewDraftEdit
	| { op: "save"; draft: ReviewDraft }
	| { op: "posted"; pr: PullRequest; head: string; review: PostedReview }
	| { op: "bind"; reviewer: Reviewer }
	| { op: "relink"; from: string; to: string };

/** The sessions the file remembers as reviewers, newest last: one resumed after that many later reviews loses the tool. */
const KEPT_REVIEWERS = 200;

/** The draft for `pr`, if any. */
export const reviewDraftOf = (drafts: readonly ReviewDraft[], pr: PullRequest): ReviewDraft | undefined => drafts.find(draft => samePullRequest(draft.pr, pr));

/** Whether `draft` waits on the user: saved and not posted. */
export const waitsOnYou = (draft: ReviewDraft | undefined): boolean => draft !== undefined && draft.posted === null;

/** How long a posted draft stays to show what posted: a later save of any draft drops it. */
const POSTED_KEPT_MS = 14 * 24 * 3_600_000;

/** `state` after `change`, or `state` itself when it changes nothing. A posted draft takes only a new save or its discard. */
export function applyReviewDraft(state: ReviewDraftState, change: ReviewDraftChange): ReviewDraftState {
	switch (change.op) {
		case "save": {
			const { pr, savedAt } = change.draft;
			const kept = state.drafts.filter(draft => !samePullRequest(draft.pr, pr) && !(draft.posted && draft.posted.at < savedAt - POSTED_KEPT_MS));
			return { ...state, drafts: [...kept, change.draft] };
		}
		case "discard": {
			const drafts = state.drafts.filter(draft => !samePullRequest(draft.pr, change.pr));
			return drafts.length === state.drafts.length ? state : { ...state, drafts };
		}
		case "posted":
			return mapDraft(state, change.pr, draft => (draft.head === change.head && draft.posted === null ? { ...draft, posted: change.review } : draft));
		case "bind": {
			const { sessionId, pr } = change.reviewer;
			if (state.reviewers.some(reviewer => reviewer.sessionId === sessionId && samePullRequest(reviewer.pr, pr))) return state;
			return { ...state, reviewers: [...state.reviewers.filter(reviewer => reviewer.sessionId !== sessionId), change.reviewer].slice(-KEPT_REVIEWERS) };
		}
		case "relink": {
			if (change.from === change.to || !state.reviewers.some(reviewer => reviewer.sessionId === change.from)) return state;
			return { ...state, reviewers: state.reviewers.map(reviewer => (reviewer.sessionId === change.from ? { ...reviewer, sessionId: change.to } : reviewer)) };
		}
		default:
			return mapDraft(state, change.pr, draft => (draft.posted === null ? editDraft(draft, change) : draft));
	}
}

function editDraft(draft: ReviewDraft, edit: Exclude<ReviewDraftEdit, { op: "discard" }>): ReviewDraft {
	switch (edit.op) {
		case "verdict":
			return edit.verdict === draft.verdict ? draft : { ...draft, verdict: edit.verdict };
		case "summary":
			return edit.summary === draft.summary ? draft : { ...draft, summary: edit.summary };
		case "finding":
			return mapFindings(draft, finding =>
				finding.id !== edit.id || (finding.path === edit.path && finding.line === edit.line && finding.body === edit.body) ? finding : { ...finding, path: edit.path, line: edit.line, body: edit.body },
			);
		case "finding-state":
			return mapFindings(draft, finding => (edit.ids.includes(finding.id) && finding.state !== edit.state ? { ...finding, state: edit.state } : finding));
	}
}

function mapDraft(state: ReviewDraftState, pr: PullRequest, next: (draft: ReviewDraft) => ReviewDraft): ReviewDraftState {
	const at = state.drafts.findIndex(draft => samePullRequest(draft.pr, pr));
	const draft = state.drafts[at];
	const changed = draft && next(draft);
	return !changed || changed === draft ? state : { ...state, drafts: state.drafts.with(at, changed) };
}

function mapFindings(draft: ReviewDraft, next: (finding: ReviewFinding) => ReviewFinding): ReviewDraft {
	const findings = draft.findings.map(next);
	return findings.every((finding, index) => finding === draft.findings[index]) ? draft : { ...draft, findings };
}

/** The lines of each changed file's head side that its diff shows, by path: the lines a review comment can sit on. */
export type DiffLines = ReadonlyMap<string, ReadonlySet<number>>;

/** The lines GitHub's `patch` of each file shows on its head side; a file with no patch, binary or too large, has none. */
export function diffLinesOf(files: readonly { path: string; patch: string | null }[]): DiffLines {
	return new Map(files.map(({ path, patch }) => [path, new Set(patch ? parseFullDiff(patch).flatMap(row => (row.new === null ? [] : [row.new])) : [])]));
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

const EVENTS: Record<ReviewVerdict, ReviewEvent> = { approve: "APPROVE", "request-changes": "REQUEST_CHANGES", comment: "COMMENT" };

/** A comment on one line of the head side of the diff. */
export interface ReviewComment {
	path: string;
	line: number;
	side: "RIGHT";
	body: string;
}

/** The body of `POST /repos/{owner}/{repo}/pulls/{number}/reviews`, as GitHub names its fields. */
export interface ReviewPayload {
	commit_id: string;
	event: ReviewEvent;
	body: string;
	comments: ReviewComment[];
}

/**
 * What posting `draft` sends: each accepted finding on a line `lines` shows becomes a comment there, and each other
 * accepted finding, on no line or on one outside the diff, a list item after the summary, since GitHub refuses a comment
 * on a line its diff does not show.
 */
export function reviewPayload(draft: ReviewDraft, lines: DiffLines): ReviewPayload {
	const accepted = draft.findings.filter(finding => finding.state === "accepted");
	const onDiff = (finding: ReviewFinding): finding is ReviewFinding & { line: number } => finding.line !== null && (lines.get(finding.path)?.has(finding.line) ?? false);
	const comments = accepted.filter(onDiff).map(({ path, line, body }): ReviewComment => ({ path, line, side: "RIGHT", body }));
	const folded = accepted.filter(finding => !onDiff(finding)).map(foldedItem);
	const body = [draft.summary.trim(), folded.join("\n")].filter(part => part !== "").join("\n\n");
	return { commit_id: draft.head, event: EVENTS[draft.verdict], body, comments };
}

/** A finding as a Markdown list item: its place in code, then its body, its later lines indented under the item. */
function foldedItem({ path, line, body }: ReviewFinding): string {
	return `- \`${line === null ? path : `${path}:${line}`}\`: ${body.trim().replaceAll("\n", "\n  ")}`;
}

/**
 * Why `draft` cannot post while `head` heads the pull request, or `null` when it can: it posted already, the pull
 * request moved on since the session read it, or there is nothing to say.
 */
export function postRefusal(draft: ReviewDraft, head: string): string | null {
	if (draft.posted) return "This draft is posted already.";
	if (draft.head !== head) return `The pull request moved from ${draft.head.slice(0, 7)} to ${head.slice(0, 7)} since this review; run Review again on the new head.`;
	const summary = draft.summary.trim();
	if (draft.verdict === "request-changes" && summary === "") return "Requesting changes needs a summary.";
	if (summary === "" && !draft.findings.some(finding => finding.state === "accepted")) return "Accept a finding or write a summary first.";
	return null;
}

/** What `GET /api/review-draft/preview` answers: what posting sends now, or why it cannot post. */
export interface ReviewPreview {
	payload: ReviewPayload;
	/** The pull request's head commit now. */
	head: string;
	refusal: string | null;
}

const isPullRequest = fields<PullRequest>({ owner: isString, repo: isString, number: isNumber });

const isReviewFinding = fields<ReviewFinding>({ id: isString, path: isString, line: nullable(isNumber), body: isString, state: oneOf(FINDING_STATES) });

/** A draft as `review-drafts.json` keeps it. */
export const isReviewDraft: Guard<ReviewDraft> = fields<ReviewDraft>({
	pr: isPullRequest,
	head: isString,
	verdict: oneOf(REVIEW_VERDICTS),
	summary: isString,
	findings: arrayOf(isReviewFinding),
	savedAt: isNumber,
	posted: nullable(fields<PostedReview>({ id: isNumber, url: isString, at: isNumber })),
});

export const isReviewer: Guard<Reviewer> = fields<Reviewer>({ sessionId: isString, pr: isPullRequest });
