import { afterEach, describe, expect, test } from "bun:test";
import { applyChange, type BoardChange, type BoardState, emptyBoard, LEASE_MS } from "../../templates/omp/agent/extensions/board/log";
import type { ModuleRunCore } from "../modules";
import { BoardRunner } from "./board-runner";

/** A runner over an in-memory Board, with the sessions it started and the wakes it sent. */
function harness({ owner = true, stopped = new Set<string>(), working = new Set<string>() } = {}) {
	let state: BoardState = emptyBoard();
	let now = 1000;
	let next = 0;
	const starts: { cwd: string; prompt: string }[] = [];
	const wakes: { sessionId: string; text: string; interrupt: boolean }[] = [];
	let runner: BoardRunner;
	const apply = (change: BoardChange): boolean => {
		const applied = applyChange(state, change, now);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
		runner.changed();
		return true;
	};
	const core: ModuleRunCore = {
		async start(cwd, prompt) {
			starts.push({ cwd, prompt });
			return { sessionId: `s${++next}` };
		},
		async wake(sessionId, text, _launch, interrupt = false) {
			wakes.push({ sessionId, text, interrupt });
			return { resumed: stopped.has(sessionId) };
		},
		working: sessionId => working.has(sessionId),
		owner: () => owner,
		now: () => now,
	};
	runner = new BoardRunner(() => state, apply, core);
	return {
		runner,
		apply,
		starts,
		wakes,
		state: () => state,
		tick: (ms: number) => {
			now += ms;
		},
	};
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
let stops: (() => void)[] = [];
afterEach(() => {
	for (const stop of stops) stop();
	stops = [];
});

describe("BoardRunner", () => {
	test("starts one session on each ready Board task, and one on a dependent once its need is done", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Second", needs: [1] });
		await settle();
		expect(board.starts.map(start => start.cwd)).toEqual(["/w"]);
		expect(board.starts[0]?.prompt).toContain("Board task #1");
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s1");
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.apply({ op: "done", sessionId: "s1", task: 1 });
		await settle();
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.prompt).toContain("Board task #2");
	});

	test("a reply wakes the claimer and notes that it woke a stopped one; the replier is never woken", async () => {
		const board = harness({ stopped: new Set(["s1"]) });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.apply({ op: "reply", by: { kind: "session", sessionId: "s1" }, task: 1, text: "A question" });
		await settle();
		expect(board.wakes).toEqual([]);
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Use the v2 API" });
		await settle();
		expect(board.wakes.map(wake => wake.sessionId)).toEqual(["s1"]);
		expect(board.wakes[0]?.text).toContain("Use the v2 API");
		expect(board.state().tasks[0]?.replies.at(-1)).toMatchObject({ note: { kind: "woke", sessionId: "s1" } });
	});

	test("editing your message stops the turn of the session working from it and sends it the new text; one about to start reads it in its start prompt", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Use v1" });
		await settle();
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Keep the old name" });
		await settle();
		board.tick(1000);
		// `replies` holds the thread's notes too, so the reply's index is its place among them.
		const reply = board.state().tasks[0]!.replies.findIndex(entry => "by" in entry);
		board.apply({ op: "edit", by: { kind: "user" }, task: 1, reply, text: "Rename it to Board" });
		await settle();
		board.tick(1000);
		expect(board.wakes.at(-1)).toMatchObject({ sessionId: "s1", interrupt: true });
		expect(board.wakes.at(-1)?.text).toContain("Rename it to Board");
		board.apply({ op: "edit", by: { kind: "user" }, task: 1, text: "Use v2\nwith the new API" });
		await settle();
		expect(board.wakes.at(-1)?.text).toContain("Use v2\nwith the new API");
		expect(board.state().tasks[0]).toMatchObject({ title: "Use v2", editedAt: expect.any(Number) });
		expect(board.wakes.filter(wake => wake.interrupt)).toHaveLength(2);

		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Second", needs: [1] });
		board.apply({ op: "edit", by: { kind: "user" }, task: 2, text: "Second, edited" });
		board.apply({ op: "done", sessionId: "s1", task: 1 });
		await settle();
		expect(board.wakes.filter(wake => wake.interrupt)).toHaveLength(2);
		expect(board.starts.at(-1)?.prompt).toContain("Second, edited");
	});

	test("only the user's own messages can be edited", () => {
		const board = harness();
		board.apply({ op: "post", by: { kind: "session", sessionId: "s9" }, workspace: "/w", title: "From a session" });
		board.apply({ op: "reply", by: { kind: "session", sessionId: "s9" }, task: 1, text: "Its reply" });
		expect(() => board.apply({ op: "edit", by: { kind: "user" }, task: 1, text: "Mine now" })).toThrow("Only the user's own messages can be edited.");
		expect(() => board.apply({ op: "edit", by: { kind: "user" }, task: 1, reply: 0, text: "Mine now" })).toThrow("Only the user's own messages can be edited.");
	});

	test("a reply on a done Board task starts a new session that reads the thread, and wakes the one that finished nobody", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.apply({ op: "done", sessionId: "s1", task: 1, text: "Committed on board-first.\n\nSuggestions:\n1. Merge on main" });
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		expect(board.wakes).toEqual([]);
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.prompt).toContain("Earlier sessions worked on it and ended: s1.");
		expect(board.starts[1]?.prompt).toContain("Session s1: Committed on board-first.");
		expect(board.starts[1]?.prompt).toContain("The user: Merge on main");
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s2");
	});

	test("the sweep returns a lapsed claim to ready, which starts a new session", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.tick(LEASE_MS);
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(2);
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s2");
	});

	test("the sweep leaves a lapsed claim to its session while that session still works, then frees it once the session goes idle", async () => {
		const working = new Set(["s1"]);
		const board = harness({ working });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.apply({ op: "claim", sessionId: "s1", task: 1 });
		board.tick(LEASE_MS);
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(1);
		working.delete("s1");
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(2);
	});

	test("the sweep leaves an unclaimed start to its session while that session still works", async () => {
		const board = harness({ working: new Set(["s1"]) });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.tick(LEASE_MS);
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(1);
	});

	test("a server that does not run the unattended work starts and wakes nothing", async () => {
		const board = harness({ owner: false });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		expect(board.starts).toEqual([]);
	});
});
