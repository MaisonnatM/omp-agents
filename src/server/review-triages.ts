import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonical, worktreeAt } from "../git";
import { isNonEmpty, isObject, isSafeInteger } from "../json";
import type { RpcHostTool } from "../omp/modules";
import { changedPaths, readTriageCode, readTriageGitHub, sourceVersion, triageCheckout, triageDigest, type TriageGitHubInput } from "../review-triage-input";
import type { PullRequest } from "../shared/github";
import {
	completeTriage,
	editReviewTriage,
	isTriageAssessment,
	isTriageResult,
	needsTriageCheckout,
	reserveTriage,
	sameTriageTarget,
	TRIAGE_TOOLS,
	TRIAGE_VERDICTS,
	type ReplyDestination,
	type ReviewTriage,
	type ReviewTriageApply,
	type ReviewTriageEdit,
	type ReviewTriagesAnswer,
	type TriageBinding,
	type TriageCode,
	type TriageItem,
	type TriageOrigin,
	type TriageMode,
	type TriageResult,
	type TriageSnapshot,
	type TriageSource,
} from "../shared/review-triage";
import { newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import type { ProjectJoin } from "./project-runner";
import type { ReviewTriagesFile } from "./review-triages-file";

export const TRIAGE_CAPTURE_PROMPT = `Use ${TRIAGE_TOOLS.capture} first. Read the bound code and original feedback. For an existing session report, read the original session file the tool supplies and preserve each finding's original number, words, and evidence; do not replace it with a new review. For a new thermo review, use thermonuclear-reviewer read-only and request its structured findings. Assess every source as fix, push-back, or already-done, with rationale and concrete evidence. Draft a reply for every item using the maxence-voice skill. Save the complete structured report with ${TRIAGE_TOOLS.report}. Wait for the user's decisions on the Review triage cards. Do not edit code, commit, push, post replies, resolve threads, change PR descriptions, or create a PR.`;
export const TRIAGE_APPLY_PROMPT = `Use ${TRIAGE_TOOLS.application} before your first edit. It returns the immutable accepted selection and the exact reviewed checkout. Only codeTasks authorize code changes. For those tasks, preserve all unrelated staged, unstaged, and untracked user work, implement the accepted fixes, and run the project's checks. Reply-only items authorize wording only. Read the maxence-voice skill and draft one reply or finding note per selected item. Report fixed with changed files and concrete code/check evidence, blocked with a reason, or reply-only with evidence through ${TRIAGE_TOOLS.result}. Do not commit, push, post anything on GitHub, resolve threads, edit PR descriptions, or create a PR. This session has ordinary shell access, not a sandbox.`;

export interface TriageOriginFile {
	cwd: string;
	file: string;
}

export interface ReviewTriagesDeps {
	file: ReviewTriagesFile;
	/** Takes or confirms the owner lock: whether this server may change triages and start their sessions now. */
	acquire(): boolean;
	/** The owner dashboard's address while another server holds the lock, else `null`. */
	owner(): string | null;
	start(request: StartRequest): Promise<StartResult>;
	/** Resumes `sessionId` unless it already runs; rejects when it cannot. */
	resume(sessionId: string): Promise<void>;
	origin(sessionId: string): TriageOriginFile | null;
	/** Why another live session may still edit `cwd`'s checkout, or `null`. */
	conflict(cwd: string, exceptSessionId: string | null): Promise<string | null>;
	/** Triages changed other than through a page's edit, which the list registry publishes itself. */
	onChange(): void;
	now(): number;
	newId(): string;
	github(pr: PullRequest): Promise<TriageGitHubInput>;
	code(cwd: string): Promise<TriageCode>;
	checkout(cwd: string, pr: PullRequest, input: TriageGitHubInput, id: string): Promise<string>;
}

export const TRIAGE_IO: Pick<ReviewTriagesDeps, "now" | "newId" | "github" | "code" | "checkout"> = {
	now: Date.now,
	newId: randomUUID,
	github: readTriageGitHub,
	code: readTriageCode,
	checkout: triageCheckout,
};

type CaptureBinding = Extract<TriageBinding, { role: "capture" }>;
type ApplyBinding = Extract<TriageBinding, { role: "apply" }>;

export class ReviewTriages {
	readonly #deps: ReviewTriagesDeps;
	readonly #applying = new Map<string, Promise<ReviewTriage>>();
	readonly #reading = new Map<string, Promise<ReviewTriage>>();
	readonly #sessionIdByInstance = new Map<string, string>();

	constructor(deps: ReviewTriagesDeps) {
		this.#deps = deps;
	}

	get answer(): ReviewTriagesAnswer {
		return { list: this.#deps.file.value.triages, owner: this.#deps.owner() };
	}

	async keepCheckout(cwd: string): Promise<string | null> {
		let triages: ReviewTriage[];
		try { triages = this.#deps.file.read().triages; }
		catch (error) { return `Review triage checkout references are unavailable. Retaining this checkout until the file is repaired. ${error instanceof Error ? error.message : String(error)}`; }
		const needed = triages.filter(triage => needsTriageCheckout(triage, triages));
		if (!needed.length) return null;
		const at = await worktreeAt(cwd);
		if (!at?.linked) return null;
		const top = await canonical(at.top);
		for (const triage of needed) {
			const reviewed = await worktreeAt(triage.cwd);
			if (reviewed && await canonical(reviewed.top) === top) return `Review triage ${triage.id} still needs this checkout for its accepted application.`;
		}
		return null;
	}

	/** A page's decision or reply edit; the list registry publishes the change. */
	edit(edit: ReviewTriageEdit): boolean {
		return this.#write(edit.id, triage => editReviewTriage(triage, edit));
	}

	/** A pull request capture runs in a checkout of its head; everything else keeps the exact checkout it names, dirty work included. */
	async prepare(request: StartRequest): Promise<StartRequest> {
		if (request.kind !== "new" || !request.reviewTriage) return request;
		this.#assertOwner();
		if (request.reviewTriage.kind === "apply") {
			const triage = this.#triage(request.reviewTriage.id);
			if (triage.batch?.id !== request.reviewTriage.batchId || triage.batch.application.phase !== "reserved") throw new Error("This application is not reserved for a new session.");
			return { ...request, cwd: triage.cwd, branch: null, skill: null };
		}
		if (request.subject?.kind !== "pull-request") return { ...request, branch: null };
		const input = await this.#deps.github(request.subject.pr);
		const cwd = await this.#deps.checkout(request.cwd, request.subject.pr, input, this.#deps.newId());
		return { ...request, cwd, branch: null };
	}

	/** Starts a capture bound to session `sessionId`'s checkout: of its existing findings, or of a new thermonuclear review. */
	async startFromSession(sessionId: string, existingReport: boolean): Promise<StartResult> {
		this.#assertOwner();
		const origin = this.#deps.origin(sessionId);
		if (!origin) throw new Error("The originating session file or checkout is unavailable.");
		return this.#deps.start(newSessionRequest(origin.cwd, TRIAGE_CAPTURE_PROMPT, { reviewTriage: { kind: "capture", mode: "thermo", originSessionId: sessionId, existingReport } }));
	}

	/** `join` with the triage tools for a triage start or the resume of a bound session, which is bound before its first prompt. */
	join(request: StartRequest, join: ProjectJoin): ProjectJoin {
		const binding = this.#bindingFor(request);
		if (!binding) return join;
		let bound = binding;
		const current = (): TriageBinding => this.#deps.file.read().bindings.find(held => held.role === bound.role && held.id === bound.id && (held.role !== "apply" || bound.role !== "apply" || held.batchId === bound.batchId)) ?? bound;
		return {
			rpc: { ...join.rpc, tools: [...join.rpc.tools, ...(bound.role === "capture" ? this.#captureTools(current, bound.mode) : this.#applyTools(current))] },
			attach: session => {
				join.attach(session);
				this.#sessionIdByInstance.set(session.instanceId, session.sessionId);
				if (!this.#deps.acquire()) return;
				bound = { ...bound, cwd: session.cwd, sessionId: session.sessionId };
				if (bound.role === "capture" && bound.target.kind === "local-session" && bound.target.sessionId === "") bound = { ...bound, target: { kind: "local-session", sessionId: session.sessionId } };
				const held = bound;
				this.#deps.file.update(state => ({
					bindings: [...state.bindings.filter(other => other.sessionId !== session.sessionId), held],
					triages: held.role === "apply" ? state.triages.map(triage => (triage.id === held.id ? bindApplication(triage, held.batchId, session) : triage)) : state.triages,
				}));
				this.#deps.onChange();
			},
		};
	}

	/** Live session `instanceId` now runs as `sessionId`; its binding and application follow it. */
	switched(instanceId: string, sessionId: string): void {
		const from = this.#sessionIdByInstance.get(instanceId);
		if (from === undefined || from === sessionId) return;
		this.#sessionIdByInstance.set(instanceId, sessionId);
		if (!this.#deps.acquire()) return;
		const moved = this.#deps.file.update(state => ({
			bindings: state.bindings.map(binding => (binding.sessionId === from ? { ...binding, sessionId } : binding)),
			triages: state.triages.map(triage => {
				const application = triage.batch?.application;
				if (!triage.batch || !application || (application.phase !== "running" && application.phase !== "completed") || application.sessionId !== from) return triage;
				return { ...triage, batch: { ...triage.batch, application: { ...application, sessionId } } };
			}),
		}));
		if (moved) this.#deps.onChange();
	}

	exited(instanceId: string): void {
		this.#sessionIdByInstance.delete(instanceId);
	}

	/**
	 * Freezes the accepted items of triage `request.id` at `request.revision` into one batch and starts its session. A repeat
	 * returns that batch: resuming its known session, never starting a second; a launch with no known session stays interrupted.
	 */
	apply(request: ReviewTriageApply): Promise<ReviewTriage> {
		const running = this.#applying.get(request.id);
		if (running) return running;
		const applying = this.#apply(request).finally(() => this.#applying.delete(request.id));
		this.#applying.set(request.id, applying);
		return applying;
	}

	async #apply(request: ReviewTriageApply): Promise<ReviewTriage> {
		this.#assertOwner();
		let triage = this.#triage(request.id);
		if (triage.batch) {
			const application = triage.batch.application;
			if (application.phase === "completed") return triage;
			if (application.phase === "running") {
				await this.#deps.resume(application.sessionId);
				return this.#triage(triage.id);
			}
			if (application.phase === "reserved") triage = this.#change(triage.id, held => interrupt(held, "The previous launch has no known session. Check the running sessions before you capture a new triage; this batch does not start again by itself."));
			throw new Error(triage.batch?.application.phase === "interrupted" ? triage.batch.application.reason : "This application's launch was interrupted.");
		}
		await this.#refuseConflict(triage.cwd, null);
		const snapshot = await this.#fresh(triage);
		triage = this.#change(triage.id, held => reserveTriage(held, request.revision, this.#deps.newId(), this.#deps.now(), snapshot));
		const batch = triage.batch!;
		try {
			const subject = triage.target.kind === "pull-request" ? ({ kind: "pull-request", pr: triage.target.pr } as const) : null;
			const result = await this.#deps.start(newSessionRequest(triage.cwd, TRIAGE_APPLY_PROMPT, { subject, reviewTriage: { kind: "apply", id: triage.id, batchId: batch.id } }));
			if (!result.ok) throw new Error(result.error);
			if (this.#triage(triage.id).batch?.application.phase === "reserved") throw new Error("The session started without a durable triage binding.");
			return this.#triage(triage.id);
		} catch (error) {
			this.#change(triage.id, held => (held.batch?.application.phase === "reserved" ? interrupt(held, `The launch failed: ${error instanceof Error ? error.message : String(error)}. It does not start again by itself.`) : held));
			throw error;
		}
	}

	#assertOwner(): void {
		if (!this.#deps.acquire()) throw new Error(`Review triage changes belong to the owner dashboard at ${this.#deps.owner() ?? "another port"}. Open it to continue.`);
		this.#deps.file.read();
	}

	#triage(id: string): ReviewTriage {
		const triage = this.#deps.file.read().triages.find(each => each.id === id);
		if (!triage) throw new Error("This review triage is unavailable.");
		return triage;
	}

	#write(id: string, next: (triage: ReviewTriage) => ReviewTriage): boolean {
		this.#assertOwner();
		return this.#deps.file.update(state => {
			const current = state.triages.find(triage => triage.id === id);
			if (!current) throw new Error("This review triage is unavailable.");
			const changed = next(current);
			return changed === current ? state : { ...state, triages: state.triages.map(triage => (triage === current ? changed : triage)) };
		});
	}

	#change(id: string, next: (triage: ReviewTriage) => ReviewTriage): ReviewTriage {
		if (this.#write(id, next)) this.#deps.onChange();
		return this.#triage(id);
	}

	#bindingFor(request: StartRequest): TriageBinding | null {
		if (request.kind === "resume") return this.#deps.file.value.bindings.find(binding => binding.sessionId === request.sessionId) ?? null;
		if (request.kind !== "new" || !request.reviewTriage) return null;
		const intent = request.reviewTriage;
		if (intent.kind === "apply") return { role: "apply", id: intent.id, batchId: intent.batchId, cwd: request.cwd, sessionId: "" };
		const target = request.subject?.kind === "pull-request" ? ({ kind: "pull-request", pr: request.subject.pr } as const) : ({ kind: "local-session", sessionId: intent.originSessionId ?? "" } as const);
		return { role: "capture", id: this.#deps.newId(), mode: intent.mode, originSessionId: intent.originSessionId, existingReport: intent.existingReport, cwd: request.cwd, sessionId: "", target };
	}

	async #refuseConflict(cwd: string, exceptSessionId: string | null): Promise<void> {
		const conflict = await this.#deps.conflict(cwd, exceptSessionId);
		if (conflict) throw new Error(conflict);
	}

	async #fresh(triage: ReviewTriage): Promise<TriageSnapshot> {
		if (triage.origin && !(await sameOrigin(triage.origin))) throw new Error("The original report changed. Capture its findings again before applying.");
		const latest = this.#deps.file.read().triages.filter(other => other.mode === triage.mode && sameTriageTarget(other.target, triage.target) && (other.capture !== null || triage.capture === null && other.id === triage.id)).at(-1);
		if (latest?.id !== triage.id) throw new Error("A newer report replaced this one. Use the latest triage.");
		const code = await this.#deps.code(triage.cwd);
		if (triage.target.kind === "local-session") return { code, sourceVersion: triage.snapshot.sourceVersion };
		const current = await this.#deps.github(triage.target.pr);
		if (current.head !== code.head) throw new Error("The reviewed checkout no longer matches the pull request head.");
		return { code, sourceVersion: sourceVersion(current.sources) };
	}

	async #capture(binding: CaptureBinding): Promise<ReviewTriage> {
		this.#assertOwner();
		const held = this.#deps.file.read().triages.find(triage => triage.id === binding.id);
		if (held) return held;
		const pending = this.#reading.get(binding.id);
		if (pending) return pending;
		const reading = this.#read(binding).finally(() => this.#reading.delete(binding.id));
		this.#reading.set(binding.id, reading);
		return reading;
	}

	async #read(binding: CaptureBinding): Promise<ReviewTriage> {
		const [code, github] = await Promise.all([this.#deps.code(binding.cwd), binding.target.kind === "pull-request" ? this.#deps.github(binding.target.pr) : null]);
		if (github && code.head !== github.head) throw new Error("The checkout does not match the pull request head. Start triage again.");
		const sources = github?.sources ?? [];
		let origin: TriageOrigin | null = null;
		if (binding.originSessionId && binding.existingReport) {
			const found = this.#deps.origin(binding.originSessionId);
			if (!found) throw new Error("The original report file is unavailable.");
			const bytes = await readFile(found.file);
			origin = { sessionId: binding.originSessionId, file: found.file, size: bytes.length, digest: triageDigest(bytes) };
		}
		const triage: ReviewTriage = { id: binding.id, revision: 0, target: binding.target, cwd: binding.cwd, mode: binding.mode, origin, snapshot: { code, sourceVersion: sourceVersion(sources) }, sources, items: [], summary: "", capture: null, savedAt: this.#deps.now(), batch: null };
		this.#assertOwner();
		if (this.#deps.file.update(state => (state.triages.some(other => other.id === triage.id) ? state : { ...state, triages: [...state.triages, triage] }))) this.#deps.onChange();
		return this.#triage(binding.id);
	}

	async #save(binding: CaptureBinding, params: Record<string, unknown>): Promise<string> {
		const triage = this.#triage(binding.id);
		const payload = JSON.stringify(params);
		if (triage.capture !== null) {
			if (triage.capture !== payload) throw new Error("This capture is complete and immutable. Start a new triage for changed findings.");
			return "This report is already saved. User decisions and reply edits are unchanged.";
		}
		if (typeof params.summary !== "string" || params.summary.length > 65536 || !Array.isArray(params.items)) throw new Error("Expected a summary and a complete items list.");
		const reportId = triage.origin?.sessionId ?? triage.id;
		const ids = new Set<string>();
		const items: TriageItem[] = params.items.map((raw: unknown, index): TriageItem => {
			if (!isObject(raw) || !isTriageAssessment(raw.assessment)) throw new Error(`Item ${index + 1} needs verdict, rationale, evidence, and reply.`);
			let source: TriageSource;
			if (triage.mode === "comments") {
				const held = triage.sources.find(each => each.id === raw.sourceId);
				if (!held || held.kind === "thermo" || Object.keys(raw).some(key => key !== "sourceId" && key !== "assessment")) throw new Error("Each comment assessment must name a captured thread or review id and contain only sourceId and assessment.");
				source = held;
			} else {
				const line = raw.line;
				if (Object.keys(raw).some(key => !["number", "path", "line", "feedback", "assessment"].includes(key)) || !isSafeInteger(raw.number) || raw.number < 1 || !isNonEmpty(raw.feedback) || typeof raw.path !== "string" || (line !== null && !(typeof line === "number" && Number.isSafeInteger(line) && line >= 1))) throw new Error("Thermo findings need a positive original number, original feedback, a path, and a line or null, with no comment sourceId.");
				source = { kind: "thermo", id: `f${raw.number}`, number: raw.number, reportId, path: raw.path, line, body: raw.feedback };
			}
			if (ids.has(source.id)) throw new Error("A source can appear only once in a report.");
			ids.add(source.id);
			return { id: source.id, source, assessment: raw.assessment, decision: "pending", reply: null, replyRevision: 0 };
		});
		if (triage.mode === "comments" && items.length !== triage.sources.length) throw new Error("Assess every captured thread and nonempty review body, including resolved threads, exactly once.");
		const fresh = await this.#fresh(triage);
		if (JSON.stringify(fresh) !== JSON.stringify(triage.snapshot)) throw new Error("Code or feedback changed during review. Start a new triage.");
		const summary = params.summary;
		this.#change(triage.id, held => {
			if (held.capture === payload) return held;
			if (held.capture !== null) throw new Error("This capture is already complete.");
			return { ...held, revision: held.revision + 1, items, summary, capture: payload, savedAt: this.#deps.now() };
		});
		return `Saved ${items.length} proposed handlings. They wait on Review triage cards. Do not apply or post anything.`;
	}

	#captureTools(current: () => TriageBinding, mode: TriageMode): RpcHostTool[] {
		const capture = (): CaptureBinding => {
			const bound = current();
			if (bound.role !== "capture") throw new Error("Not a capture session.");
			return bound;
		};
		return [
			{
				name: TRIAGE_TOOLS.capture,
				label: "Read review triage",
				description: "Read the host-bound target, reviewed code snapshot, complete feedback census, and original report file. Call before reviewing. Identity and source data come from the host, not the model.",
				parameters: EMPTY,
				loadMode: "essential",
				execute: async () => {
					const triage = await this.#capture(capture());
					const originalReport = triage.origin && { ...triage.origin, instruction: `Read the original findings in the first ${triage.origin.size} bytes of this session file. Preserve the original number in number and the original words in feedback. Do not run a replacement review.` };
					return JSON.stringify({ triage, originalReport });
				},
			},
			{
				name: TRIAGE_TOOLS.report,
				label: "Save review triage",
				description: mode === "comments"
					? "Save the complete report with one {sourceId, assessment} per captured thread and nonempty review body. The host binds each canonical source. Read maxence-voice before drafting replies. A completed capture may only be retried identically."
					: "Save the complete thermo report with {number, path, line, feedback, assessment} per finding. Preserve positive unique original numbers and unchanged feedback wording. Read maxence-voice before drafting replies. A completed capture may only be retried identically.",
				parameters: mode === "comments" ? COMMENTS_REPORT_SCHEMA : THERMO_REPORT_SCHEMA,
				loadMode: "essential",
				execute: async params => this.#save(capture(), params),
			},
		];
	}

	#applyTools(current: () => TriageBinding): RpcHostTool[] {
		const bound = (): ApplyBinding => {
			const binding = current();
			if (binding.role !== "apply") throw new Error("Not an application session.");
			return binding;
		};
		return [
			{
				name: TRIAGE_TOOLS.application,
				label: "Read accepted application",
				description: "Check freshness before the first edit and read the immutable accepted batch. Only codeTasks authorize changes. Reply-only items must not cause edits. No pushing, posting, resolution, or PR writes are authorized.",
				parameters: EMPTY,
				loadMode: "essential",
				execute: async () => {
					this.#assertOwner();
					const binding = bound();
					let triage = this.#triage(binding.id);
					if (triage.batch?.id !== binding.batchId || triage.batch.application.phase !== "running") throw new Error("The application is not running.");
					if (!triage.batch.application.checked) {
						await this.#refuseConflict(triage.cwd, binding.sessionId);
						const fresh = await this.#fresh(triage);
						if (JSON.stringify(fresh) !== JSON.stringify(triage.snapshot)) throw new Error("Code or feedback changed before the first edit. Stop and capture a new triage.");
						triage = this.#change(triage.id, held => (held.batch?.application.phase === "running" ? { ...held, batch: { ...held.batch, application: { ...held.batch.application, checked: true } } } : held));
					}
					const selected = triage.batch!.selected;
					return JSON.stringify({ cwd: triage.cwd, snapshot: triage.snapshot, selected, codeTasks: selected.filter(item => item.assessment.verdict === "fix"), replyOnly: selected.filter(item => item.assessment.verdict !== "fix") });
				},
			},
			{
				name: TRIAGE_TOOLS.result,
				label: "Save application results",
				description: "Save exactly one fixed, blocked, or reply-only result for every selected id. The host supplies each real thread, review note, or thermo note destination. Review bodies have copyable notes, not thread replies. Fixed requires changedFiles this application changed since the reviewed snapshot, not files that were already dirty, and concrete code/check evidence. Evidence is immutable; replies remain editable on cards.",
				parameters: RESULT_SCHEMA,
				loadMode: "essential",
				execute: async params => {
					const binding = bound();
					const triage = this.#triage(binding.id);
					const batch = triage.batch;
					if (batch?.id !== binding.batchId || !Array.isArray(params.results)) throw new Error("Expected results for this bound batch.");
					const results = params.results.map((raw: unknown): TriageResult => {
						const selected = isObject(raw) ? batch.selected.find(item => item.id === raw.id) : undefined;
						if (!isObject(raw) || !selected) throw new Error("Each result must name an item of the bound batch.");
						const result = resultOf(raw, selected.destination);
						if (!result) throw new Error(`Result ${selected.id}: fixed needs changedFiles and evidence, blocked a reason, reply-only evidence, and every result a reply.`);
						return result;
					});
					const fixed = results.flatMap(result => (result.outcome === "fixed" ? result.changedFiles : []));
					if (fixed.length) {
						const now = await this.#deps.code(triage.cwd);
						if (now.head !== triage.snapshot.code.head) throw new Error("The checkout's HEAD moved since the review. The application must not commit; report results against the reviewed head.");
						const changed = changedPaths(triage.snapshot.code, now);
						const missing = fixed.find(path => !changed.has(path));
						if (missing !== undefined) throw new Error(`${missing} has no change since the review. Report only the files this application changed.`);
					}
					this.#change(triage.id, held => completeTriage(held, results));
					return "Saved application evidence and draft replies. Nothing was posted by this tool. The user can edit and copy replies from Review triage.";
				},
			},
		];
	}
}

