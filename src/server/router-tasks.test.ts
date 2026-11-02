import { afterEach, expect, test } from "bun:test";
import { flushJsonFiles } from "../fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotId } from "../shared/bots";
import type { RouterTask } from "../shared/router";
import { RouterTasks, type RouterTasksDeps } from "./router-tasks";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const atlas = "atlas" as BotId;

const task = (fields: Partial<RouterTask> = {}): RouterTask => ({
	id: "t1",
	botId: atlas,
	sessionId: null,
	title: "Fix the flaky test",
	cwd: "/work/webapp",
	prompt: "Find and fix it.",
	follows: [],
	status: "working",
	quiet: false,
	startedAt: 1,
	updatedAt: 1,
	restarts: 0,
	note: null,
	...fields,
});

/** Tasks over a fresh file, with `active` whether this server holds the owner lock. */
function harness({ active = true } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-router-tasks-"));
	dirs.push(dir);
	const path = join(dir, "router-tasks.json");
	const told: [BotId, string][] = [];
	const ended: string[] = [];
	let changes = 0;
	let now = 100;
	const tasks = new RouterTasks({
		path,
		active: () => active,
		tell: async (botId, text) => void told.push([botId, text]),
		end: async sessionId => void ended.push(sessionId),
		now: () => now++,
		onChange: () => changes++,
	});
	return { path, file: tasks, tasks, told, ended, changes: () => changes };
}

test("a task whose session ends its turn waits for review and tells its Router the reply's last line, once", async () => {
	const { file, tasks, told, changes } = harness();
	tasks.apply({ op: "add", task: task() });
	tasks.bind("i1", "t1", "s1");
	expect(file.get("t1")).toMatchObject({ sessionId: "s1", status: "working" });
	await tasks.turnEnded("i1", "I found the race.\n\nIt is fixed in `retry.ts`, and the test passes.\n");
	expect(file.get("t1")).toMatchObject({ status: "review" });
	expect(told).toEqual([[atlas, 'Task "Fix the flaky test" finished: It is fixed in `retry.ts`, and the test passes.']]);
	await tasks.turnEnded("i1", "Still done.");
	expect(tasks.exited("i1", false)).toBeNull();
	expect(told).toHaveLength(1);
	expect(changes()).toBe(3);
});

test("a quiet task moves to review without a word, and a session End session ends mid-turn moves its task too", async () => {
	const { file, tasks, told } = harness();
	tasks.apply({ op: "add", task: task({ quiet: true }) });
	tasks.apply({ op: "add", task: task({ id: "t2", title: "Review the docs" }) });
	tasks.bind("i1", "t1", "s1");
	tasks.bind("i2", "t2", "s2");
	await tasks.turnEnded("i1", "Done.");
	expect(tasks.exited("i2", true)).toBeNull();
	expect(file.value.map(({ status }) => status)).toEqual(["review", "review"]);
	expect(told).toEqual([[atlas, 'Task "Review the docs" finished: its session ended without a reply.']]);
});

test("a session that goes down on its own mid-turn hands its task back for the supervisor rather than to review", () => {
	const { file, tasks, told } = harness();
	tasks.apply({ op: "add", task: task() });
	tasks.bind("i1", "t1", "s1");
	expect(tasks.exited("i1", false)).toMatchObject({ id: "t1", status: "working" });
	expect(file.get("t1")).toMatchObject({ status: "working" });
	expect(told).toEqual([]);
});

test("a task's session resumed, as after a restart, moves its task too, and a prompt to a task waiting for review sets it working", async () => {
	const { file, tasks } = harness();
	tasks.apply({ op: "add", task: task({ sessionId: "s1" }) });
	tasks.join({ kind: "resume", sessionId: "s1" }).attach({ instanceId: "i9", sessionId: "s1", cwd: "/work/webapp" });
	// Another session's resume binds nothing.
	tasks.join({ kind: "resume", sessionId: "s8" }).attach({ instanceId: "i8", sessionId: "s8", cwd: "/work/webapp" });
	await tasks.turnEnded("i8", "Done.");
	await tasks.turnEnded("i9", "Done.");
	expect(file.get("t1")?.status).toBe("review");
	tasks.turnStarted("i9");
	expect(file.get("t1")?.status).toBe("working");
	tasks.switched("i9", "s2");
	expect(file.get("t1")?.sessionId).toBe("s2");
});

