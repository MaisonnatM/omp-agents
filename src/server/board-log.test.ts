import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, type BoardChange, type BoardState, branchOf, emptyBoard, parseChange, readLog, startedOn, statusOf, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
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

	test("it refuses a claim on a waiting, held, or done Board task, done from a session that holds none, and a post that needs one that does not exist", () => {
		const state = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[0, { op: "post", by: user, workspace: WS, title: "Two", needs: [1] }],
			[1, { op: "claim", sessionId: "a", task: 1 }],
		]);
		expect(applyChange(state, { op: "claim", sessionId: "b", task: 2 }, 2)).toEqual({ error: "Board task #2 waits on #1, which is not done." });
		expect(applyChange(state, { op: "claim", sessionId: "b", task: 1 }, 2)).toEqual({ error: "Board task #1 is held by session a." });
		expect(applyChange(state, { op: "done", sessionId: "b", task: 1 }, 2)).toEqual({ error: "This session holds no claim on Board task #1; claim it first." });
		expect(applyChange(state, { op: "post", by: user, workspace: WS, title: "Three", needs: [9] }, 2)).toEqual({ error: "There is no Board task #9 to wait on." });
		const done = play([[3, { op: "done", sessionId: "a", task: 1 }]], state);
		expect(applyChange(done, { op: "claim", sessionId: "b", task: 1 }, 4)).toEqual({ error: "Board task #1 is done." });
	});

	test("the session started on a Board task holds it without claiming, and marks it done; expiring it makes the Board task ready to start again", () => {
		let state = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: "a", branch: "board/1", worktree: "/work/app-wt/board-1" }],
		]);
		expect(statusOf(state, task(state, 1))).toEqual({ kind: "claimed", sessionId: "a" });
		expect(branchOf(task(state, 1))).toBe("board/1");
		expect(applyChange(state, { op: "claim", sessionId: "b", task: 1 }, 2)).toEqual({ error: "Board task #1 is held by session a." });
		const finished = play([[2, { op: "done", sessionId: "a", task: 1 }]], state);
		expect(statusOf(finished, task(finished, 1))).toEqual({ kind: "done" });
		state = play([[2, { op: "expire", task: 1 }]], state);
		expect(statusOf(state, task(state, 1))).toEqual({ kind: "ready" });
		expect(unstartedReady(state).map(each => each.id)).toEqual([1]);
		expect(task(state, 1).replies.at(-1)).toEqual({ at: 2, note: { kind: "unclaimed", sessionId: "a" } });
	});

	test("a renew line from when claims held a lease reads as no event", () => {
		const state = readLog(
			[
				JSON.stringify({ op: "post", by: user, workspace: WS, title: "One", at: 0, id: 1 }),
				JSON.stringify({ op: "claim", sessionId: "a", task: 1, at: 1 }),
				JSON.stringify({ op: "renew", sessionId: "a", task: 1, at: 2 }),
			].join("\n"),
		);
		expect(task(state, 1).claim).toEqual({ sessionId: "a", at: 1 });
		expect(task(state, 1).replies).toEqual([{ at: 1, note: { kind: "claimed", sessionId: "a" } }]);
	});

	test("a reply wakes the claimer, else the started session or a session author, never the replier, and nobody once done", () => {
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
		expect(wakeTarget(task(done, 1), user)).toBeNull();
		expect(wakeTarget(task(done, 1), session("other"))).toBeNull();
	});

	test("the user's reply on a done Board task reopens it for a new session on the reply's launch; a session's reply does not", () => {
		const launch = { model: { provider: "anthropic", id: "claude-opus-5-5" }, thinking: "high", skill: null };
		const done = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: "first" }],
			[3, { op: "done", sessionId: "first", task: 1, text: "Committed.\n\nSuggestions:\n1. Merge on main" }],
		]);
		expect(unstartedReady(done)).toEqual([]);
		const bySession = play([[4, { op: "reply", by: session("other"), task: 1, text: "Noted" }]], done);
		expect(statusOf(bySession, task(bySession, 1))).toEqual({ kind: "done" });
		const reopened = play([[4, { op: "reply", by: user, task: 1, text: "Merge on main", launch }]], done);
		expect(statusOf(reopened, task(reopened, 1))).toEqual({ kind: "ready" });
		expect(unstartedReady(reopened).map(each => each.id)).toEqual([1]);
		expect(task(reopened, 1).launch).toEqual(launch);
		expect(startedOn(task(reopened, 1))).toEqual(["first"]);
	});

	test("a bare Merge on main on a done Board task with a branch keeps it done; a failed merge reopens it, a landed one does not", () => {
		const done = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: "first", branch: "board/1", worktree: "/work/app-wt/board-1" }],
			[2, { op: "done", sessionId: "first", task: 1, text: "Committed.\n\nSuggestions:\n1. Merge on main" }],
		]);
		const asked = play([[3, { op: "reply", by: user, task: 1, text: " merge on main. " }]], done);
		expect(statusOf(asked, task(asked, 1))).toEqual({ kind: "done" });
		const more = play([[3, { op: "reply", by: user, task: 1, text: "Rename it, then merge on main" }]], done);
		expect(statusOf(more, task(more, 1))).toEqual({ kind: "ready" });
		const landed = play([[4, { op: "land", task: 1, landed: true, text: "Landed abc." }]], asked);
		expect(statusOf(landed, task(landed, 1))).toEqual({ kind: "done" });
		expect(task(landed, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "landed", text: "Landed abc." } });
		const failed = play([[4, { op: "land", task: 1, landed: false, text: "Not landed: bun test failed." }]], asked);
		expect(unstartedReady(failed).map(each => each.id)).toEqual([1]);
		expect(task(failed, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "land-failed", text: "Not landed: bun test failed." } });
	});

	test("the user's reply on a Board task whose session failed to start starts it again", () => {
		const failed = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: null, error: "No worktree" }],
		]);
		expect(unstartedReady(failed)).toEqual([]);
		const replied = play([[2, { op: "reply", by: user, task: 1, text: "Try again" }]], failed);
		expect(unstartedReady(replied).map(each => each.id)).toEqual([1]);
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
		expect(parseChange({ op: "land", task: 1, landed: true, text: "Landed." }, false)).toBeNull();
		expect(parseChange({ op: "land", task: 1, landed: true, text: "Landed." })).toEqual({ op: "land", task: 1, landed: true, text: "Landed." });
		expect(parseChange({ op: "renew", task: 1, sessionId: "a" }, false)).toBeNull();
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