function interrupt(triage: ReviewTriage, reason: string): ReviewTriage {
	return triage.batch ? { ...triage, batch: { ...triage.batch, application: { phase: "interrupted", reason } } } : triage;
}

function bindApplication(triage: ReviewTriage, batchId: string, session: { sessionId: string; instanceId: string }): ReviewTriage {
	const batch = triage.batch;
	if (batch?.id !== batchId) throw new Error("The application batch changed.");
	const application = batch.application;
	if (application.phase === "completed" || application.phase === "interrupted") return triage;
	const checked = application.phase === "running" && application.checked;
	return { ...triage, batch: { ...batch, application: { phase: "running", sessionId: session.sessionId, instanceId: session.instanceId, checked } } };
}

async function sameOrigin(origin: TriageOrigin): Promise<boolean> {
	const bytes = await readFile(origin.file).catch(() => null);
	return bytes !== null && bytes.length >= origin.size && triageDigest(bytes.subarray(0, origin.size)) === origin.digest;
}

function resultOf(raw: Record<string, unknown>, destination: ReplyDestination): TriageResult | null {
	const base = { id: raw.id, reply: raw.reply, destination };
	const result =
		raw.outcome === "fixed"
			? { ...base, outcome: "fixed", changedFiles: Array.isArray(raw.changedFiles) ? raw.changedFiles.map(path => (typeof path === "string" ? path.replace(/^\.\//, "") : path)) : raw.changedFiles, evidence: raw.evidence }
			: raw.outcome === "blocked"
				? { ...base, outcome: "blocked", reason: raw.reason }
				: { ...base, outcome: raw.outcome, evidence: raw.evidence };
	return isTriageResult(result) ? result : null;
}

const EMPTY = { type: "object", properties: {}, required: [], additionalProperties: false };
const NULLABLE_STRING = { type: ["string", "null"] };
const ASSESSMENT_SCHEMA = {
	type: "object",
	properties: { verdict: { type: "string", enum: [...TRIAGE_VERDICTS] }, rationale: { type: "string" }, evidence: { type: "string" }, reply: { type: "string" } },
	required: ["verdict", "rationale", "evidence", "reply"],
	additionalProperties: false,
};
const COMMENTS_REPORT_SCHEMA = {
	type: "object",
	properties: {
		summary: { type: "string" },
		items: {
			type: "array",
			items: {
				type: "object",
				properties: { sourceId: { type: "string" }, assessment: ASSESSMENT_SCHEMA },
				required: ["sourceId", "assessment"],
				additionalProperties: false,
			},
		},
	},
	required: ["summary", "items"],
	additionalProperties: false,
};
const THERMO_REPORT_SCHEMA = {
	type: "object",
	properties: {
		summary: { type: "string" },
		items: {
			type: "array",
			items: {
				type: "object",
				properties: { number: { type: "integer", minimum: 1 }, path: { type: "string" }, line: { type: ["integer", "null"], minimum: 1 }, feedback: { type: "string" }, assessment: ASSESSMENT_SCHEMA },
				required: ["number", "path", "line", "feedback", "assessment"],
				additionalProperties: false,
			},
		},
	},
	required: ["summary", "items"],
	additionalProperties: false,
};
const RESULT_SCHEMA = {
	type: "object",
	properties: {
		results: {
			type: "array",
			items: {
				type: "object",
				properties: {
					id: { type: "string" },
					outcome: { type: "string", enum: ["fixed", "blocked", "reply-only"] },
					reply: { type: "string" },
					changedFiles: { type: ["array", "null"], items: { type: "string" } },
					evidence: NULLABLE_STRING,
					reason: NULLABLE_STRING,
				},
				required: ["id", "outcome", "reply", "changedFiles", "evidence", "reason"],
				additionalProperties: false,
			},
		},
	},
	required: ["results"],
	additionalProperties: false,
};
