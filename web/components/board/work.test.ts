import { describe, expect, test } from "bun:test";
import { type BoardChange, type BoardState, emptyBoard } from "../../../templates/omp/agent/extensions/board/log";
import { isThreadNote } from "./board-note";
import { BOARD_PAGE } from "./module";
import { readyIn, threadSession, workOf } from "./work";

const user = { kind: "user" } as const;
const workspace = "/w";

/** The Board after `changes`, applied as the page applies them before the server answers. */
function board(...changes: BoardChange[]): BoardState {
	let state = emptyBoard();
	for (const change of changes) {
		const next = BOARD_PAGE.store.apply(state, change);
		if (next === null) throw new Error(`refused: ${JSON.stringify(change)}`);
		state = next;
	}
	return state;
}

const post = (title: string): BoardChange => ({ op: "post", by: user, workspace, title });
const task = (state: BoardState, id: number) => state.tasks.find(each => each.id === id)!;

describe("a Board task whose start failed", () => {
	const failed = board(post("one"), post("two"), { op: "start", task: 1, sessionId: null, error: "setup exited 1" });

	test("shows why it did not start instead of a session starting", () => {
		expect(workOf(failed, task(failed, 1), [])).toEqual({ kind: "failed", error: "setup exited 1" });
		expect(workOf(failed, task(failed, 2), [])).toEqual({ kind: "starting" });
	});

	test("leaves the sidebar's ready count", () => {
		expect(readyIn(failed, workspace)).toBe(1);
	});

	test("shows the failed start in its thread, and a reply starts it again", () => {
		expect(task(failed, 1).replies.flatMap(entry => ("note" in entry && isThreadNote(entry.note) ? [entry.note] : []))).toEqual([{ kind: "start-failed", error: "setup exited 1" }]);
		const retried = board(post("one"), { op: "start", task: 1, sessionId: null, error: "setup exited 1" }, { op: "reply", by: user, task: 1, text: "try again" });
		expect(workOf(retried, task(retried, 1), [])).toEqual({ kind: "starting" });
		expect(readyIn(retried, workspace)).toBe(1);
	});
});

describe("closing a Board task from the page", () => {
	test("marks it done with a closed note its thread shows, and a reply reopens it", () => {
		const closed = board(post("one"), { op: "start", task: 1, sessionId: "s1" }, { op: "close", by: user, task: 1 });
		expect(task(closed, 1).doneAt).not.toBeNull();
		expect(workOf(closed, task(closed, 1), [])).toBeNull();
		expect(task(closed, 1).replies.flatMap(entry => ("note" in entry && isThreadNote(entry.note) ? [entry.note.kind] : []))).toEqual(["closed"]);
		const reopened = board(post("one"), { op: "start", task: 1, sessionId: "s1" }, { op: "close", by: user, task: 1 }, { op: "reply", by: user, task: 1, text: "one more thing" });
		expect(task(reopened, 1).doneAt).toBeNull();
	});
});

describe("the session a Board thread shows", () => {
	const state = board(post("one"), { op: "start", task: 1, sessionId: "s1" }, { op: "expire", task: 1 }, { op: "start", task: 1, sessionId: "s2" });

	test("is the session the address picked when the Board task names it, so a sidebar link opens the session clicked", () => {
		expect(threadSession(task(state, 1), "s1")).toBe("s1");
	});

	test("is the session a reply wakes otherwise", () => {
		expect(threadSession(task(state, 1), null)).toBe("s2");
		expect(threadSession(task(state, 1), "elsewhere")).toBe("s2");
	});
});
