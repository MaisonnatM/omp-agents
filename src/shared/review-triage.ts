import { arrayOf, fields, isBoolean, isNonEmpty, isNumber, isObject, isSafeInteger, isString, nullable, oneOf, type Parsed, tagged } from "../json";
import { type PullRequest, samePullRequest } from "./github";

export const TRIAGE_TOOLS = { capture: "read_review_triage", report: "save_review_triage", application: "read_review_application", result: "save_review_application" } as const;
export const TRIAGE_VERDICTS = ["fix", "push-back", "already-done"] as const;
export const TRIAGE_DECISIONS = ["pending", "accepted", "dismissed"] as const;
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];
export type TriageMode = "comments" | "thermo";
export type TriageTarget = { kind: "pull-request"; pr: PullRequest } | { kind: "local-session"; sessionId: string };
export type TriageIntent = { kind: "capture"; mode: TriageMode; originSessionId: string | null; existingReport: boolean } | { kind: "apply"; id: string; batchId: string };

export interface TriageComment { id: string; body: string; author: string; updatedAt: string; url: string }
export type TriageSource =
	| { kind: "thread"; id: string; path: string; line: number | null; resolved: boolean; comments: TriageComment[] }
	| { kind: "review"; id: string; author: string; state: string; body: string; url: string; updatedAt: string }
	| { kind: "thermo"; id: string; number: number; reportId: string; path: string; line: number | null; body: string };
/** `dirty` and `untracked` digest each path's worktree content, `deleted` for a tracked path that is gone. */
export interface TriageCode { head: string; index: string; worktree: string; dirty: { path: string; digest: string }[]; untracked: { path: string; digest: string }[] }
export interface TriageSnapshot { code: TriageCode; sourceVersion: string }
export interface TriageAssessment { verdict: TriageVerdict; rationale: string; evidence: string; reply: string }
export interface TriageItem {
	id: string;
	source: TriageSource;
	assessment: TriageAssessment;
	decision: TriageDecision;
	/** User wording stays separate from the agent's assessment and immutable application result. */
	reply: string | null;
	replyRevision: number;
}
export type ReplyDestination = { kind: "thread"; threadId: string } | { kind: "review-note"; reviewId: string } | { kind: "thermo-note"; reportId: string; findingId: string };
export interface TriageSelection { id: string; source: TriageSource; assessment: TriageAssessment; reply: string; replyRevision: number; destination: ReplyDestination }
export type TriageResult = {
	id: string;
	reply: string;
	destination: ReplyDestination;
} & ({ outcome: "fixed"; changedFiles: string[]; evidence: string } | { outcome: "blocked"; reason: string } | { outcome: "reply-only"; evidence: string });
export type TriageApplication =
	| { phase: "reserved" }
	| { phase: "interrupted"; reason: string }
	| { phase: "running"; sessionId: string; instanceId: string; checked: boolean }
	| { phase: "completed"; sessionId: string; instanceId: string; results: TriageResult[] };
export interface TriageBatch { id: string; revision: number; selected: TriageSelection[]; at: number; application: TriageApplication }
/** The existing report a capture read: the first `size` bytes of its session file, which later turns only append to. */
export interface TriageOrigin { sessionId: string; file: string; size: number; digest: string }
export interface ReviewTriage {
	id: string;
	revision: number;
	target: TriageTarget;
	cwd: string;
	mode: TriageMode;
	origin: TriageOrigin | null;
	snapshot: TriageSnapshot;
	/** Complete census, including resolved threads. */
	sources: TriageSource[];
	items: TriageItem[];
	summary: string;
	/** Canonical submitted report. A retry cannot replace decisions or wording. */
	capture: string | null;
	savedAt: number;
	batch: TriageBatch | null;
}
export type TriageBinding = { sessionId: string; cwd: string } & (
	| { role: "capture"; target: TriageTarget; mode: TriageMode; id: string; originSessionId: string | null; existingReport: boolean }
	| { role: "apply"; id: string; batchId: string }
);
export interface ReviewTriageState { triages: ReviewTriage[]; bindings: TriageBinding[] }
export const NO_REVIEW_TRIAGES: ReviewTriageState = { triages: [], bindings: [] };
export interface ReviewTriagesAnswer { list: ReviewTriage[]; owner: string | null }
export type ReviewTriageEdit = { id: string; revision: number; itemId: string } & (
	| { op: "decision"; decision: TriageDecision }
	| { op: "reply"; text: string | null }
);
export interface ReviewTriageApply { id: string; revision: number }

export function sameTriageTarget(a: TriageTarget, b: TriageTarget): boolean {
	return a.kind === "pull-request" ? b.kind === "pull-request" && samePullRequest(a.pr, b.pr) : b.kind === "local-session" && a.sessionId === b.sessionId;
}
export const latestReviewTriage = (triages: readonly ReviewTriage[]): ReviewTriage | undefined => triages.findLast(triage => triage.capture !== null) ?? triages.at(-1);
export const needsTriageCheckout = (triage: ReviewTriage, triages: readonly ReviewTriage[]): boolean =>
	triage.capture !== null && triage.items.length > 0 && triage.batch?.application.phase !== "completed"
	&& triages.findLast(other => other.capture !== null && other.mode === triage.mode && sameTriageTarget(other.target, triage.target))?.id === triage.id;
