import type { BranchChoice, LiveView, ModelOption, PromptImage, StartRequest, StartResult, View } from "../src/shared";
import type { QuickSubject } from "./quick-actions";
import type { ForkPoint } from "./transcript-view";

/**
 * What the user asked to start. A fork keeps the message it branched at, so its pane can show the progress there. A
 * quick action keeps its subject, the pull request or Linear issue with the action, which the inbox or the tickets page
 * shows progress, the started session, and failure for.
 */
export type StartOp =
	| { kind: "new"; cwd: string; prompt: string; images: PromptImage[]; branch: BranchChoice | null; model: ModelOption | null }
	| { kind: "fork"; view: View; itemId: string; point: ForkPoint }
	| { kind: "resume"; sessionId: string }
	| { kind: "quick"; cwd: string; prompt: string; subject: QuickSubject };

export type QuickOp = Extract<StartOp, { kind: "quick" }>;

export type StartKind = StartOp["kind"];

/**
 * A start waiting for the server's answer, failed with the reason, or, for a quick action only, started: its session runs
 * in the background while the inbox stays, so the inbox keeps it to offer the session. Any other start that succeeded leaves {@link Starts}.
 */
export type Start<Op extends StartOp = StartOp> = { op: Op } & ({ phase: "starting" } | { phase: "failed"; error: string } | { phase: "started"; view: LiveView });

/** The starts of this page, by the `reqId` the server answers with. At most one per kind: a new start replaces the last of its kind. */
export type Starts = ReadonlyMap<number, Start>;

export type StartOf<K extends StartKind> = Start<Extract<StartOp, { kind: K }>>;

export const requestOf = (op: StartOp): StartRequest => {
	switch (op.kind) {
		case "new":
			return { kind: "new", cwd: op.cwd, prompt: op.prompt, images: op.images, branch: op.branch, model: op.model };
		case "quick":
			return { kind: "new", cwd: op.cwd, prompt: op.prompt, images: [], branch: null, model: null };
		case "fork":
			return { kind: "fork", view: op.view, entryId: op.point.entryId };
		case "resume":
			return { kind: "resume", sessionId: op.sessionId };
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

/** The server's answer to start `reqId`: a failure stays with its reason, a quick action's session stays as started, and any other started session leaves the map. */
export function settleStart(starts: Starts, reqId: number, result: StartResult): Starts {
	const start = starts.get(reqId);
	if (start?.phase !== "starting") return starts;
	const next = new Map(starts);
	if (!result.ok) next.set(reqId, { op: start.op, phase: "failed", error: result.error });
	else if (start.op.kind === "quick") next.set(reqId, { op: start.op, phase: "started", view: { kind: "live", instanceId: result.instanceId, agentId: null } });
	else next.delete(reqId);
	return next;
}

const LOST: Record<StartKind, string> = {
	new: "Lost the dashboard server while the session was starting. It may still appear.",
	fork: "Lost the dashboard server while forking. The fork may still appear.",
	resume: "Lost the dashboard server while resuming. The session may still appear.",
	quick: "Lost the dashboard server while the session was starting. It may still appear.",
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

/** Forget the failed and started starts whose op `drop` selects; one under way keeps waiting for its answer. */
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
		if (start.phase !== "failed") return false;
		const view = viewOf(start.op);
		return view !== null && !shown(view);
	});

/** The failure, or the quick action's started session, that the last start of `kind` left goes away. */
export const dismissSettled = (starts: Starts, kind: StartKind): Starts => dropSettled(starts, start => start.op.kind === kind);
