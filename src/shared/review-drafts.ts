/**
 * Review drafts collect findings from the Code tab or a Review session until the user accepts, edits, and posts them.
 * The dashboard posts the draft once, as one review pinned to the head commit it was written against.
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

/** The side of a diff a line is on: `LEFT` the base, `RIGHT` the head. */
export type DiffSide = "LEFT" | "RIGHT";

/** Who wrote a finding: the Review session through its tool, or the user from the Code tab. */
export const FINDING_SOURCES = ["review", "code"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export interface ReviewFinding {
	id: string;
	/** The file it is about, relative to the repository's root. */
	path: string;
	/** The last line on `side`; `null` for the file as a whole. */
	line: number | null;
	/** The first line of a range on `side`; `null` for one line or the whole file. */
	startLine: number | null;
	side: DiffSide;
	body: string;
	state: FindingState;
	source: FindingSource;
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
	/** The head commit the draft reviews, its full id; the review posts on it, and only while it is still the head. */
	head: string;
	verdict: ReviewVerdict;
	summary: string;
	findings: ReviewFinding[];
	/** When the draft was created or saved by a session, in ms since the epoch. */
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
	| { op: "add-finding"; pr: PullRequest; head: string; finding: Pick<ReviewFinding, "path" | "startLine" | "side" | "body"> & { line: number } }
	| ({ op: "finding"; pr: PullRequest } & Pick<ReviewFinding, "id" | "path" | "line" | "body" | "startLine" | "side">)
	| { op: "finding-state"; pr: PullRequest; ids: string[]; state: FindingState }
	| { op: "discard"; pr: PullRequest };

/**
 * A page's edit, or what the server does: a session saves a draft, a review posts, a session starts or resumes as another id.
 * An added finding carries `at`, when the server took it, the save time of a draft it starts.
 */
export type ReviewDraftChange =
	| Exclude<ReviewDraftEdit, { op: "add-finding" }>
	| (Extract<ReviewDraftEdit, { op: "add-finding" }> & { at: number })
	| { op: "save"; draft: ReviewDraft }
	| { op: "posted"; pr: PullRequest; head: string; review: PostedReview }
	| { op: "bind"; reviewer: Reviewer }
	| { op: "relink"; from: string; to: string };

/** The sessions the file remembers as reviewers, newest last: one resumed after that many later reviews loses the tool. */
const KEPT_REVIEWERS = 200;

/** What the composer's Submit review sets on the draft before it posts it. */
export interface ReviewSubmit {
	verdict: ReviewVerdict;
	summary: string;
}

/** The draft for `pr`, if any. */
export const reviewDraftOf = (drafts: readonly ReviewDraft[], pr: PullRequest): ReviewDraft | undefined => drafts.find(draft => samePullRequest(draft.pr, pr));

/** Whether `draft` waits on the user: saved and not posted. */
export const waitsOnYou = (draft: ReviewDraft | undefined): boolean => draft !== undefined && draft.posted === null;

/** How long a posted draft stays to show what posted: a later save of any draft drops it. */
const POSTED_KEPT_MS = 14 * 24 * 3_600_000;

/**
 * `state` after `change`, or `state` itself when it changes nothing. A posted draft takes only a new save or its discard.
 * A save keeps the findings the user wrote from the Code tab on an unposted draft of the same head, numbered after the session's.
 * A finding added to a posted draft, or to one on another head, throws instead, so the page never believes the comment was saved.
 */
export function applyReviewDraft(state: ReviewDraftState, change: ReviewDraftChange): ReviewDraftState {
	switch (change.op) {
		case "save": {
			const { pr, head, savedAt } = change.draft;
			const previous = reviewDraftOf(state.drafts, pr);
			const written = previous && previous.posted === null && previous.head === head ? previous.findings.filter(finding => finding.source === "code") : [];
			const draft = written.reduce((saved, finding) => ({ ...saved, findings: [...saved.findings, { ...finding, id: nextFindingId(saved.findings) }] }), change.draft);
			const kept = state.drafts.filter(other => !samePullRequest(other.pr, pr) && !(other.posted && other.posted.at < savedAt - POSTED_KEPT_MS));
			return { ...state, drafts: [...kept, draft] };
		}
		case "add-finding": {
			const draft = reviewDraftOf(state.drafts, change.pr);
			if (draft?.posted) throw new Error("The review draft is posted already; discard it to start a new one.");
			if (draft && draft.head !== change.head) throw new Error(`The review draft is on ${draft.head.slice(0, 7)}, not the head ${change.head.slice(0, 7)}; discard it to start a new one.`);
			const added: ReviewFinding = { id: nextFindingId(draft?.findings ?? []), ...change.finding, state: "pending", source: "code" };
			if (!draft) {
				return { ...state, drafts: [...state.drafts, { pr: change.pr, head: change.head, verdict: "comment", summary: "", findings: [added], savedAt: change.at, posted: null }] };
			}
			return mapDraft(state, change.pr, current => ({ ...current, findings: [...current.findings, added] }));
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

/** The id after the highest of `findings`, numbered `f1`, `f2`, and on as the review tool numbers them. */
function nextFindingId(findings: readonly ReviewFinding[]): string {
	return `f${Math.max(0, ...findings.map(finding => Number(/^f(\d+)$/.exec(finding.id)?.[1] ?? 0))) + 1}`;
}

function editDraft(draft: ReviewDraft, edit: Exclude<ReviewDraftEdit, { op: "discard" | "add-finding" }>): ReviewDraft {
	switch (edit.op) {
		case "verdict":
			return edit.verdict === draft.verdict ? draft : { ...draft, verdict: edit.verdict };
		case "summary":
			return edit.summary === draft.summary ? draft : { ...draft, summary: edit.summary };
		case "finding":
			return mapFindings(draft, finding =>
				finding.id !== edit.id || (finding.path === edit.path && finding.line === edit.line && finding.body === edit.body && finding.startLine === edit.startLine && finding.side === edit.side)
					? finding
					: { ...finding, path: edit.path, line: edit.line, body: edit.body, startLine: edit.startLine, side: edit.side },
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

/** The lines of each side of a changed file that its diff shows, by path. */
export type DiffLines = ReadonlyMap<string, Readonly<Record<DiffSide, ReadonlySet<number>>>>;

/** A file with no patch, binary or too large, has no lines to comment on. */
export function diffLinesOf(files: readonly { path: string; patch: string | null }[]): DiffLines {
	return new Map(files.map(({ path, patch }) => {
		const LEFT = new Set<number>();
		const RIGHT = new Set<number>();
		for (const row of patch ? parseFullDiff(patch) : []) {
			if (row.old !== null) LEFT.add(row.old);
			if (row.new !== null) RIGHT.add(row.new);
		}
		return [path, { LEFT, RIGHT }];
	}));
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export const REVIEW_EVENTS: Record<ReviewVerdict, ReviewEvent> = { approve: "APPROVE", "request-changes": "REQUEST_CHANGES", comment: "COMMENT" };

/** Whether a review that says `verdict` can post with `summary` and `lineComments` line comments: an approval always can, a request for changes needs a summary, and a comment needs something to say. */
export function canSubmitReview(verdict: ReviewVerdict, summary: string, lineComments: number): boolean {
	if (verdict === "approve") return true;
	if (verdict === "request-changes") return summary.trim() !== "";
	return summary.trim() !== "" || lineComments > 0;
}

/** A comment on a line or range on one side of the diff. */
export interface ReviewComment {
	path: string;
	line: number;
	side: DiffSide;
	start_line?: number;
	start_side?: DiffSide;
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
	const onDiff = (finding: ReviewFinding): finding is ReviewFinding & { line: number } => {
		if (finding.line === null) return false;
		const shown = lines.get(finding.path)?.[finding.side];
		if (!shown?.has(finding.line)) return false;
		for (let line = finding.startLine ?? finding.line; line <= finding.line; line++) {
			if (!shown.has(line)) return false;
		}
		return true;
	};
	const comments = accepted.filter(onDiff).map(({ path, line, body, startLine, side }): ReviewComment => ({
		path, line, side, body,
		...(startLine !== null && startLine < line ? { start_line: startLine, start_side: side } : {}),
	}));
	const folded = accepted.filter(finding => !onDiff(finding)).map(foldedItem);
	const body = [draft.summary.trim(), folded.join("\n")].filter(part => part !== "").join("\n\n");
	return { commit_id: draft.head, event: REVIEW_EVENTS[draft.verdict], body, comments };
}

/** Where a finding sits, as the draft and its preview name it: the path, then the line or range, marked when on the base side. */
export function findingLocation({ path, line, startLine, side }: Pick<ReviewFinding, "path" | "line" | "startLine" | "side">): string {
	return line === null ? path : `${path}:${startLine === null ? line : `${startLine}-${line}`}${side === "LEFT" ? " (base)" : ""}`;
}

/** A finding as a Markdown list item: its place in code, then its body, its later lines indented under the item. */
function foldedItem(finding: ReviewFinding): string {
	return `- \`${findingLocation(finding)}\`: ${finding.body.trim().replaceAll("\n", "\n  ")}`;
}

/**
 * Why `draft` cannot post while `head` heads the pull request, or `null` when it can: it posted already, the pull
 * request moved on since the session read it, or there is nothing to say.
 */
export function postRefusal(draft: ReviewDraft, head: string): string | null {
	if (draft.posted) return "This draft is posted already.";
	if (draft.head !== head) return `The pull request moved from ${draft.head.slice(0, 7)} to ${head.slice(0, 7)} since this review; run Review again on the new head.`;
	if (canSubmitReview(draft.verdict, draft.summary, draft.findings.filter(finding => finding.state === "accepted").length)) return null;
	return draft.verdict === "request-changes" ? "Requesting changes needs a summary." : "Accept a finding or write a summary first.";
}

/** What `GET /api/review-draft/preview` answers: what posting sends now, or why it cannot post. */
export interface ReviewPreview {
	payload: ReviewPayload;
	/** The pull request's head commit now. */
	head: string;
	refusal: string | null;
}

const isPullRequest = fields<PullRequest>({ owner: isString, repo: isString, number: isNumber });

/** A finding as `review-drafts.json` keeps it: one saved before line ranges has no `startLine`, `side`, or `source`. */
type StoredFinding = Omit<ReviewFinding, "startLine" | "side" | "source"> & { startLine?: number | null; side?: DiffSide; source?: FindingSource };

const isStoredFinding = fields<StoredFinding>({
	id: isString, path: isString, line: nullable(isNumber), body: isString, state: oneOf(FINDING_STATES),
	startLine: (value): value is number | null | undefined => value === undefined || value === null || isNumber(value),
	side: (value): value is DiffSide | undefined => value === undefined || value === "LEFT" || value === "RIGHT",
	source: (value): value is FindingSource | undefined => value === undefined || oneOf(FINDING_SOURCES)(value),
});

const isStoredDraft = fields<Omit<ReviewDraft, "findings"> & { findings: StoredFinding[] }>({
	pr: isPullRequest,
	head: isString,
	verdict: oneOf(REVIEW_VERDICTS),
	summary: isString,
	findings: arrayOf(isStoredFinding),
	savedAt: isNumber,
	posted: nullable(fields<PostedReview>({ id: isNumber, url: isString, at: isNumber })),
});

/** A draft as `review-drafts.json` keeps it, each finding the session's, on the head side, and on one line unless it says otherwise; `null` for anything else. */
export function decodeReviewDraft(value: unknown): ReviewDraft | null {
	if (!isStoredDraft(value)) return null;
	return { ...value, findings: value.findings.map(({ startLine = null, side = "RIGHT", source = "review", ...finding }) => ({ ...finding, startLine, side, source })) };
}

export const isReviewer: Guard<Reviewer> = fields<Reviewer>({ sessionId: isString, pr: isPullRequest });
