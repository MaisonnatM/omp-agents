import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyChange, type BoardChange, type BoardState, branchOf, emptyBoard, MAX_EXITS, parseChange, readLog, startedOn, statusOf, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
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
			[1, { op: "start", task: 1, sessionId: "a", branch: "board/1" }],
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
			[1, { op: "start", task: 1, sessionId: "first", branch: "board/1" }],
			[2, { op: "done", sessionId: "first", task: 1, text: "Committed.\n\nSuggestions:\n1. Merge on main" }],
		]);
		const asked = play([[3, { op: "reply", by: user, task: 1, text: " merge on main. " }]], done);
		expect(statusOf(asked, task(asked, 1))).toEqual({ kind: "done" });
		const more = play([[3, { op: "reply", by: user, task: 1, text: "Rename it, then merge on main" }]], done);
		expect(statusOf(more, task(more, 1))).toEqual({ kind: "ready" });
		const landed = play([[4, { op: "land", task: 1, outcome: "landed", text: "Landed abc." }]], asked);
		expect(statusOf(landed, task(landed, 1))).toEqual({ kind: "done" });
		expect(task(landed, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "landed", text: "Landed abc." } });
		const failed = play([[4, { op: "land", task: 1, outcome: "failed", text: "Not landed: bun test failed." }]], asked);
		expect(unstartedReady(failed).map(each => each.id)).toEqual([1]);
		expect(task(failed, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "land-failed", text: "Not landed: bun test failed." } });
		const refused = play([[4, { op: "land", task: 1, outcome: "refused", text: "Not landed: this repository has no .omp/land.json." }]], asked);
		expect(statusOf(refused, task(refused, 1))).toEqual({ kind: "done" });
		expect(task(refused, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "land-refused", text: "Not landed: this repository has no .omp/land.json." } });
	});

	test("a land line from before outcomes reads as landed or failed, and a start line's old worktree is dropped", () => {
		const state = readLog(
			[
				JSON.stringify({ op: "post", by: user, workspace: WS, title: "One", at: 0, id: 1 }),
				JSON.stringify({ op: "start", task: 1, sessionId: "a", branch: "board/1", worktree: "/work/app-wt/board-1", at: 1 }),
				JSON.stringify({ op: "done", sessionId: "a", task: 1, at: 2 }),
				JSON.stringify({ op: "reply", by: user, task: 1, text: "Merge on main", at: 3 }),
				JSON.stringify({ op: "land", task: 1, landed: false, text: "Not landed.", at: 4 }),
			].join("\n"),
		);
		expect(branchOf(task(state, 1))).toBe("board/1");
		expect(task(state, 1).replies.at(-1)).toEqual({ at: 4, note: { kind: "land-failed", text: "Not landed." } });
		expect(unstartedReady(state).map(each => each.id)).toEqual([1]);
	});

	test("a Board task whose session failed to start is failed with the reason, until the user's reply starts it again", () => {
		const failed = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: null, error: "No worktree" }],
		]);
		expect(statusOf(failed, task(failed, 1))).toEqual({ kind: "failed", error: "No worktree" });
		expect(unstartedReady(failed)).toEqual([]);
		const replied = play([[2, { op: "reply", by: user, task: 1, text: "Try again" }]], failed);
		expect(statusOf(replied, task(replied, 1))).toEqual({ kind: "ready" });
		expect(unstartedReady(replied).map(each => each.id)).toEqual([1]);
	});

	test(`after ${MAX_EXITS} sessions in a row exit without marking it done, a Board task fails instead of starting another; the user's reply between rounds resets the count`, () => {
		const round = (at: number, sessionId: string): [number, BoardChange][] => [
			[at, { op: "start", task: 1, sessionId }],
			[at + 1, { op: "expire", task: 1 }],
		];
		const posted = play([[0, { op: "post", by: user, workspace: WS, title: "One" }]]);
		const twice = play([...round(1, "a"), ...round(3, "b")], posted);
		expect(statusOf(twice, task(twice, 1))).toEqual({ kind: "ready" });
		const thrice = play(round(5, "c"), twice);
		expect(statusOf(thrice, task(thrice, 1))).toEqual({ kind: "failed", error: "Its last 3 sessions exited without marking it done." });
		expect(unstartedReady(thrice)).toEqual([]);
		const retried = play([[7, { op: "reply", by: user, task: 1, text: "Try again" }], ...round(8, "d")], thrice);
		expect(statusOf(retried, task(retried, 1))).toEqual({ kind: "ready" });
		const replied = play([[1, { op: "start", task: 1, sessionId: "a" }], [2, { op: "expire", task: 1 }], [3, { op: "reply", by: user, task: 1, text: "Go on" }], ...round(4, "b"), ...round(6, "c")], posted);
		expect(statusOf(replied, task(replied, 1))).toEqual({ kind: "ready" });
	});

	test("the user closes a Board task that is not done: it is done, keeps the session started on it, and their reply reopens it", () => {
		const started = play([
			[0, { op: "post", by: user, workspace: WS, title: "One" }],
			[1, { op: "start", task: 1, sessionId: "a" }],
		]);
		const closed = play([[2, { op: "close", by: user, task: 1 }]], started);
		expect(statusOf(closed, task(closed, 1))).toEqual({ kind: "done" });
		expect(task(closed, 1).start).toEqual({ sessionId: "a", at: 1 });
		expect(task(closed, 1).replies.at(-1)).toEqual({ at: 2, note: { kind: "closed" } });
		expect(applyChange(closed, { op: "close", by: user, task: 1 }, 3)).toEqual({ error: "Board task #1 is done." });
		expect(applyChange(closed, { op: "done", sessionId: "a", task: 1 }, 3)).toEqual({ error: "Board task #1 is done." });
		const reopened = play([[3, { op: "reply", by: user, task: 1, text: "Pick it up again" }]], closed);
		expect(unstartedReady(reopened).map(each => each.id)).toEqual([1]);
		expect(parseChange({ op: "close", by: session("a"), task: 1 })).toBeNull();
	});

	test("a start whose Board task was claimed, closed, or done meanwhile is refused", () => {
		const posted = play([[0, { op: "post", by: user, workspace: WS, title: "One" }]]);
		const claimed = play([[1, { op: "claim", sessionId: "terminal", task: 1 }]], posted);
		expect(applyChange(claimed, { op: "start", task: 1, sessionId: "auto" }, 2)).toEqual({ error: "Board task #1 is not ready to start." });
		const closed = play([[1, { op: "close", by: user, task: 1 }]], posted);
		expect(applyChange(closed, { op: "start", task: 1, sessionId: "auto" }, 2)).toEqual({ error: "Board task #1 is not ready to start." });
	});

	test("a change from an inbox file already applied changes nothing, as after a crash before the file was deleted, also once read back from the log", () => {
		const post: BoardChange = { op: "post", by: session("a"), workspace: WS, title: "One", request: "1-abc.json" };
		const first = applyChange(emptyBoard(), post, 0);
		if ("error" in first) throw new Error(first.error);
		expect(first.event).toMatchObject({ op: "post", request: "1-abc.json" });
		expect(applyChange(first.ok, post, 1)).toEqual({ ok: first.ok, event: null });
		const read = readLog(`${JSON.stringify(first.event)}\n`);
		expect(applyChange(read, post, 1)).toEqual({ ok: read, event: null });
		expect(read.tasks).toHaveLength(1);
	});

	test("a post needs an absolute workspace", () => {
		expect(applyChange(emptyBoard(), { op: "post", by: user, workspace: "app", title: "One" }, 0)).toEqual({ error: "A Board task's workspace must be an absolute path." });
	});

	test("a reply keeps the launch picked for the session it wakes", () => {
		const launch = { model: { provider: "anthropic", id: "claude-opus-5-5" }, thinking: "high", skill: null };
		const change = parseChange({ op: "reply", by: user, task: 1, text: "Go on", launch }, false);
		expect(change).toEqual({ op: "reply", by: user, task: 1, text: "Go on", launch });
		const replied = play([[1, change as BoardChange]], play([[0, { op: "post", by: user, workspace: WS, title: "One" }]]));
		expect(task(replied, 1).replies.at(-1)).toEqual({ at: 1, by: user, text: "Go on", launch });
	});

	test("the server's own changes never come from a page or a tool", () => {
		expect(parseChange({ op: "expire", task: 1 })).toBeNull();
		expect(parseChange({ op: "start", task: 1, sessionId: "a" })).toBeNull();
		expect(parseChange({ op: "land", task: 1, outcome: "landed", text: "Landed." }, false)).toBeNull();
		expect(parseChange({ op: "land", task: 1, outcome: "landed", text: "Landed." }, true)).toEqual({ op: "land", task: 1, outcome: "landed", text: "Landed." });
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

	test("a change after a half-written last line starts its own line, so reopening the log still holds it", () => {
		const path = join(dir, "torn.jsonl");
		const first = new BoardLog(path, () => 100);
		first.apply({ op: "post", by: user, workspace: WS, title: "One" });
		writeFileSync(path, `${readFileSync(path, "utf8")}{"op":"cla`);
		const after = new BoardLog(path, () => 200);
		after.apply({ op: "post", by: user, workspace: WS, title: "Two" });
		after.apply({ op: "post", by: user, workspace: WS, title: "Three" });
		expect(new BoardLog(path).value.tasks.map(task => task.title)).toEqual(["One", "Two", "Three"]);
	});

	test("reload takes the events another server appended, so a server that takes over goes on from the whole log", () => {
		const path = join(dir, "two-servers.jsonl");
		const standby = new BoardLog(path, () => 100);
		const owner = new BoardLog(path, () => 100);
		owner.apply({ op: "post", by: user, workspace: WS, title: "One" });
		expect(standby.value.tasks).toEqual([]);
		standby.reload();
		standby.apply({ op: "post", by: user, workspace: WS, title: "Two" });
		expect(new BoardLog(path).value.tasks.map(task => [task.id, task.title])).toEqual([
			[1, "One"],
			[2, "Two"],
		]);
	});

	test("a tool's change handed over again after a crash is taken without a second event", () => {
		const path = join(dir, "repeated.jsonl");
		const log = new BoardLog(path, () => 100);
		const change: BoardChange = { op: "post", by: session("a"), workspace: WS, title: "One", request: "1-a.json" };
		expect(log.apply(change)).toBe(true);
		expect(new BoardLog(path, () => 200).apply(change)).toBe(true);
		expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
		expect(new BoardLog(path).value.tasks).toHaveLength(1);
	});
});
