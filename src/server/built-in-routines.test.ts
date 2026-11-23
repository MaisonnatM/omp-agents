import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { BotSpec } from "../shared/bots";
import { addBuiltInRoutines, BUILT_IN_ROUTINES, type BuiltInRoutine, type BuiltInSaves } from "./built-in-routines";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setUp(): { routines: RoutinesFile; bots: BotSpec[]; saves: BuiltInSaves; added: string } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-built-in-"));
	dirs.push(dir);
	const routines = new RoutinesFile(join(dir, "routines.json"));
	const bots: BotSpec[] = [];
	const saves: BuiltInSaves = {
		hasBot: id => bots.some(bot => bot.id === id),
		routine: id => routines.value.find(routine => routine.id === id),
		saveBot: bot => bots.push(bot),
		saveRoutine: routine => routines.apply({ op: "save", routine }, 1_000),
	};
	return { routines, bots, saves, added: join(dir, "built-in-routines.json") };
}

test("the weekly harness review joins the routines list once, disabled, with its Bot, and one you delete stays deleted", () => {
	const { routines, bots, saves, added } = setUp();

	addBuiltInRoutines(added, saves);
	flushJsonFiles();
	expect(routines.value.map(({ id, botId, name, enabled, schedules }) => ({ id, botId, name, enabled, schedules }))).toEqual([
		{ id: "harness-review-weekly", botId: BUILT_IN_ROUTINES[0]!.bot.id, name: "Weekly harness review", enabled: false, schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }] },
	]);
	expect(bots.map(({ id, kind }) => ({ id, kind }))).toEqual([{ id: BUILT_IN_ROUTINES[0]!.bot.id, kind: "routines" }]);

	routines.apply({ op: "remove", id: "harness-review-weekly" }, 2_000);
	addBuiltInRoutines(added, saves);
	expect(routines.value).toEqual([]);
	expect(bots).toHaveLength(1);
});

test("a built-in routine still holding a past prompt gets the current one, keeping its runs and settings, and an edited prompt stays", () => {
	const { routines, saves, added } = setUp();
	const [review] = BUILT_IN_ROUTINES;
	const withPrompt = (prompt: string): BuiltInRoutine => ({ ...review!, routine: { ...review!.routine, task: { kind: "prompt", prompt } }, pastPrompts: ["v1", "v2"] });

	addBuiltInRoutines(added, saves, [withPrompt("v1")]);
	flushJsonFiles();
	routines.apply({ op: "enable", id: "harness-review-weekly", enabled: true }, 2_000);
	routines.claim("harness-review-weekly", 3_000, []);
	addBuiltInRoutines(added, saves, [withPrompt("v3")]);
	const [upgraded] = routines.value;
	expect(upgraded!.task).toEqual({ kind: "prompt", prompt: "v3" });
	expect(upgraded!.enabled).toBe(true);
	expect(upgraded!.runs.map(run => run.at)).toEqual([3_000]);

	routines.apply({ op: "save", routine: { ...review!.routine, enabled: true, task: { kind: "prompt", prompt: "my own review" } } }, 4_000);
	addBuiltInRoutines(added, saves, [withPrompt("v3")]);
	expect(routines.value[0]!.task).toEqual({ kind: "prompt", prompt: "my own review" });
});

test("the shipped harness review prompt replaces the one the first version saved", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.routine.task.kind === "prompt" ? review!.routine.task.prompt : "";
	expect(review!.pastPrompts).toHaveLength(1);
	expect(review!.pastPrompts[0]).toStartWith("Review how the agent harness failed this past week, and propose one change to it.");
	expect(review!.pastPrompts).not.toContain(prompt);
});

test("the harness review's prompt reads the ship trace, LEARNINGS.md, and failed lands and sessions, and edits nothing", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.routine.task.kind === "prompt" ? review!.routine.task.prompt : "";
	for (const part of ["ship-trace.jsonl", "LEARNINGS.md", "merges.json", "routines.json", "Exactly one harness change", "Five past failures", "Do not edit"]) expect(prompt).toContain(part);
});

test("the harness review saves its five failures as replay tasks, judges last week's replay, and writes only under its cache folder", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.routine.task.kind === "prompt" ? review!.routine.task.prompt : "";
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
