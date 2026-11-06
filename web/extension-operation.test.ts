import { expect, test } from "bun:test";
import type { ExtensionOperation } from "../src/shared/extensions";
import { followed, NO_OPERATION, nextReadIn, operationBusy, operationError, operationReducer, type OperationEvent, type OperationState } from "./extension-operation";

const working: ExtensionOperation = { id: "op", warnings: [], state: "working" };
const asking: ExtensionOperation = { id: "op", warnings: [], state: "needs-approval", approval: { token: "t", id: "skill", version: "1", files: [] } };
const done: ExtensionOperation = { id: "op", warnings: [], state: "done", message: "Installed" };

const after = (...events: OperationEvent[]): OperationState => events.reduce(operationReducer, NO_OPERATION);

test("a failed read keeps reading the operation, more slowly, and Check operation reads it again soon", () => {
	const stalled = after({ kind: "send" }, { kind: "answer", cwd: null, op: working }, { kind: "fail", error: "offline" });
	expect(stalled).toEqual({ kind: "stalled", cwd: null, op: working, error: "offline" });
	expect(nextReadIn(stalled)).toBe(5_000);
	expect(operationBusy(stalled)).toBe(true);
	expect(nextReadIn(operationReducer(stalled, { kind: "retry" }))).toBe(700);
});

test("a read after a stall clears its error, and an ended operation shows no stall", () => {
	const stalled = after({ kind: "send" }, { kind: "answer", cwd: null, op: working }, { kind: "fail", error: "offline" });
	const ended = operationReducer(stalled, { kind: "answer", cwd: null, op: done });
	expect(ended).toEqual({ kind: "ended", cwd: null, op: done });
	expect(operationError(ended)).toBeNull();
	expect(nextReadIn(ended)).toBeNull();
	expect(operationReducer(ended, { kind: "fail", error: "late" })).toBe(ended);
});

test("an approval answer clears a stall, and a failed one leaves the approval open with its error", () => {
	const stalled = after({ kind: "send" }, { kind: "answer", cwd: "/repo", op: asking }, { kind: "fail", error: "offline" });
	const approving = operationReducer(stalled, { kind: "approve" });
	expect(approving.kind).toBe("approving");
	expect(operationError(approving)).toBeNull();
	const refused = operationReducer(approving, { kind: "fail", error: "expired" });
	expect(refused).toEqual({ kind: "stalled", cwd: "/repo", op: asking, error: "expired" });
	expect(followed(refused)?.value.state).toBe("needs-approval");
});

test("a second send while one is under way or an operation runs changes nothing", () => {
	const sending = after({ kind: "send" });
	expect(operationReducer(sending, { kind: "send" })).toBe(sending);
	const running = operationReducer(sending, { kind: "answer", cwd: null, op: working });
	expect(operationReducer(running, { kind: "send" })).toBe(running);
});

test("an answer about another operation leaves the followed one", () => {
	const running = after({ kind: "send" }, { kind: "answer", cwd: null, op: working });
	expect(operationReducer(running, { kind: "answer", cwd: null, op: { ...done, id: "other" } })).toBe(running);
});
