import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { addBuiltInRoutines, BUILT_IN_ROUTINES, ROUTINE_RECEIPT_PROMPT } from "./built-in-routines";
import { sourceDir } from "./resources";
import type { RoutineSpec } from "../routines";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setUp(): { routines: RoutinesFile; save: (routine: RoutineSpec) => void; added: string } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-built-in-"));
	dirs.push(dir);
	const routines = new RoutinesFile(join(dir, "routines.json"), { file: join(dir, "bots.json"), dir: join(dir, "bots") });
	const save = (routine: RoutineSpec): void => {
		routines.apply({ op: "save", routine }, 1_000);
	};
	return { routines, save, added: join(dir, "built-in-routines.json") };
}

test("the built-in routines join the routines list once, disabled, in the dashboard's Workspace, and one you delete stays deleted", () => {
	const { routines, save, added } = setUp();

	addBuiltInRoutines(added, save);
	flushJsonFiles();
	expect(routines.value.map(({ id, workspace, name, enabled, schedules }) => ({ id, workspace, name, enabled, schedules }))).toEqual([
		{ id: "harness-review-weekly", workspace: sourceDir, name: "Weekly harness review", enabled: false, schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }] },
		{ id: "routine-receipt-weekly", workspace: sourceDir, name: "Friday routine receipt", enabled: false, schedules: [{ kind: "weekly", days: [5], time: { hour: 17, minute: 0 } }] },
	]);

	routines.apply({ op: "remove", id: "harness-review-weekly" }, 2_000);
	addBuiltInRoutines(added, save);
	expect(routines.value.map(({ id }) => id)).toEqual(["routine-receipt-weekly"]);
});

test("the routine receipt reads quiet runs from the Board's quiet dones, and names no Bot", () => {
	for (const part of ["board-events.jsonl", '"quiet":true', "outcome.task"]) expect(ROUTINE_RECEIPT_PROMPT).toContain(part);
	for (const gone of ["Bot", "stay_quiet", "sessionId"]) expect(ROUTINE_RECEIPT_PROMPT).not.toContain(gone);
});

test("the harness review's prompt reads the ship trace, LEARNINGS.md, and failed lands and sessions, and edits nothing", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.task.kind === "prompt" ? review!.task.prompt : "";
	for (const part of ["ship-trace.jsonl", "LEARNINGS.md", "merges.json", "routines.json", "Exactly one harness change", "Five past failures", "Do not edit"]) expect(prompt).toContain(part);
});

test("the harness review saves its five failures as replay tasks, judges last week's replay, and writes only under its cache folder", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.task.kind === "prompt" ? review!.task.prompt : "";
	for (const part of [
		"model-replay.ts candidates --sessions",
		"> ~/.cache/omp-harness-review/<today>-tasks.json",
		"model-replay.ts run --tasks ~/.cache/omp-harness-review/<today>-tasks.json --models <worker model> --out ~/.cache/omp-harness-review/<today>",
		"model-replay.ts summary --by-task --out ~/.cache/omp-harness-review/<date>",
		"last week's replay was never run",
		"yampa-ai/yampa",
		"moreRounds",
		"the only files you may write are under `~/.cache/omp-harness-review/`",
	])
		expect(prompt).toContain(part);
});
