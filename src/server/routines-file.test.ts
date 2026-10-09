import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { RoutinesFile } from "./routines-file";

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
	expect(new RoutinesFile(path).routines[0]?.runs.map(run => run.outcome)).toEqual([
		{ kind: "command", run: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
		{ kind: "command", run: { phase: "running", startedAt: 3 } },
		{ kind: "pending", queued: false },
		{ kind: "pending", queued: false },
	]);
});

test("an older file keeps its other routines, reads one schedule as a list and a run's queue and started sessions as an outcome, and drops a pull request routine", () => {
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
	writeFileSync(path, JSON.stringify({ routines: [reviews, command, { ...reviews, name: "" }] }));
	const file = new RoutinesFile(path);
	const { schedule, done: _done, runs: _runs, ...kept } = command;
	expect(file.routines).toEqual([
		{
			...kept,
			schedules: [schedule],
			runs: [
				{ at: 4, outcome: { kind: "pending", queued: true }, errors: [] },
				{ at: 3, outcome: { kind: "session", instanceId: "i1", sessionId: "s1" }, errors: [] },
				{ at: 2, outcome: { kind: "session", instanceId: "i2", sessionId: "s2" }, errors: [] },
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

test("a prompt task from before `pin` reads as unpinned, and the next save writes it", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	const routine = {
		id: "r1",
		name: "Daily retro",
		cwd: "~/code",
		schedules: [{ kind: "every", minutes: 60 }],
		task: { kind: "prompt", prompt: "Write the daily retro." },
		skill: null,
		enabled: true,
		createdAt: 1,
		runs: [],
	};
	writeFileSync(path, JSON.stringify({ routines: [routine] }));
	const file = new RoutinesFile(path);
	expect(file.routines[0]?.task).toEqual({ kind: "prompt", prompt: "Write the daily retro.", pin: false });
	expect(existsSync(`${path}.invalid`)).toBe(false);

	file.apply({ op: "enable", id: "r1", enabled: false }, 2);
	flushJsonFiles();
	const saved = JSON.parse(readFileSync(path, "utf8")) as { routines: { task: unknown }[] };
	expect(saved.routines[0]?.task).toEqual({ kind: "prompt", prompt: "Write the daily retro.", pin: false });
});

test("a file that is not a list of routines moves aside", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-routines-"));
	dirs.push(dir);
	const path = join(dir, "omp-agents", "routines.json");
	mkdirSync(join(dir, "omp-agents"));
	writeFileSync(path, JSON.stringify({ routines: [{ id: "r1" }] }));
	expect(new RoutinesFile(path).routines).toEqual([]);
	expect(existsSync(path)).toBe(false);
	expect(existsSync(`${path}.invalid`)).toBe(true);
});
