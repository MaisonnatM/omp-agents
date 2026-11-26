import { describe, expect, test } from "bun:test";
import { applyChange, type BoardChange, type BoardEvent, type BoardState, emptyBoard, type LandOutcome, statusOf } from "../../templates/omp/agent/extensions/board/log";
import type { ModuleRunCore } from "../modules";
import { BoardRunner, GONE_MS } from "./board-runner";

/** A promise the test resolves itself, to hold a checkout, a merge, or a wake mid-way. */
function gate(): { wait: Promise<void>; open: () => void } {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { wait: promise, open: resolve };
}

/**
 * A runner over an in-memory Board, with the sessions it started, the wakes it sent, the sessions it ended, and the
 * merges it ran. `/w` is a repository, whose Board tasks get a worktree at `/w-wt/board-<id>`; `/plain` is outside git.
 * `checkouts`, `merges`, and `waking` hold each checkout, merge, or wake on that promise.
 */
function harness({ owner = true, stopped = new Set<string>(), working = new Set<string>(), outcome = "landed" as LandOutcome, landable = true } = {}) {
	let state: BoardState = emptyBoard();
	let now = 1000;
	let next = 0;
	let owns = owner;
	const events: BoardEvent[] = [];
	const starts: { cwd: string; prompt: string; task: string }[] = [];
	const wakes: { sessionId: string; text: string; interrupt: boolean }[] = [];
	const alive = new Set<string>();
	const ended: string[] = [];
	const lands: { workspace: string; branch: string; sessionId: string | undefined }[] = [];
	const holds: { checkouts: Promise<void> | null; merges: Promise<void> | null; waking: Promise<void> | null } = { checkouts: null, merges: null, waking: null };
	let runner: BoardRunner;
	const apply = (change: BoardChange): boolean => {
		const applied = applyChange(state, change, now);
		if ("error" in applied) throw new Error(applied.error);
		state = applied.ok;
		if (applied.event) events.push(applied.event);
		runner.changed();
		return true;
	};
	const core: ModuleRunCore = {
		async start(cwd, prompt, _launch, task) {
			starts.push({ cwd, prompt, task });
			const sessionId = `s${++next}`;
			alive.add(sessionId);
			return { sessionId };
		},
		async wake(sessionId, text, _launch, interrupt = false) {
			await holds.waking;
			wakes.push({ sessionId, text, interrupt });
			return { resumed: stopped.has(sessionId) };
		},
		working: sessionId => working.has(sessionId),
		alive: sessionId => alive.has(sessionId),
		async end(sessionId) {
			ended.push(sessionId);
			alive.delete(sessionId);
		},
		async checkout(workspace, branch) {
			await holds.checkouts;
			return workspace === "/plain" ? null : `${workspace}-wt/${branch.replace("/", "-")}`;
		},
		async land(workspace, branch, sessionId) {
			lands.push({ workspace, branch, sessionId });
			await holds.merges;
			if (outcome === "landed") return { outcome, text: "Landed abc on main." };
			if (outcome === "refused") return { outcome, text: "Not landed: this repository has no .omp/land.json." };
			return { outcome, text: "Not landed: `bun test` failed on the merged result." };
		},
		landable: () => landable,
		owner: () => owns,
		now: () => now,
	};
	runner = new BoardRunner(() => state, apply, core);
	return {
		get runner() {
			return runner;
		},
		apply,
		events,
		starts,
		wakes,
		alive,
		ended,
		lands,
		working,
		holds,
		state: () => state,
		tick: (ms: number) => {
			now += ms;
		},
		/** Makes this server own the unattended work, or not. */
		own: (value: boolean) => {
			owns = value;
		},
		/** A new runner over the same Board and sessions, as after a server restart. */
		restart: () => {
			runner = new BoardRunner(() => state, apply, core);
			return runner;
		},
		/** Posts Board task #1 on `/w`, starts its session s1, and has s1 mark it done; s1 still runs until the sweep ends it. */
		async doneTask(text = "Committed.\n\nSuggestions:\n1. Merge on main"): Promise<void> {
			runner.changed();
			apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
			await settle();
			apply({ op: "done", sessionId: "s1", task: 1, text });
		},
	};
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("BoardRunner", () => {
	test("starts one session on each ready Board task in its own worktree, and one on a dependent once its need is done", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Second", needs: [1] });
		await settle();
		expect(board.starts.map(start => start.cwd)).toEqual(["/w-wt/board-1"]);
		expect(board.starts[0]?.prompt).toContain("Board task #1");
		expect(board.starts[0]?.prompt).toContain("You work in /w-wt/board-1, a worktree on branch board/1");
		expect(board.events.find(event => event.op === "start")).toEqual({ op: "start", task: 1, sessionId: "s1", branch: "board/1", at: 1000 });
		expect(board.starts[0]?.task).toBe("board:/w#1");
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s1");
		board.apply({ op: "done", sessionId: "s1", task: 1 });
		await settle();
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.cwd).toBe("/w-wt/board-2");
		expect(board.starts[1]?.prompt).toContain("Board task #2");
	});

	test("the start prompt is the whole contract: it names no claim, lease, or end_session", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		const prompt = board.starts[0]?.prompt ?? "";
		expect(prompt).toContain("Suggestions:");
		expect(prompt).toContain("commit them on your branch");
		expect(prompt).not.toMatch(/claim it|renew|lease|end_session/);
	});

	test("a routine's Board task tells its session to mark it done quietly when it found nothing to report, and a user's does not", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "routine", routineId: "r1", name: "Digest" }, workspace: "/w", title: "Digest", text: "Summarize the inbox." });
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Second" });
		await settle();
		const [routine, user] = board.starts.map(start => start.prompt);
		expect(routine).toContain("quiet");
		expect(user).not.toContain("quiet");
	});

	test("a Board task outside git starts its session in its Workspace, with no branch", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/plain", title: "First" });
		await settle();
		expect(board.starts.map(start => start.cwd)).toEqual(["/plain"]);
		expect(board.events.find(event => event.op === "start")).toEqual({ op: "start", task: 1, sessionId: "s1", at: 1000 });
	});

	test("a reply wakes the started session and notes that it woke a stopped one; the replier is never woken", async () => {
		const board = harness({ stopped: new Set(["s1"]) });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
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

	test("a reply on a done Board task that asks for more starts a new session in the same worktree that reads the thread, once the one that finished has ended", async () => {
		const board = harness();
		await board.doneTask("Committed on board/1.\n\nSuggestions:\n1. Merge on main");
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Rename it, then merge on main" });
		await settle();
		expect(board.wakes).toEqual([]);
		expect(board.lands).toEqual([]);
		// s1 still runs in the worktree until the sweep ends it, so the next session waits for it.
		expect(board.starts).toHaveLength(1);
		await board.runner.sweep();
		await settle();
		expect(board.ended).toEqual(["s1"]);
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.cwd).toBe("/w-wt/board-1");
		expect(board.starts[1]?.prompt).toContain("Earlier sessions worked on it and ended: s1.");
		expect(board.starts[1]?.prompt).toContain("Session s1: Committed on board/1.");
		expect(board.starts[1]?.prompt).toContain("The user: Rename it, then merge on main");
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s2");
	});

	test("a reply while the session that marked the Board task done still finishes its turn starts the next session only once that one ended", async () => {
		const board = harness();
		board.working.add("s1");
		await board.doneTask();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Also rename it" });
		await settle();
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(1);
		board.working.delete("s1");
		await board.runner.sweep();
		await settle();
		expect(board.ended).toEqual(["s1"]);
		expect(board.starts).toHaveLength(2);
	});

	test("a bare Merge on main lands the branch with no session and keeps the Board task done", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.apply({ op: "done", sessionId: "s1", task: 1, text: "Committed.\n\nSuggestions:\n1. Merge on main" });
		const startsBefore = board.events.filter(event => event.op === "start").length;
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		await settle();
		expect(board.events.filter(event => event.op === "start")).toHaveLength(startsBefore);
		expect(board.starts).toHaveLength(1);
		expect(board.lands).toEqual([{ workspace: "/w", branch: "board/1", sessionId: "s1" }]);
		expect(board.state().tasks[0]?.doneAt).not.toBeNull();
		expect(board.state().tasks[0]?.replies.at(-1)).toMatchObject({ note: { kind: "landed", text: "Landed abc on main." } });
	});

	test("a merge that fails reopens the Board task, and its new session reads why", async () => {
		const board = harness({ outcome: "failed" });
		await board.doneTask("Committed.");
		await board.runner.sweep();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		await settle();
		expect(board.lands).toHaveLength(1);
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.cwd).toBe("/w-wt/board-1");
		expect(board.starts[1]?.prompt).toContain("The Board's merge failed: Not landed: `bun test` failed on the merged result.");
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s2");
	});

	test("a merge the repository has no land config for keeps the Board task done and says why", async () => {
		const board = harness({ outcome: "refused" });
		await board.doneTask();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		await settle();
		expect(board.state().tasks[0]?.doneAt).not.toBeNull();
		expect(board.state().tasks[0]?.replies.at(-1)).toMatchObject({ note: { kind: "land-refused", text: "Not landed: this repository has no .omp/land.json." } });
		await board.runner.sweep();
		await settle();
		expect(board.starts).toHaveLength(1);
	});

	test("a repository with no land config gets no Merge on main suggestion; the session pushes and opens a draft PR", async () => {
		const board = harness({ landable: false });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		expect(board.starts[0]?.prompt).not.toContain("Merge on main");
		expect(board.starts[0]?.prompt).toContain("open a draft PR");
	});

	test("a second Merge on main while the merge runs is answered with a note, and runs no second merge", async () => {
		const board = harness();
		const merge = gate();
		board.holds.merges = merge.wait;
		await board.doneTask();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		expect(board.state().tasks[0]?.replies.at(-1)).toMatchObject({ note: { kind: "land-refused", text: "A merge of board/1 already runs; its result follows." } });
		merge.open();
		await settle();
		await settle();
		expect(board.lands).toHaveLength(1);
		expect(board.state().tasks[0]?.replies.at(-1)).toMatchObject({ note: { kind: "landed" } });
	});

	test("a reply that reopens the Board task while its merge runs starts the next session once the merge ends", async () => {
		const board = harness();
		const merge = gate();
		board.holds.merges = merge.wait;
		await board.doneTask();
		await board.runner.sweep();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Merge on main" });
		await settle();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Also rename it" });
		await settle();
		expect(board.starts).toHaveLength(1);
		merge.open();
		await settle();
		await settle();
		expect(board.starts).toHaveLength(2);
		expect(board.starts[1]?.prompt).toContain("The Board merged the branch: Landed abc on main.");
	});

	test("the start reads the Board task again after its checkout: a reply meanwhile is in the prompt, a claim or a close meanwhile starts nothing", async () => {
		const board = harness();
		const checkout = gate();
		board.holds.checkouts = checkout.wait;
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Second" });
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Third" });
		await settle();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Use the v2 API" });
		board.apply({ op: "claim", sessionId: "terminal", task: 2 });
		board.apply({ op: "close", by: { kind: "user" }, task: 3 });
		checkout.open();
		await settle();
		await settle();
		expect(board.starts.map(start => start.cwd)).toEqual(["/w-wt/board-1"]);
		expect(board.starts[0]?.prompt).toContain("The user: Use the v2 API");
		expect(board.wakes).toEqual([]);
		expect(board.state().tasks[1]?.claim?.sessionId).toBe("terminal");
		expect(board.state().tasks[2]?.start).toBeNull();
	});

	test("closing a Board task ends its session at once, mid-turn too", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.working.add("s1");
		board.apply({ op: "close", by: { kind: "user" }, task: 1 });
		await board.runner.sweep();
		await settle();
		expect(board.ended).toEqual(["s1"]);
		expect(board.starts).toHaveLength(1);
	});

	test("a restarted server ends the session whose done turn ended before the restart", async () => {
		const board = harness();
		board.working.add("s1");
		await board.doneTask();
		const restarted = board.restart();
		board.working.delete("s1");
		await restarted.sweep();
		await settle();
		expect(board.ended).toEqual(["s1"]);
	});

	test(`a Board task whose sessions keep exiting without marking it done fails after ${3} rounds, instead of starting another`, async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		for (const sessionId of ["s1", "s2", "s3"]) {
			board.alive.delete(sessionId);
			await board.runner.sweep();
			board.tick(GONE_MS);
			await board.runner.sweep();
			await settle();
		}
		expect(board.starts).toHaveLength(3);
		expect(statusOf(board.state(), board.state().tasks[0]!)).toEqual({ kind: "failed", error: "Its last 3 sessions exited without marking it done." });
	});

	test("two quick replies to a stopped session wake it in order, one after the other", async () => {
		const board = harness({ stopped: new Set(["s1"]) });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		const waking = gate();
		board.holds.waking = waking.wait;
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "One" });
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Two" });
		await settle();
		expect(board.wakes).toEqual([]);
		waking.open();
		await settle();
		await settle();
		expect(board.wakes.map(wake => wake.text.includes("One"))).toEqual([true, false]);
		expect(board.wakes[1]?.text).toContain("Two");
	});

	test("edits a server took over with go to the session in one prompt", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "Use v1" });
		await settle();
		board.apply({ op: "reply", by: { kind: "user" }, task: 1, text: "Keep the old name" });
		await settle();
		board.own(false);
		board.tick(1000);
		const reply = board.state().tasks[0]!.replies.findIndex(entry => "by" in entry);
		board.apply({ op: "edit", by: { kind: "user" }, task: 1, text: "Use v2" });
		board.apply({ op: "edit", by: { kind: "user" }, task: 1, reply, text: "Rename it to Board" });
		board.own(true);
		board.runner.changed();
		await settle();
		const edits = board.wakes.filter(wake => wake.interrupt);
		expect(edits).toHaveLength(1);
		expect(edits[0]?.text).toContain("Use v2");
		expect(edits[0]?.text).toContain("Rename it to Board");
	});

	test("the sweep ends a started session once the turn that marked its Board task done ends", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.working.add("s1");
		board.apply({ op: "done", sessionId: "s1", task: 1, text: "Committed." });
		await board.runner.sweep();
		expect(board.ended).toEqual([]);
		board.working.delete("s1");
		await board.runner.sweep();
		await board.runner.sweep();
		expect(board.ended).toEqual(["s1"]);
	});

	test("a Board task whose session exited without marking it done returns to ready once it has been gone a while, which starts a new session", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		await board.runner.sweep();
		expect(board.starts).toHaveLength(1);
		board.alive.delete("s1");
		await board.runner.sweep();
		board.tick(GONE_MS - 1);
		await board.runner.sweep();
		expect(board.starts).toHaveLength(1);
		board.tick(1);
		await board.runner.sweep();
		await settle();
		expect(board.events.some(event => event.op === "expire")).toBe(true);
		expect(board.starts).toHaveLength(2);
		expect(board.state().tasks[0]?.start?.sessionId).toBe("s2");
	});

	test("a session gone only briefly, as while a restarted server attaches to it, keeps its Board task", async () => {
		const board = harness();
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		board.alive.delete("s1");
		await board.runner.sweep();
		board.tick(GONE_MS - 1);
		board.alive.add("s1");
		await board.runner.sweep();
		board.alive.delete("s1");
		board.tick(GONE_MS - 1);
		await board.runner.sweep();
		expect(board.events.some(event => event.op === "expire")).toBe(false);
	});

	test("a server that does not run the unattended work starts and wakes nothing", async () => {
		const board = harness({ owner: false });
		board.runner.changed();
		board.apply({ op: "post", by: { kind: "user" }, workspace: "/w", title: "First" });
		await settle();
		expect(board.starts).toEqual([]);
	});
});