export const replyDestination = (source: TriageSource): ReplyDestination => source.kind === "thread"
	? { kind: "thread", threadId: source.id }
	: source.kind === "review" ? { kind: "review-note", reviewId: source.id } : { kind: "thermo-note", reportId: source.reportId, findingId: source.id };
export function replyOf(item: TriageItem, triage: ReviewTriage): string {
	const batch = triage.batch;
	const selected = batch?.selected.find(selected => selected.id === item.id);
	if (batch?.application.phase === "completed" && selected && (item.reply === null || item.replyRevision <= selected.replyRevision)) {
		return batch.application.results.find(result => result.id === item.id)?.reply ?? item.assessment.reply;
	}
	return item.reply ?? item.assessment.reply;
}

export function editReviewTriage(triage: ReviewTriage, edit: ReviewTriageEdit): ReviewTriage {
	if (triage.revision !== edit.revision) throw new Error("This triage changed. Read the latest cards and try again.");
	if (triage.capture === null) throw new Error("The report is still being captured.");
	if (edit.op === "decision" && triage.batch) throw new Error("This selection is frozen in an application batch. Capture a new report for another selection.");
	const item = triage.items.find(item => item.id === edit.itemId);
	if (!item) throw new Error("This triage has no such item.");
	const changed = edit.op === "decision" ? { ...item, decision: edit.decision } : { ...item, reply: edit.text, replyRevision: item.replyRevision + 1 };
	return { ...triage, revision: triage.revision + 1, items: triage.items.map(held => held === item ? changed : held) };
}

export function reserveTriage(triage: ReviewTriage, revision: number, id: string, at: number, snapshot: TriageSnapshot): ReviewTriage {
	if (triage.batch) return triage;
	if (triage.revision !== revision) throw new Error("This triage changed. Read the latest cards and try again.");
	if (triage.capture === null) throw new Error("Wait for the complete report.");
	if (JSON.stringify(triage.snapshot) !== JSON.stringify(snapshot)) throw new Error("Code or feedback changed since this review. Capture a new triage before applying.");
	const selected = triage.items.filter(item => item.decision === "accepted").map((item): TriageSelection => ({ id: item.id, source: item.source, assessment: item.assessment, reply: replyOf(item, triage), replyRevision: item.replyRevision, destination: replyDestination(item.source) }));
	if (!selected.length) throw new Error("Accept at least one proposed handling first.");
	return { ...triage, revision: triage.revision + 1, batch: { id, revision, selected, at, application: { phase: "reserved" } } };
}

export function completeTriage(triage: ReviewTriage, results: TriageResult[]): ReviewTriage {
	const batch = triage.batch;
	if (!batch || (batch.application.phase !== "running" && batch.application.phase !== "completed")) throw new Error("This application has no bound session.");
	if (batch.application.phase === "completed") {
		if (JSON.stringify(batch.application.results) === JSON.stringify(results)) return triage;
		throw new Error("Application evidence is immutable. Edit reply wording on the card instead.");
	}
	if (!batch.application.checked) throw new Error("Read the application and check freshness before reporting results.");
	if (results.length !== batch.selected.length || new Set(results.map(result => result.id)).size !== results.length) throw new Error("Return exactly one result per selected item.");
	for (const selected of batch.selected) {
		const result = results.find(result => result.id === selected.id);
		if (!result || JSON.stringify(result.destination) !== JSON.stringify(selected.destination)) throw new Error("Each result must keep its bound source destination.");
		if (selected.assessment.verdict !== "fix" && result.outcome !== "reply-only") throw new Error("Accepted push-back and already-done items are reply-only.");
		if (selected.assessment.verdict === "fix" && result.outcome === "reply-only") throw new Error("An accepted fix must be fixed or blocked.");
		if (result.outcome === "fixed" && (!result.changedFiles.length || result.changedFiles.some(path => !isNonEmpty(path)) || !isNonEmpty(result.evidence))) throw new Error("A fixed result needs changed files and code/check evidence.");
		if (result.outcome === "blocked" && !isNonEmpty(result.reason)) throw new Error("A blocked result needs a reason.");
	}
	return { ...triage, revision: triage.revision + 1, batch: { ...batch, application: { phase: "completed", sessionId: batch.application.sessionId, instanceId: batch.application.instanceId, results } } };
}

