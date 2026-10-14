import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionPreset } from "../shared/presets";
import { PresetsFile } from "./presets-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function presetsPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-presets-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "presets.json");
}

const starter: SessionPreset = { id: "minimal", name: "Minimal", model: null, thinking: null, tools: ["bash", "edit"], skill: null, worktree: "here" };

describe("PresetsFile", () => {
	test("the starters are saved on the first run only, so removing every preset keeps them removed", () => {
		const path = presetsPath();
		const first = new PresetsFile(path);
		expect(first.seed([starter])).toBe(true);
		expect(new PresetsFile(path).value).toEqual([starter]);
		expect(first.apply({ op: "remove", id: "minimal" })).toBe(true);
		const next = new PresetsFile(path);
		expect(next.seed([starter])).toBe(false);
		expect(next.value).toEqual([]);
	});

	test("a preset saved before the starters are read keeps the starters out", () => {
		const file = new PresetsFile(presetsPath());
		file.apply({ op: "save", preset: { ...starter, id: "mine", name: "Mine" } });
		expect(file.seed([starter])).toBe(false);
		expect(file.value.map(preset => preset.id)).toEqual(["mine"]);
	});

	test("another server's saved preset survives a stale server's first seed", () => {
		const path = presetsPath();
		const stale = new PresetsFile(path);
		const writer = new PresetsFile(path);
		const mine = { ...starter, id: "mine", name: "Mine" };
		writer.apply({ op: "save", preset: mine });
		expect(stale.seed([starter])).toBe(false);
		expect(new PresetsFile(path).value).toEqual([mine]);
	});

	test("stale edits preserve the other server's additions and tool changes", () => {
		const path = presetsPath();
		const first = new PresetsFile(path);
		first.seed([starter]);
		const stale = new PresetsFile(path);
		const changed = { ...starter, tools: ["read"] };
		first.apply({ op: "save", preset: changed });
		const mine = { ...starter, id: "mine", name: "Mine" };
		stale.apply({ op: "save", preset: mine });
		expect(new PresetsFile(path).value).toEqual([changed, mine]);
		first.apply({ op: "remove", id: "mine" });
		expect(new PresetsFile(path).value).toEqual([changed]);
	});
});