test("a server without the owner lock changes no task and tells nobody", async () => {
	const { file, tasks, told } = harness({ active: false });
	tasks.apply({ op: "add", task: task({ sessionId: "s1" }) });
	tasks.join({ kind: "resume", sessionId: "s1" }).attach({ instanceId: "i1", sessionId: "s1", cwd: "/work/webapp" });
	await tasks.turnEnded("i1", "Done.");
	expect(file.get("t1")?.status).toBe("working");
	expect(told).toEqual([]);
});

test("the page marks a task done, or stops it, which ends its session; a stopped task's exit tells nobody", () => {
	const { file, tasks, told, ended, changes } = harness();
	tasks.apply({ op: "add", task: task({ sessionId: "s1" }) });
	tasks.apply({ op: "add", task: task({ id: "t2", sessionId: "s2" }) });
	const before = changes();
	expect(tasks.change({ op: "finish", id: "t1", status: "done", note: null })).toBe(true);
	expect(tasks.change({ op: "finish", id: "t2", status: "stopped", note: null })).toBe(true);
	expect(tasks.change({ op: "finish", id: "t2", status: "stopped", note: null })).toBe(false);
	expect(tasks.change({ op: "finish", id: "gone", status: "done", note: null })).toBe(false);
	expect(changes()).toBe(before + 2);
	expect(file.value.map(({ status }) => status)).toEqual(["done", "stopped"]);
	expect(ended).toEqual(["s2"]);
	expect(tasks.exited("i2", true)).toBeNull();
	expect(told).toEqual([]);
});

test("the Router's finish_task stops a task's session too, and its note stays", () => {
	const { file, tasks, ended } = harness();
	tasks.apply({ op: "add", task: task({ sessionId: "s1" }) });
	expect(tasks.change({ op: "finish", id: "t1", status: "stopped", note: "You asked for something else." })).toBe(true);
	expect(file.get("t1")).toMatchObject({ status: "stopped", note: "You asked for something else." });
	expect(ended).toEqual(["s1"]);
});

test("adding a task twice adds it once, follows add only what is new, and deleting a Bot deletes its tasks", () => {
	const { file, tasks } = harness();
	const pr = { kind: "pull-request", owner: "acme", repo: "webapp", number: 7 } as const;
	expect(tasks.apply({ op: "add", task: task({ follows: [pr] }) })).toBe(true);
	expect(tasks.apply({ op: "add", task: task({ title: "Another" }) })).toBe(false);
	expect(tasks.apply({ op: "follow", id: "t1", follows: [{ ...pr, owner: "Acme" }] })).toBe(false);
	expect(tasks.apply({ op: "follow", id: "t1", follows: [{ kind: "linear", id: "ENG-4" }] })).toBe(true);
	tasks.apply({ op: "add", task: task({ id: "t2", botId: "scout" as BotId }) });
	expect(file.following({ kind: "linear", id: "eng-4" }).map(({ id }) => id)).toEqual(["t1"]);
	expect(file.forBot(atlas).map(({ id }) => id)).toEqual(["t1"]);
	tasks.apply({ op: "remove-bot", botId: atlas });
	expect(file.value.map(({ id }) => id)).toEqual(["t2"]);
});

test("the tasks survive a reload from their file", () => {
	const { path, tasks } = harness();
	tasks.apply({ op: "add", task: task({ follows: [{ kind: "slack-thread", channel: "C1", ts: "17.2" }] }) });
	flushJsonFiles();
	const deps: RouterTasksDeps = { path, active: () => true, tell: async () => {}, end: async () => {}, now: () => 1, onChange() {} };
	expect(new RouterTasks(deps).value).toEqual(tasks.value);
});
