import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, type BoardChange, type BoardState, emptyBoard, LEASE_MS, lapsed, parseChange, readLog, statusOf, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
import { BoardLog } from "./board-log";

const WS = "/work/app";
const user = { kind: "user" } as const;
const session = (sessionId: string) => ({ kind: "session", sessionId }) as const;

/** `changes` applied in order from an empty Board, each at its own time; a refusal fails the test. */
function play(changes: [number, BoardChange][], from: BoardState = emptyBoard()): BoardState {
	return changes.reduce((state, [at, change]) => {
		const applied = applyChange(state, change, at);
		if ("error" in applied) throw new Error(applied.error);
		return applied.ok;
	}, from);
}

const task = (state: BoardState, id: number) => state.tasks.find(each => each.id === id)!;

describe("the Board's projection", () => {
	test("a Board task waits on the one it needs until that one is done, then it is ready and says so", () => {
		let state = play([
			[0, { op: "post", by: user, workspace: WS, title: "Build the API" }],
			[1, { op: "post", by: user, workspace: WS, title: "Build the page", needs: [1] }],
		]);
		expect(statusOf(state, task(state, 2))).toEqual({ kind: "waiting", on: 1 });
		expect(unstartedReady(state).map(each => each.id)).toEqual([1]);
		state = play(
			[
				[2, { op: "start", task: 1, sessionId: "a" }],
				[3, { op: "claim", sessionId: "a", task: 1 }],
				[4, { op: "done", sessionId: "a", task: 1, text: "Shipped." }],
			],
			state,
		);
		expect(statusOf(state, task(state, 1))).toEqual({ kind: "done" });
		expect(statusOf(state, task(state, 2))).toEqual({ kind: "ready" });
		expect(unstartedReady(state).map(each => each.id)).toEqual([2]);
		expect(task(state, 1).replies.at(-1)).toEqual({ at: 4, by: session("a"), text: "Shipped." });
	});

	test("it refuses a claim on a waiting, claimed, or done Board task, and a post that needs one that does not exist", () => {
		const state = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[0, { op: "post", by: user, workspace: WS, title: "Two", needs: [1] }],
			[1, { op: "claim", sessionId: "a", task: 1 }],
		]);
		expect(applyChange(state, { op: "claim", sessionId: "b", task: 2 }, 2)).toEqual({ error: "Board task #2 waits on #1, which is not done." });
		expect(applyChange(state, { op: "claim", sessionId: "b", task: 1 }, 2)).toEqual({ error: "Board task #1 is claimed by session a for 15 more minutes." });
		expect(applyChange(state, { op: "renew", sessionId: "b", task: 1 }, 2)).toEqual({ error: "This session holds no claim on Board task #1; claim it first." });
		expect(applyChange(state, { op: "post", by: user, workspace: WS, title: "Three", needs: [9] }, 2)).toEqual({ error: "There is no Board task #9 to wait on." });
		const done = play([[3, { op: "done", sessionId: "a", task: 1 }]], state);
		expect(applyChange(done, { op: "claim", sessionId: "b", task: 1 }, 4)).toEqual({ error: "Board task #1 is done." });
	});

	test("a lease lapses 15 minutes after the claim or its last renewal, and expiring it makes the Board task ready to start again", () => {
		let state = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[0, { op: "start", task: 1, sessionId: "a" }],
			[10, { op: "claim", sessionId: "a", task: 1 }],
		]);
		expect(lapsed(state, 10 + LEASE_MS - 1)).toEqual([]);
		state = play([[5000, { op: "renew", sessionId: "a", task: 1 }]], state);
		expect(lapsed(state, 10 + LEASE_MS)).toEqual([]);
		expect(lapsed(state, 5000 + LEASE_MS).map(each => each.id)).toEqual([1]);
		state = play([[5000 + LEASE_MS, { op: "expire", task: 1 }]], state);
		expect(statusOf(state, task(state, 1))).toEqual({ kind: "ready" });
		expect(unstartedReady(state).map(each => each.id)).toEqual([1]);
		expect(task(state, 1).replies.at(-1)).toEqual({ at: 5000 + LEASE_MS, note: { kind: "expired", sessionId: "a" } });
	});

	test("a started session that never claims lapses too", () => {
		const state = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[0, { op: "start", task: 1, sessionId: "a" }],
		]);
		expect(unstartedReady(state)).toEqual([]);
		expect(lapsed(state, LEASE_MS).map(each => each.id)).toEqual([1]);
	});

	test("a reply wakes the claimer, the finisher once done, else the started session or a session author, never the replier", () => {
		const posted = play([[0, { op: "post", by: session("author"), workspace: WS, title: "One" }]]);
		expect(wakeTarget(task(posted, 1), user)).toBe("author");
		expect(wakeTarget(task(posted, 1), session("author"))).toBeNull();
		const claimed = play([[1, { op: "claim", sessionId: "worker", task: 1 }]], posted);
		expect(wakeTarget(task(claimed, 1), user)).toBe("worker");
		expect(wakeTarget(task(claimed, 1), session("author"))).toBe("worker");
		expect(wakeTarget(task(claimed, 1), session("worker"))).toBeNull();
		const byUser = play([[0, { op: "post", by: user, workspace: WS, title: "Two" }]]);
		expect(wakeTarget(task(byUser, 1), user)).toBeNull();
		const started = play([[1, { op: "start", task: 1, sessionId: "fresh" }]], byUser);
		expect(wakeTarget(task(started, 1), user)).toBe("fresh");
		const done = play([[2, { op: "done", sessionId: "worker", task: 1 }]], claimed);
		expect(wakeTarget(task(done, 1), user)).toBe("worker");
		expect(wakeTarget(task(done, 1), session("worker"))).toBeNull();
	});

	test("a reply keeps the launch picked for the session it wakes", () => {
		const launch = { model: { provider: "anthropic", id: "claude-opus-5-5" }, thinking: "high", skill: null };
		const change = parseChange({ op: "reply", by: user, task: 1, text: "Go on", launch }, false);
		expect(change).toEqual({ op: "reply", by: user, task: 1, text: "Go on", launch });
		const replied = play([[1, change as BoardChange]], play([[0, { op: "post", by: user, workspace: WS, title: "One" }]]));
		expect(task(replied, 1).replies.at(-1)).toEqual({ at: 1, by: user, text: "Go on", launch });
	});

	test("the server's own changes never come from a page or a tool", () => {
		expect(parseChange({ op: "expire", task: 1 }, false)).toBeNull();
		expect(parseChange({ op: "start", task: 1, sessionId: "a" }, false)).toBeNull();
		expect(parseChange({ op: "claim", task: 1, sessionId: "a" }, false)).toEqual({ op: "claim", task: 1, sessionId: "a" });
	});
});

describe("BoardLog", () => {
	const dir = mkdtempSync(join(tmpdir(), "board-log-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	test("appends each change it takes as one line, reads the same Board back, and skips a half-written last line", () => {
		const path = join(dir, "board-events.jsonl");
		let now = 100;
		const log = new BoardLog(path, () => now);
		log.apply({ op: "post", by: user, workspace: WS, title: "One" });
		now = 200;
		log.apply({ op: "reply", by: user, task: 1, text: "More detail" });
		expect(() => log.apply({ op: "claim", sessionId: "a", task: 7 })).toThrow("There is no Board task #7.");
		expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
		writeFileSync(path, `${readFileSync(path, "utf8")}{"op":"cla`);
		expect(new BoardLog(path).value).toEqual(log.value);
		expect(readLog(readFileSync(path, "utf8")).tasks[0]?.replies).toEqual([{ at: 200, by: user, text: "More detail" }]);
	});
});
