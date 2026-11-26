import { expect, test } from "bun:test";
import { applyChange, type BoardChange, type BoardState, emptyBoard } from "../../templates/omp/agent/extensions/board/log";
import { boardRunTurn } from "./routine-turns";

const T0 = Date.parse("2026-10-05T08:00:00Z");
const by = { kind: "routine", routineId: "r1", name: "Deploys" } as const;

/** The Board after each of `changes`, applied at its time. */
function boardAfter(changes: readonly [at: number, change: BoardChange][]): BoardState {
	let board = emptyBoard();
	for (const [at, change] of changes) {
		const result = applyChange(board, change, at);
		if ("error" in result) throw new Error(result.error);
		board = result.ok;
	}
	return board;
}

test("a run that replied takes the first done after its own reply, not the done of the run before it", () => {
	const board = boardAfter([
		[T0, { op: "post", by, workspace: "/work/webapp", title: "Deploys", text: "Check the deploys." }],
		[T0 + 1, { op: "start", task: 1, sessionId: "s1" }],
		[T0 + 20, { op: "done", task: 1, sessionId: "s1" }],
		[T0 + 25, { op: "reply", by: { kind: "user" }, task: 1, text: "And the staging ones?" }],
		[T0 + 30, { op: "reply", by, task: 1, text: "Check the deploys." }],
		[T0 + 31, { op: "start", task: 1, sessionId: "s1" }],
		[T0 + 40, { op: "done", task: 1, sessionId: "s1", quiet: true }],
	]);
	const turn = boardRunTurn(board, 1, T0 + 10, () => null);
	expect(turn && { replied: turn.replied, quiet: turn.quiet, ms: turn.ms }).toEqual({ replied: true, quiet: true, ms: 30 });
	expect(boardRunTurn(board, 1, T0, () => null)?.ms).toBe(20);
});

test("a run whose reply is not on the Board yet has no turn", () => {
	const board = boardAfter([
		[T0, { op: "post", by, workspace: "/work/webapp", title: "Deploys", text: "Check the deploys." }],
		[T0 + 1, { op: "start", task: 1, sessionId: "s1" }],
		[T0 + 20, { op: "done", task: 1, sessionId: "s1" }],
	]);
	expect(boardRunTurn(board, 1, T0 + 10, () => null)).toBeNull();
});
