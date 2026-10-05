import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("a run without a command result, or with a malformed one, reads as having none, and the routine stays", () => {
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
			{ at: 4, queue: [], started: [], errors: [], command: { phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 } },
			{ at: 3, queue: [], started: [], errors: [], command: { phase: "running", startedAt: 3 } },
			{ at: 2, queue: [], started: [], errors: [], command: { phase: "exited", code: "0", output: "ok\n", startedAt: 2, endedAt: 3 } },
			{ at: 1, queue: [], started: [], errors: [] },
		],
	};
	writeFileSync(path, JSON.stringify({ routines: [routine] }));
	expect(new RoutinesFile(path).routines[0]?.runs.map(run => run.command)).toEqual([
		{ phase: "exited", code: 0, output: "ok\n", startedAt: 4, endedAt: 5 },
		{ phase: "running", startedAt: 3 },
		null,
		null,
	]);
});
