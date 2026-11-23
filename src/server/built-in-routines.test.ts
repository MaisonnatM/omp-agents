import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import type { BotSpec } from "../shared/bots";
import { addBuiltInRoutines, BUILT_IN_ROUTINES, type BuiltInSaves } from "./built-in-routines";
import { RoutinesFile } from "./routines-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("the weekly harness review joins the routines list once, disabled, with its Bot, and one you delete stays deleted", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-built-in-"));
	dirs.push(dir);
	const routines = new RoutinesFile(join(dir, "routines.json"));
	const bots: BotSpec[] = [];
	const saves: BuiltInSaves = {
		hasBot: id => bots.some(bot => bot.id === id),
		saveBot: bot => bots.push(bot),
		saveRoutine: routine => routines.apply({ op: "save", routine }, 1_000),
	};
	const added = join(dir, "built-in-routines.json");

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

test("the harness review's prompt reads the ship trace, LEARNINGS.md, and failed lands and sessions, and edits nothing", () => {
	const [review] = BUILT_IN_ROUTINES;
	const prompt = review!.routine.task.kind === "prompt" ? review!.routine.task.prompt : "";
	for (const part of ["ship-trace.jsonl", "LEARNINGS.md", "merges.json", "routines.json", "Exactly one harness change", "Five past failures", "Do not edit"]) expect(prompt).toContain(part);
});
