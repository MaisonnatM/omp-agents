import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BotId } from "../shared/bots";
import type { RouterTask } from "../shared/router";
import type { WithdrawnMessage } from "../shared/sessions";
import { LOOP_REPEATS, MAX_RESTARTS, readTaskTail, RouterSupervisor, STALL_CHECKS, type TaskTail } from "./router-supervisor";
import { RouterTasks } from "./router-tasks";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-router-supervisor-"));
	dirs.push(dir);
	return dir;
};

const atlas = "atlas" as BotId;

const task = (fields: Partial<RouterTask> = {}): RouterTask => ({
	id: "t1",
	botId: atlas,
	sessionId: "s1",
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

/**
 * A supervisor over one task whose session `s1` the test drives: `tail` is what its file ends on, `live` whether it
 * runs here and `busy` whether its turn runs. Each `tick()` is one look of the timer.
 */
function harness(fields: Partial<RouterTask> = {}) {
	const told: string[] = [];
	const ended: string[] = [];
	const prompts: string[] = [];
	const resumed: string[] = [];
	let interrupts = 0;
	const state = { live: true, busy: true, resumes: null as string | null, activity: "", tail: { mark: "e1", repeated: null, lastError: null } as TaskTail, withdrawn: [] as WithdrawnMessage[] };
	const tasks = new RouterTasks({ path: join(tempDir(), "router-tasks.json"), active: () => true, tell: async (_botId, text) => void told.push(text), end: async sessionId => void ended.push(sessionId), now: () => 10, onChange() {} });
	tasks.apply({ op: "add", task: task(fields) });
	tasks.bind("i1", "t1", "s1");
	const session = { prompt: async (_agentId: string | null, text: string) => void prompts.push(text) };
	const supervisor = new RouterSupervisor({
		tasks,
		active: () => true,
		live: () =>
			state.live
				? {
						busy: state.busy,
						activity: state.activity,
						interrupt: async () => {
							interrupts++;
							return state.withdrawn;
						},
					}
				: null,
		tail: () => state.tail,
		reach: async sessionId => {
			if (state.resumes !== null) throw new Error(state.resumes);
			if (!state.live) resumed.push(sessionId);
			return session;
		},
		tell: async (_botId, text) => void told.push(text),
	});
	const tick = async (times = 1) => {
		for (let i = 0; i < times; i++) await supervisor.check();
	};
	return { file: tasks, tasks, state, tick, told, ended, prompts, resumed, interrupts: () => interrupts };
}

test("a task whose session keeps writing is left alone", async () => {
	const { file, state, tick, told, prompts, interrupts } = harness();
	for (let i = 0; i < STALL_CHECKS * 3; i++) {
		state.tail = { ...state.tail, mark: `e${i}` };
		await tick();
	}
	expect(file.get("t1")).toMatchObject({ status: "working", restarts: 0, note: null });
	expect([told, prompts, interrupts()]).toEqual([[], [], 0]);
});

test("a session whose subagents work while its own file stays still is left alone", async () => {
	const { file, state, tick } = harness();
	for (let i = 0; i < STALL_CHECKS * 2; i++) {
		state.activity = `explore: reading file ${i}`;
		await tick();
	}
	expect(file.get("t1")).toMatchObject({ restarts: 0 });
});

test("a session that waits on you is not stuck", async () => {
	const { file, state, tick } = harness();
	state.busy = false;
	await tick(STALL_CHECKS * 2);
	expect(file.get("t1")).toMatchObject({ status: "working", restarts: 0 });
});

test("a stalled task is restarted once, with the reason and its last error, and its Router hears of it", async () => {
	const { file, tasks, state, tick, told, prompts, interrupts } = harness();
	state.tail = { mark: "e1", repeated: null, lastError: "ECONNREFUSED 127.0.0.1:5432" };
	state.withdrawn = [{ text: "The CI run failed again.", images: [] }];
	// The first look sees the mark, the next ones see it unchanged.
	await tick(STALL_CHECKS);
	expect(file.get("t1")).toMatchObject({ restarts: 0 });
	await tick();
	expect(file.get("t1")).toMatchObject({ status: "working", restarts: 1, note: "it made no progress for 6 minutes" });
	expect(interrupts()).toBe(1);
	expect(prompts).toEqual([
		"The supervisor restarted you: it made no progress for 6 minutes. Last error: ECONNREFUSED 127.0.0.1:5432. Continue the task.\n\nThese messages were waiting for you when it stopped you:\n\nThe CI run failed again.",
	]);
	expect(told).toEqual(['FYI: the supervisor restarted task "Fix the flaky test": it made no progress for 6 minutes.']);
	// The turn the stop ended does not move the task to review, nor tell the Router it finished.
	await tasks.turnEnded("i1", null);
	expect(file.get("t1")).toMatchObject({ status: "working" });
	expect(told).toHaveLength(1);
	// Its counts start over, so the next look does not restart it again.
	await tick();
	expect(file.get("t1")).toMatchObject({ restarts: 1 });
});

test("a quiet task restarts without telling its Router", async () => {
	const { file, tick, told, prompts } = harness({ quiet: true });
	await tick(STALL_CHECKS + 1);
	expect(file.get("t1")).toMatchObject({ restarts: 1 });
	expect(prompts).toHaveLength(1);
	expect(told).toEqual([]);
});

test("a task looping on the same tool call is restarted at once", async () => {
	const { file, state, tick, prompts } = harness();
	state.tail = { mark: "e9", repeated: { call: "bash bun run profile", times: LOOP_REPEATS - 1 }, lastError: null };
	await tick();
	expect(file.get("t1")).toMatchObject({ restarts: 0 });
	state.tail = { mark: "e10", repeated: { call: "bash bun run profile", times: LOOP_REPEATS }, lastError: null };
	await tick();
	expect(file.get("t1")).toMatchObject({ restarts: 1, note: `it ran bash bun run profile ${LOOP_REPEATS} times in a row` });
	expect(prompts).toEqual([`The supervisor restarted you: it ran bash bun run profile ${LOOP_REPEATS} times in a row. Last error: none. Continue the task.`]);
});

test("a task whose session died is resumed with the follow-up", async () => {
	const { file, state, tick, prompts, resumed, interrupts } = harness();
	state.live = false;
	await tick(STALL_CHECKS + 1);
	expect(file.get("t1")).toMatchObject({ restarts: 1, note: "its session died" });
	expect(resumed).toEqual(["s1"]);
	expect(interrupts()).toBe(0);
	expect(prompts).toEqual(["The supervisor restarted you: its session died. Last error: none. Continue the task."]);
});

test("a session gone from this server that still writes is not dead", async () => {
	const { file, state, tick } = harness();
	state.live = false;
	for (let i = 0; i < STALL_CHECKS * 2; i++) {
		state.tail = { ...state.tail, mark: `e${i}` };
		await tick();
	}
	expect(file.get("t1")).toMatchObject({ restarts: 0 });
});

test(`after ${MAX_RESTARTS} restarts a stuck task is stopped, its session ended, and its Router told`, async () => {
	const { file, tasks, tick, told, ended, prompts } = harness();
	for (let restart = 1; restart <= MAX_RESTARTS; restart++) {
		await tick(STALL_CHECKS + 1);
		expect(file.get("t1")).toMatchObject({ restarts: restart });
		// The restart's follow-up starts a turn.
		tasks.turnStarted("i1");
	}
	await tick(STALL_CHECKS + 1);
	expect(file.get("t1")).toMatchObject({ status: "stopped", restarts: MAX_RESTARTS, note: "it made no progress for 6 minutes" });
	expect(ended).toEqual(["s1"]);
	expect(prompts).toHaveLength(MAX_RESTARTS);
	expect(told.at(-1)).toBe(`The supervisor stopped task "Fix the flaky test" after ${MAX_RESTARTS} restarts: it made no progress for 6 minutes.`);
	// A stopped task is no longer looked at.
	await tick(STALL_CHECKS + 1);
	expect(told).toHaveLength(MAX_RESTARTS + 1);
});

test("a restart that cannot reach the session counts nothing, stops the task with why, and tells its Router", async () => {
	const { file, state, tick, told, ended, prompts } = harness();
	state.live = false;
	state.resumes = "Cannot resume the session: it is gone";
	await tick(STALL_CHECKS + 1);
	expect(file.get("t1")).toMatchObject({ status: "stopped", restarts: 0, note: "The supervisor could not restart it: Cannot resume the session: it is gone" });
	expect(ended).toEqual(["s1"]);
	expect(prompts).toEqual([]);
	expect(told).toEqual(['The supervisor stopped task "Fix the flaky test": it could not restart it: Cannot resume the session: it is gone.']);
});

test("a server that does not hold the owner lock supervises nothing", async () => {
	const tasks = new RouterTasks({ path: join(tempDir(), "router-tasks.json"), active: () => true, tell: async () => {}, end: async () => {}, now: () => 1, onChange() {} });
	tasks.apply({ op: "add", task: task() });
	const supervisor = new RouterSupervisor({
		tasks,
		active: () => false,
		live: () => null,
		tail: () => ({ mark: "e1", repeated: null, lastError: null }),
		reach: () => Promise.reject(new Error("not reached")),
		tell: () => Promise.reject(new Error("not told")),
	});
	for (let i = 0; i < STALL_CHECKS * 2; i++) await supervisor.check();
	expect(tasks.get("t1")).toMatchObject({ status: "working", restarts: 0 });
});

const line = (id: string, message: Record<string, unknown>) => JSON.stringify({ type: "message", id, timestamp: "2026-11-02T10:00:00.000Z", message });
const call = (id: string, command: string) => ({ role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command } }] });
const result = (id: string, text: string, isError = false) => ({ role: "toolResult", toolCallId: id, toolName: "bash", isError, content: [{ type: "text", text }] });

test("a session file's end names its newest entry, the call it repeats since the last prompt, and its last error", () => {
	const path = join(tempDir(), "session.jsonl");
	const lines = [
		line("p0", { role: "user", content: "Profile the dialog." }),
		line("a0", call("c0", "bun run profile")),
		line("r0", result("c0", "old failure", true)),
		line("p1", { role: "user", content: "The supervisor restarted you." }),
		line("a1", call("c1", "bun run build")),
		line("r1", result("c1", "error: Cannot find module 'x'", true)),
		...[2, 3, 4].flatMap(n => [line(`a${n}`, call(`c${n}`, "bun run profile")), line(`r${n}`, result(`c${n}`, "same numbers"))]),
	];
	writeFileSync(path, `${lines.join("\n")}\n`);
	expect(readTaskTail(path)).toEqual({ mark: "r4", repeated: { call: "bash bun run profile", times: 3 }, lastError: "error: Cannot find module 'x'" });
	expect(readTaskTail(join(tempDir(), "gone.jsonl"))).toEqual({ mark: null, repeated: null, lastError: null });
});