export function parseTriageApply(value: unknown): Parsed<ReviewTriageApply> {
	return isObject(value) && isNonEmpty(value.id) && isSafeInteger(value.revision) && value.revision >= 0 && Object.keys(value).every(key => key === "id" || key === "revision") ? { ok: { id: value.id, revision: value.revision } } : null;
}
export function parseTriageEdit(value: unknown): Parsed<ReviewTriageEdit> {
	if (!isObject(value) || !isNonEmpty(value.id) || !isSafeInteger(value.revision) || value.revision < 0 || !isNonEmpty(value.itemId)) return null;
	const common = { id: value.id, revision: value.revision, itemId: value.itemId };
	if (value.op === "decision" && oneOf(TRIAGE_DECISIONS)(value.decision)) return { ok: { ...common, op: "decision", decision: value.decision } };
	if (value.op === "reply" && (value.text === null || typeof value.text === "string" && value.text.length <= 65536)) return { ok: { ...common, op: "reply", text: value.text } };
	return null;
}

const isPr = fields<PullRequest>({ owner: isNonEmpty, repo: isNonEmpty, number: isSafeInteger });
export const isTriageTarget = tagged<TriageTarget, "kind">("kind", { "pull-request": { pr: isPr }, "local-session": { sessionId: isNonEmpty } });
const isComment = fields<TriageComment>({ id: isNonEmpty, body: isString, author: isString, updatedAt: isString, url: isString });
const isRevision = (value: unknown): value is number => isSafeInteger(value) && value >= 0;
const isFindingNumber = (value: unknown): value is number => isSafeInteger(value) && value > 0;
export const isTriageSource = tagged<TriageSource, "kind">("kind", {
	thread: { id: isNonEmpty, path: isString, line: nullable(isNumber), resolved: isBoolean, comments: arrayOf(isComment) },
	review: { id: isNonEmpty, author: isString, state: isNonEmpty, body: isNonEmpty, url: isString, updatedAt: isString },
	thermo: { id: isNonEmpty, number: isFindingNumber, reportId: isNonEmpty, path: isString, line: nullable(isNumber), body: isNonEmpty },
});
export const isTriageAssessment = fields<TriageAssessment>({ verdict: oneOf(TRIAGE_VERDICTS), rationale: isNonEmpty, evidence: isNonEmpty, reply: isNonEmpty });
const isItem = fields<TriageItem>({ id: isNonEmpty, source: isTriageSource, assessment: isTriageAssessment, decision: oneOf(TRIAGE_DECISIONS), reply: nullable(isString), replyRevision: isRevision });
const isDestination = tagged<ReplyDestination, "kind">("kind", { thread: { threadId: isNonEmpty }, "review-note": { reviewId: isNonEmpty }, "thermo-note": { reportId: isNonEmpty, findingId: isNonEmpty } });
const isSelection = fields<TriageSelection>({ id: isNonEmpty, source: isTriageSource, assessment: isTriageAssessment, reply: isString, replyRevision: isRevision, destination: isDestination });
export const isTriageResult = tagged<TriageResult, "outcome">("outcome", {
	fixed: { id: isNonEmpty, reply: isNonEmpty, destination: isDestination, changedFiles: arrayOf(isNonEmpty), evidence: isNonEmpty },
	blocked: { id: isNonEmpty, reply: isNonEmpty, destination: isDestination, reason: isNonEmpty },
	"reply-only": { id: isNonEmpty, reply: isNonEmpty, destination: isDestination, evidence: isNonEmpty },
});
const isApplication = tagged<TriageApplication, "phase">("phase", {
	reserved: {}, interrupted: { reason: isNonEmpty }, running: { sessionId: isNonEmpty, instanceId: isNonEmpty, checked: isBoolean }, completed: { sessionId: isNonEmpty, instanceId: isNonEmpty, results: arrayOf(isTriageResult) },
});
const isPathDigests = arrayOf(fields({ path: isString, digest: isString }));
export const isTriageSnapshot = fields<TriageSnapshot>({ code: fields<TriageCode>({ head: isNonEmpty, index: isString, worktree: isString, dirty: isPathDigests, untracked: isPathDigests }), sourceVersion: isString });
export const isReviewTriage = fields<ReviewTriage>({
	id: isNonEmpty, revision: isSafeInteger, target: isTriageTarget, cwd: isNonEmpty, mode: oneOf(["comments", "thermo"]),
	origin: nullable(fields<TriageOrigin>({ sessionId: isNonEmpty, file: isNonEmpty, size: isSafeInteger, digest: isNonEmpty })),
	snapshot: isTriageSnapshot, sources: arrayOf(isTriageSource), items: arrayOf(isItem), summary: isString, capture: nullable(isString), savedAt: isNumber,
	batch: nullable(fields<TriageBatch>({ id: isNonEmpty, revision: isSafeInteger, selected: arrayOf(isSelection), at: isNumber, application: isApplication })),
});
const isBinding = tagged<TriageBinding, "role">("role", {
	capture: { sessionId: isNonEmpty, cwd: isNonEmpty, target: isTriageTarget, mode: oneOf(["comments", "thermo"]), id: isNonEmpty, originSessionId: nullable(isNonEmpty), existingReport: isBoolean },
	apply: { sessionId: isNonEmpty, cwd: isNonEmpty, id: isNonEmpty, batchId: isNonEmpty },
});
export const isReviewTriageState = fields<ReviewTriageState>({ triages: arrayOf(isReviewTriage), bindings: arrayOf(isBinding) });
