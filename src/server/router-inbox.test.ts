import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bot, BotId } from "../shared/bots";
import type { RouterChange, TaskSpec } from "../shared/router";
import type { StartRequest } from "../shared/sessions";
import { RouterInbox } from "./router-inbox";
import { RouterTasks } from "./router-tasks";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const atlas: Bot = { id: "atlas" as BotId, kind: "router", name: "Atlas", job: "", cwd: "/work", model: null, skill: null, shape: "pill", hue: 25, sessionId: "s0", createdAt: "2026-11-02T09:00:00.000Z", pinned: false, section: null };
const helper: Bot = { ...atlas, id: "helper" as BotId, kind: "routines", name: "Helper" };

const start = (id: string, fields: Partial<TaskSpec> = {}): RouterChange => ({
	op: "start",
	task: { id, title: `Task ${id}`, prompt: `Do ${id}.`, cwd: "/work/webapp", follows: [], quiet: false, ...fields },
});

/** An inbox whose session starts succeed unless `refuse` names why, with the tasks a Router's turns move. */
function inbox({ refuse = null as string | null } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-router-inbox-"));
	dirs.push(dir);
	const inboxDir = join(dir, "router-inbox");
	mkdirSync(inboxDir);
	const told: string[] = [];
	const started: StartRequest[] = [];
	const renamed: [string, string][] = [];
	const tell = async (_botId: BotId, text: string) => void told.push(text);
	const tasks = new RouterTasks({ path: join(dir, "router-tasks.json"), active: () => true, tell, end: async () => {}, now: () => 1000, onChange: () => {} });
	const box = new RouterInbox(inboxDir, {
		bots: () => [atlas, helper],
		tasks,
		start: async request => {
			if (refuse) return { ok: false, error: refuse };
			started.push(request);
			return { ok: true, instanceId: `i${started.length}`, workspace: "/work/webapp", prompt: null };
		},
		started: instanceId => ({ sessionId: `s-${instanceId}`, rename: async title => void renamed.push([instanceId, title]) }),
		tell,
		now: () => 1000,
	});
	let n = 0;
	const leave = (botId: BotId, change: RouterChange): void => writeFileSync(join(inboxDir, `${++n}-x.json`), JSON.stringify({ botId, change }));
	return { inboxDir, file: tasks, tasks, box, told, started, renamed, leave };
}

test("two start_task calls start two sessions named after their tasks, and both tasks wait for review once their sessions finish", async () => {
	const { inboxDir, file, tasks, box, told, started, renamed, leave } = inbox();
	leave(atlas.id, start("t1", { follows: [{ kind: "pull-request", owner: "acme", repo: "webapp", number: 7 }] }));
	leave(atlas.id, start("t2", { quiet: true, cwd: "/work/docs" }));
	await box.drain();
	expect(started.map(request => (request.kind === "new" ? { cwd: request.cwd, prompt: request.prompt } : null))).toEqual([
		{ cwd: "/work/webapp", prompt: "Do t1." },
		{ cwd: "/work/docs", prompt: "Do t2." },
	]);
	expect(started.map(request => (request.kind === "new" ? request.subject : null))).toEqual([{ kind: "pull-request", pr: { owner: "acme", repo: "webapp", number: 7 } }, null]);
	expect(renamed).toEqual([
		["i1", "Task t1"],
		["i2", "Task t2"],
	]);
	expect(file.value.map(({ id, botId, sessionId, status }) => ({ id, botId, sessionId, status }))).toEqual([
		{ id: "t1", botId: atlas.id, sessionId: "s-i1", status: "working" },
		{ id: "t2", botId: atlas.id, sessionId: "s-i2", status: "working" },
	]);
	expect(readdirSync(inboxDir)).toEqual([]);
	await tasks.turnEnded("i1", { body: "Opened acme/webapp#8.", suggestions: [] });
	await tasks.turnEnded("i2", { body: "Docs fixed.", suggestions: [] });
	expect(file.value.map(({ status }) => status)).toEqual(["review", "review"]);
	expect(told).toEqual(['Task "Task t1" finished: Opened acme/webapp#8.']);
});

test("a start read again starts nothing, and a failed start stops its task and tells the Router why", async () => {
	const { file, box, started, leave } = inbox();
	leave(atlas.id, start("t1"));
	leave(atlas.id, start("t1", { title: "Again" }));
	await box.drain();
	expect(started).toHaveLength(1);
	expect(file.value.map(({ title }) => title)).toEqual(["Task t1"]);

	const failing = inbox({ refuse: "the directory is not trusted" });
	failing.leave(atlas.id, start("t9"));
	await failing.box.drain();
	expect(failing.file.get("t9")).toMatchObject({ status: "stopped", sessionId: null, note: "the directory is not trusted" });
	expect(failing.told).toEqual(['The dashboard did not start task "Task t9": the directory is not trusted.']);
});

test("follow and finish_task change only the Router's own tasks", async () => {
	const { file, box, told, leave } = inbox();
	leave(atlas.id, start("t1"));
	await box.drain();
	leave(atlas.id, { op: "follow", id: "t1", follows: [{ kind: "linear", id: "ENG-7" }] });
	leave(atlas.id, { op: "finish", id: "t1", status: "done", note: "Merged." });
	leave(atlas.id, { op: "finish", id: "gone", status: "done", note: null });
	await box.drain();
	expect(file.get("t1")).toMatchObject({ follows: [{ kind: "linear", id: "ENG-7" }], status: "done", note: "Merged." });
	expect(told).toEqual(["The dashboard did not mark task gone done: you have no such task."]);
});

test("a request from a Bot that is not a Router, or from no Bot, is set aside", async () => {
	const { inboxDir, file, box, started, leave } = inbox();
	leave(helper.id, start("t1"));
	leave("ghost" as BotId, start("t2"));
	await box.drain();
	expect(started).toEqual([]);
	expect(file.value).toEqual([]);
	expect(readdirSync(inboxDir).sort()).toEqual(["1-x.json.invalid", "2-x.json.invalid"]);
});
