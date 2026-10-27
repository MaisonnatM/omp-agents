import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { HOME } from "../paths";
import type { Schedules } from "../routines";
import type { BotId, BotSpec } from "../shared/bots";
import { RoutinesFile, ROUTINES_BOT_ID, routinesBot } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a run from before `outcome` reads its command result, and a malformed or missing one as pending, and the routine stays", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	const routine = {
		id: "r1",
		name: "Prune",
		cwd: "~/code",
		schedule: { kind: "every", minutes: 60 },
		task: { kind: "command", command: "git worktree prune" },
		skill: null,
		enabled: true,
		createdAt: 1,
		done: {},
		runs: [
			{ at: 4, queued: false, started: [], errors: [], command: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
			{ at: 3, queued: false, started: [], errors: [], command: { phase: "running", startedAt: 3 } },
			{ at: 2, queued: false, started: [], errors: [], command: { phase: "exited", code: "0", output: "ok\n", startedAt: 2, endedAt: 3 } },
			{ at: 1, queued: false, started: [], errors: [] },
		],
	};
	writeFileSync(path, JSON.stringify({ routines: [routine] }));
	expect(new RoutinesFile(path).value[0]?.runs.map(run => run.outcome)).toEqual([
		{ kind: "command", run: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
		{ kind: "command", run: { phase: "running", startedAt: 3 } },
		{ kind: "pending", queued: false },
		{ kind: "pending", queued: false },
	]);
});

test("an older file keeps its other routines, reads one schedule as a list, and a run's queue and started sessions as an outcome, and drops a pull request or project routine", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	const command = {
		id: "r1",
		name: "Prune",
		cwd: "~/code",
		schedule: { kind: "every" as const, minutes: 60 },
		task: { kind: "command" as const, command: "git worktree prune" },
		skill: null,
		enabled: true,
		createdAt: 1,
		done: {},
		runs: [
			{ at: 4, queue: ["single"], started: [], errors: [], command: null },
			{ at: 3, queue: [], started: [{ label: "Notes", instanceId: "i1", sessionId: "s1" }], errors: [], command: null },
			{ at: 2, queued: false, started: [{ label: "a", instanceId: "i2", sessionId: "s2" }, { label: "b", instanceId: "i3", sessionId: "s3" }], errors: [], command: null },
			{ at: 1, queue: [], started: [], errors: [], command: null },
		],
	};
	const reviews = {
		...command,
		id: "r2",
		name: "Reviews",
		task: { kind: "pull-requests", action: "review" },
	};
	const updates = {
		...command,
		id: "r3",
		name: "Updates",
		task: { kind: "project", projectId: "p1", prompt: "Check #billing-bugs." },
		runs: [{ at: 1, outcome: { kind: "project", projectId: "p1" }, errors: [] }],
	};
	writeFileSync(path, JSON.stringify({ routines: [reviews, command, { ...reviews, name: "" }, updates] }));
	const file = new RoutinesFile(path);
	const { schedule, done: _done, runs: _runs, cwd: _cwd, skill: _skill, ...kept } = command;
	expect(file.value).toEqual([
		{
			...kept,
			botId: ROUTINES_BOT_ID,
			schedules: [schedule],
			runs: [
				{ at: 4, outcome: { kind: "pending", queued: true }, errors: [] },
				{ at: 3, outcome: { kind: "sent", sessionId: "s1" }, errors: [] },
				{ at: 2, outcome: { kind: "sent", sessionId: "s2" }, errors: [] },
				{ at: 1, outcome: { kind: "pending", queued: false }, errors: [] },
			],
		},
	]);
	expect(existsSync(`${path}.invalid`)).toBe(false);

	file.apply({ op: "enable", id: "r1", enabled: false }, 2);
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: { task: { kind: string }; schedules?: unknown; schedule?: unknown }[] };
	expect(saved.routines.map(routine => routine.task.kind)).toEqual(["command"]);
	expect(saved.routines[0]?.schedules).toEqual([{ kind: "every", minutes: 60 }]);
	expect(saved.routines[0]?.schedule).toBeUndefined();
});

