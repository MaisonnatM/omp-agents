import { fromAny } from "@total-typescript/shoehorn";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadExtension } from "./fake-extension-api";
import routerExtension, { FINISH_TOOL, type FinishTaskParams, FOLLOW_TOOL, type FollowParams, ROUTER_FLAGS, START_TOOL, type StartTaskParams } from "./router-extension";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The extension loaded as omp loads it for Router `atlas`, working in a fresh directory, its flags but those `unset` names. */
function loaded(unset: string[] = []) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-router-extension-"));
	dirs.push(dir);
	const inbox = join(dir, "router-inbox");
	const tasksFile = join(dir, "router-tasks.json");
	const flags = new Map<string, string>([
		[ROUTER_FLAGS.bot, "atlas"],
		[ROUTER_FLAGS.inbox, inbox],
		[ROUTER_FLAGS.tasks, tasksFile],
	]);
	for (const name of unset) flags.delete(name);
	const left = () => (existsSync(inbox) ? readdirSync(inbox).sort().map(name => JSON.parse(readFileSync(join(inbox, name), "utf8"))) : []);
	return { ...loadExtension(routerExtension, flags, dir), dir, tasksFile, left };
}

test("start_task leaves one start per call, each with its own id, in the Router's workspace unless it names another", async () => {
	const { call, dir, left } = loaded();
	const pr = { kind: "pull-request", owner: "acme", repo: "webapp", number: 7 } as const;
	await call<StartTaskParams>(START_TOOL, { title: " Fix the flaky test ", prompt: "Find and fix it." });
	await call<StartTaskParams>(START_TOOL, { title: "Review #7", prompt: "Review it.", cwd: tmpdir(), follows: [pr], quiet: true });
	const requests = left();
	expect(requests).toHaveLength(2);
	expect(requests).toEqual(
		expect.arrayContaining([
			{ botId: "atlas", change: { op: "start", task: { id: expect.stringMatching(UUID), title: "Fix the flaky test", prompt: "Find and fix it.", cwd: dir, follows: [], quiet: false } } },
			{ botId: "atlas", change: { op: "start", task: { id: expect.stringMatching(UUID), title: "Review #7", prompt: "Review it.", cwd: tmpdir(), follows: [pr], quiet: true } } },
		]),
	);
	expect(requests[0].change.task.id).not.toBe(requests[1].change.task.id);
});

test("follow and finish_task leave their change for the task they name", async () => {
	const { call, left } = loaded();
	await call<FollowParams>(FOLLOW_TOOL, { taskId: "t1", follows: [{ kind: "slack-thread", channel: "C1", ts: "17.2" }] });
	await call<FinishTaskParams>(FINISH_TOOL, { taskId: "t1", status: "stopped", note: "Not needed." });
	expect(left()).toEqual(
		expect.arrayContaining([
			{ botId: "atlas", change: { op: "follow", id: "t1", follows: [{ kind: "slack-thread", channel: "C1", ts: "17.2" }] } },
			{ botId: "atlas", change: { op: "finish", id: "t1", status: "stopped", note: "Not needed." } },
		]),
	);
});

test("a directory that is not one, a follow that is no such thing, or a session that is not a Router leaves nothing", async () => {
	const { call, dir, left } = loaded();
	await expect(call<StartTaskParams>(START_TOOL, { title: "x", prompt: "y", cwd: "work" })).rejects.toThrow("is not the absolute path of a directory.");
	await expect(call<StartTaskParams>(START_TOOL, { title: "x", prompt: "y", cwd: join(dir, "missing") })).rejects.toThrow("is not the absolute path of a directory.");
	await expect(call<FollowParams>(FOLLOW_TOOL, { taskId: "t1", follows: [fromAny({ kind: "email", id: "x" })] })).rejects.toThrow("is not a pull request, Slack thread, or Linear issue to follow.");
	expect(left()).toEqual([]);
	const plain = loaded([ROUTER_FLAGS.bot]);
	await expect(plain.call<StartTaskParams>(START_TOOL, { title: "x", prompt: "y" })).rejects.toThrow("This session is not an omp-agents Router.");
	expect(plain.prompt()).toBeUndefined();
});

test("each turn's system prompt lists the Router's open tasks, and only its own", () => {
	const { prompt, tasksFile } = loaded();
	expect(prompt()?.at(-1)).toBe("You have no open tasks.");
	const task = { botId: "atlas", sessionId: "s1", cwd: "/work", prompt: "Do it.", follows: [], quiet: false, startedAt: 1, updatedAt: 1, restarts: 0, note: null };
	writeFileSync(
		tasksFile,
		JSON.stringify({
			tasks: [
				{ ...task, id: "t1", title: "Fix the test", status: "review", follows: [{ kind: "linear", id: "ENG-4" }] },
				{ ...task, id: "t2", title: "Old", status: "done" },
				{ ...task, id: "t3", title: "Not mine", status: "working", botId: "scout" },
			],
		}),
	);
	const lines = prompt()!;
	expect(lines[0]).toBe("base");
	expect(lines[1]).toContain(`\`${START_TOOL}\` starts one task`);
	expect(lines[2]).toBe(`Your open tasks:\n- ${JSON.stringify({ id: "t1", title: "Fix the test", status: "review", follows: ["linear:eng-4"] })}`);
	expect(prompt("sub")).toBeUndefined();
});
