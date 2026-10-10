import type { BranchChoice } from "../src/shared/git";
import type { ModelOption } from "../src/shared/models";
import type { ClientMsg } from "../src/shared/protocol";
import type { PromptImage, StartResult, View } from "../src/shared/sessions";
import { type QuickSubject, startTarget } from "./quick-actions";
import type { ForkPoint } from "./transcript-view";

/**
 * What the user asked to start. A fork keeps the message it branched at, so its pane can show the progress there. A
 * quick action keeps its subject, the pull request, Linear issue, or todo with the action, which its page shows progress
 * and failure for; the server links its session to that subject. A **Resume all** resumes each of the
 * sidebar's interrupted sessions.
 */
export type StartOp =
	| {
			kind: "new";
			cwd: string;
			prompt: string;
			images: PromptImage[];
			branch: BranchChoice | null;
			model: ModelOption | null;
			thinking: string | null;
			/** The pinned skill, `null` when none is pinned or the draft skips it. */
			skill: string | null;
			/** The todo the session works on, `null` for none. */
			todoId: string | null;
	  }
	| { kind: "fork"; view: View; itemId: string; point: ForkPoint }
	| { kind: "resume"; sessionId: string }
	/** `skill`: the skill pinned in the settings, `null` for none. */
	| { kind: "quick"; cwd: string; prompt: string; subject: QuickSubject; skill: string | null }
	| { kind: "resume-all"; sessionIds: string[] };

export type NewOp = Extract<StartOp, { kind: "new" }>;

export type QuickOp = Extract<StartOp, { kind: "quick" }>;

export type StartKind = StartOp["kind"];

/** A start waiting for the server's answer, or failed with the reason. A start that succeeded leaves {@link Starts}. */
export type Start<Op extends StartOp = StartOp> = { op: Op } & ({ phase: "starting" } | { phase: "failed"; error: string });

/** The starts of this page, by the `reqId` the server answers with. At most one per kind: a new start replaces the last of its kind. */
export type Starts = ReadonlyMap<number, Start>;

export type StartOf<K extends StartKind> = Start<Extract<StartOp, { kind: K }>>;

/** The message that asks the server for `op`, answered with `reqId`. */
export const messageOf = (op: StartOp, reqId: number): ClientMsg => {
	switch (op.kind) {
		case "new":
			return { t: "start", reqId, kind: "new", cwd: op.cwd, prompt: op.prompt, images: op.images, branch: op.branch, model: op.model, thinking: op.thinking, skill: op.skill, subject: null, todoId: op.todoId };
		case "quick":
			return { t: "start", reqId, kind: "new", cwd: op.cwd, prompt: op.prompt, images: [], branch: null, model: null, thinking: null, skill: op.skill, ...startTarget(op.subject) };
		case "fork":
			return { t: "start", reqId, kind: "fork", view: op.view, entryId: op.point.entryId };
		case "resume":
			return { t: "start", reqId, kind: "resume", sessionId: op.sessionId };
		case "resume-all":
			return { t: "resume-all", reqId, sessionIds: op.sessionIds };
		default: {
			const never: never = op;
			return never;
		}
	}
};

const isOfKind =
	<K extends StartKind>(kind: K) =>
	(start: Start): start is StartOf<K> =>
		start.op.kind === kind;

/** The start of `kind`, under way or failed, if there is one. */
export const startOf = <K extends StartKind>(starts: Starts, kind: K): StartOf<K> | null => [...starts.values()].find(isOfKind(kind)) ?? null;

export function beginStart(starts: Starts, reqId: number, op: StartOp): Starts {
	const next = new Map([...starts].filter(([, start]) => start.op.kind !== op.kind));
	return next.set(reqId, { op, phase: "starting" });
}

/** Start `reqId` while it waits for the server's answer; `null` once it settled, was replaced, or lost the connection. */
export function pendingStart(starts: Starts, reqId: number): Start | null {
	const start = starts.get(reqId);
	return start?.phase === "starting" ? start : null;
}

/** The server's answer to start `reqId`: a failure stays with its reason, and a started session leaves the map. */
export function settleStart(starts: Starts, reqId: number, result: StartResult): Starts {
	const start = pendingStart(starts, reqId);
	if (!start) return starts;
	const next = new Map(starts);
	if (result.ok) next.delete(reqId);
	else next.set(reqId, { op: start.op, phase: "failed", error: result.error });
	return next;
}

/** The server's answer to **Resume all** `reqId`: it leaves the map once every session resumed, else fails with the first reason. */
export function settleResumeAll(starts: Starts, reqId: number, errors: string[]): Starts {
	const start = pendingStart(starts, reqId);
	if (!start) return starts;
	const next = new Map(starts);
	const [first] = errors;
	if (first === undefined) next.delete(reqId);
	else next.set(reqId, { op: start.op, phase: "failed", error: `Could not resume ${errors.length === 1 ? "1 session" : `${errors.length} sessions`}. ${first}` });
	return next;
}

const LOST: Record<StartKind, string> = {
	new: "Lost the dashboard server while the session was starting. It may still appear.",
	fork: "Lost the dashboard server while forking. The fork may still appear.",
	resume: "Lost the dashboard server while resuming. The session may still appear.",
	quick: "Lost the dashboard server while the session was starting. It may still appear.",
	"resume-all": "Lost the dashboard server while resuming. The sessions may still appear.",
};

/** The answer to every start under way went to the socket that just closed. */
export function loseStarts(starts: Starts): Starts {
	if (![...starts.values()].some(start => start.phase === "starting")) return starts;
	return new Map([...starts].map(([reqId, start]) => [reqId, start.phase === "starting" ? { op: start.op, phase: "failed", error: LOST[start.op.kind] } : start]));
}

/** The view a failed start shows its reason in, `null` when the reason belongs to the page rather than to a view. */
const viewOf = (op: StartOp): View | null => {
	if (op.kind === "fork") return op.view;
	return op.kind === "resume" ? { kind: "past", sessionId: op.sessionId } : null;
};

/** Forget the failed starts whose op `drop` selects; one under way keeps waiting for its answer. */
function dropSettled(starts: Starts, drop: (start: Start) => boolean): Starts {
	const dropped = [...starts].filter(([, start]) => start.phase !== "starting" && drop(start));
	if (dropped.length === 0) return starts;
	const next = new Map(starts);
	for (const [reqId] of dropped) next.delete(reqId);
	return next;
}

/** A failed start's reason goes away once no pane shows its view. */
export const dropHidden = (starts: Starts, shown: (view: View) => boolean): Starts =>
	dropSettled(starts, start => {
		const view = viewOf(start.op);
		return view !== null && !shown(view);
	});

/** The failure that the last start of `kind` left goes away. */
export const dismissSettled = (starts: Starts, kind: StartKind): Starts => dropSettled(starts, start => start.op.kind === kind);