test("a file from before Bots gives each routine a Bot: a Bot's message to that Bot, the rest to one Routines Bot in the first one's workspace, each still doing what it did", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	const base = { schedules: [{ kind: "every", minutes: 60 }], skill: null, enabled: true, createdAt: 1 };
	const routines = [
		{ ...base, id: "r1", name: "Retro", cwd: "~/code", task: { kind: "prompt", prompt: "Write the daily retro.", pin: true }, skill: "retro", runs: [{ at: 2, outcome: { kind: "session", instanceId: "i1", sessionId: "s1" }, errors: [] }] },
		{ ...base, id: "r2", name: "Prune", cwd: "~/it's", task: { kind: "command", command: "git worktree prune" }, runs: [] },
		{ ...base, id: "r3", name: "Standup", cwd: "~/code", task: { kind: "bot", botId: "scout", prompt: "Post the standup." }, runs: [{ at: 3, outcome: { kind: "bot", botId: "scout", sessionId: "s2" }, errors: [] }] },
		{ ...base, id: "r4", name: "Notes", cwd: "~/notes", task: { kind: "prompt", prompt: "Tidy the notes." }, runs: [] },
		{ ...base, id: "r5", name: "Lint", cwd: "~/code", task: { kind: "command", command: "bun run lint" }, runs: [] },
	];
	writeFileSync(path, JSON.stringify({ routines }));
	const file = new RoutinesFile(path);
	expect(file.value.map(({ id, botId, task, runs }) => ({ id, botId, task, outcomes: runs.map(run => run.outcome) }))).toEqual([
		{ id: "r1", botId: ROUTINES_BOT_ID, task: { kind: "prompt", prompt: "/skill:retro Write the daily retro." }, outcomes: [{ kind: "sent", sessionId: "s1" }] },
		{ id: "r2", botId: ROUTINES_BOT_ID, task: { kind: "command", command: `cd '${HOME}/it'\\''s' && git worktree prune` }, outcomes: [] },
		{ id: "r3", botId: "scout" as BotId, task: { kind: "prompt", prompt: "Post the standup." }, outcomes: [{ kind: "sent", sessionId: "s2" }] },
		{ id: "r4", botId: ROUTINES_BOT_ID, task: { kind: "prompt", prompt: "Work in ~/notes.\n\nTidy the notes." }, outcomes: [] },
		{ id: "r5", botId: ROUTINES_BOT_ID, task: { kind: "command", command: "bun run lint" }, outcomes: [] },
	]);

	const adopted: BotSpec[] = [];
	file.migrate(bot => void adopted.push(bot));
	file.migrate(bot => void adopted.push(bot));
	expect(adopted).toEqual([routinesBot("~/code")]);
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: Record<string, unknown>[] };
	expect(saved.routines.map(routine => [routine.botId, "cwd" in routine, "skill" in routine])).toEqual(routines.map(({ id }) => [id === "r3" ? "scout" : ROUTINES_BOT_ID, false, false]));

	const next = new RoutinesFile(path);
	next.migrate(bot => void adopted.push(bot));
	expect([adopted.length, next.value]).toEqual([1, file.value]);
});

test("a file from before Bots whose routines all messaged Bots creates no Routines Bot", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	const routine = { id: "r1", name: "Standup", cwd: "~/code", schedules: [{ kind: "every", minutes: 60 }], task: { kind: "bot", botId: "scout", prompt: "Post the standup." }, skill: null, enabled: true, createdAt: 1, runs: [] };
	writeFileSync(path, JSON.stringify({ routines: [routine] }));
	const file = new RoutinesFile(path);
	const adopted: BotSpec[] = [];
	file.migrate(bot => void adopted.push(bot));
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: { botId: string }[] };
	expect([adopted, saved.routines[0]?.botId]).toEqual([[], "scout"]);
});

test("deleting a Bot's routines leaves the other Bots' routines", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const file = new RoutinesFile(join(dir, "routines.json"));
	const spec = (id: string, botId: string) => ({ id, botId: botId as BotId, name: id, schedules: [{ kind: "every", minutes: 60 }] as Schedules, task: { kind: "prompt", prompt: "Hi." } as const, enabled: true });
	file.apply({ op: "save", routine: spec("r1", "scout") }, 1);
	file.apply({ op: "save", routine: spec("r2", "ranger") }, 1);
	file.apply({ op: "save", routine: spec("r3", "scout") }, 1);
	expect([file.removeBot("scout" as BotId), file.removeBot("scout" as BotId), file.value.map(({ id }) => id)]).toEqual([true, false, ["r2"]]);
});

test("a file that is not a list of routines moves aside", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	writeFileSync(path, JSON.stringify({ routines: [{ id: "r1" }] }));
	expect(new RoutinesFile(path).value).toEqual([]);
	expect(existsSync(path)).toBe(false);
	expect(existsSync(`${path}.invalid`)).toBe(true);
});
