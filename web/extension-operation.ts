/** Where an extension package change stands on the Extensions tab, from its send to the operation's end. */
import type { ExtensionOperation } from "../src/shared/extensions";

/** An operation omp still runs: applying the change, or waiting for you to allow a skill's scripts. */
type Running = ExtensionOperation & { state: "working" | "needs-approval" };
/** An operation that ended. */
type Ended = ExtensionOperation & { state: "done" | "failed" };

/**
 * - `idle`: no change sent yet.
 * - `sending`: a change is on its way and has no operation yet.
 * - `refused`: the server refused the change, which started nothing.
 * - `running`: omp runs `op` in scope `cwd`, and the tab reads it again soon.
 * - `approving`: your answer to `op`'s script approval is on its way.
 * - `stalled`: the last read of `op`, or the answer to its approval, failed; the tab keeps reading it, more slowly.
 * - `ended`: `op` ended; its message or error stays until the next change.
 */
export type OperationState =
	| { kind: "idle" }
	| { kind: "sending" }
	| { kind: "refused"; error: string }
	| { kind: "running"; cwd: string | null; op: Running }
	| { kind: "approving"; cwd: string | null; op: Running & { state: "needs-approval" } }
	| { kind: "stalled"; cwd: string | null; op: Running; error: string }
	| { kind: "ended"; cwd: string | null; op: Ended };

export type OperationEvent =
	| { kind: "send" }
	| { kind: "refuse"; error: string }
	/** The server answered with `op`: the reply to a send, a read, or an approval. */
	| { kind: "answer"; cwd: string | null; op: ExtensionOperation }
	/** A read of the operation, or an approval answer, failed. */
	| { kind: "fail"; error: string }
	| { kind: "approve" }
	/** Check operation: read the stalled operation again now. */
	| { kind: "retry" };

export const NO_OPERATION: OperationState = { kind: "idle" };

const isRunning = (op: ExtensionOperation): op is Running => op.state === "working" || op.state === "needs-approval";

/** The operation the tab follows, with the scope it runs in, if any. */
export function followed(state: OperationState): { cwd: string | null; value: ExtensionOperation } | null {
	return "op" in state ? { cwd: state.cwd, value: state.op } : null;
}

/** Whether a change holds the tab: one on its way, or an operation omp still runs. A stalled operation still runs. */
export const operationBusy = (state: OperationState): boolean => state.kind === "sending" || state.kind === "running" || state.kind === "approving" || state.kind === "stalled";

/** Why the last change, read, or approval failed, while it stands. */
export const operationError = (state: OperationState): string | null => (state.kind === "refused" || state.kind === "stalled" ? state.error : null);

/**
 * The next state after `event`. An event the state cannot take leaves it as it is: a second send while one runs, an
 * answer about an operation the tab no longer follows, or an approval of one that asks for none.
 */
export function operationReducer(state: OperationState, event: OperationEvent): OperationState {
	switch (event.kind) {
		case "send":
			return operationBusy(state) ? state : { kind: "sending" };
		case "refuse":
			return state.kind === "sending" ? { kind: "refused", error: event.error } : state;
		case "answer": {
			const { cwd, op } = event;
			const awaited = state.kind === "sending" || ((state.kind === "running" || state.kind === "approving" || state.kind === "stalled") && state.op.id === op.id);
			if (!awaited) return state;
			return isRunning(op) ? { kind: "running", cwd, op } : { kind: "ended", cwd, op };
		}
		case "fail":
			return state.kind === "running" || state.kind === "approving" || state.kind === "stalled" ? { kind: "stalled", cwd: state.cwd, op: state.op, error: event.error } : state;
		case "approve":
			return (state.kind === "running" || state.kind === "stalled") && state.op.state === "needs-approval" ? { kind: "approving", cwd: state.cwd, op: state.op } : state;
		case "retry":
			return state.kind === "stalled" ? { kind: "running", cwd: state.cwd, op: state.op } : state;
	}
}

/** How long the tab waits before it reads the operation again: soon while it runs, longer after a failed read. */
export function nextReadIn(state: OperationState): number | null {
	if (state.kind === "running") return 700;
	if (state.kind === "stalled") return 5_000;
	return null;
}
