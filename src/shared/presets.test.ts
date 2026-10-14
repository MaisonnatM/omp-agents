import { describe, expect, test } from "bun:test";
import { applyPresets, parsePreset, presetBranch, type SessionPreset, starterPresets } from "./presets";

const minimal: SessionPreset = { id: "minimal", name: "Minimal", model: null, thinking: null, tools: ["bash", "edit"], skill: null, worktree: "here" };

describe("starterPresets", () => {
	test("Minimal starts on the smol role's model and level with only bash and edit, and on omp's default without a smol role", () => {
		const smol = { role: "smol", model: { provider: "anthropic", id: "claude-haiku-5-5" }, thinking: "low" };
		expect(starterPresets([smol])[0]).toMatchObject({ name: "Minimal", model: smol.model, thinking: "low", tools: ["bash", "edit"] });
		expect(starterPresets([])[0]).toMatchObject({ model: null, thinking: null });
		expect(starterPresets([]).map(preset => [preset.name, preset.tools?.includes("bash") ?? true, preset.worktree])).toEqual([
			["Minimal", true, "here"],
			["Review", false, "here"],
			["Ship", true, "new-branch"],
		]);
	});
});

describe("applyPresets", () => {
	test("a save replaces the preset of its id in place or adds one at the end, and a change that changes nothing returns the same list", () => {
		const list = [minimal];
		expect(applyPresets(list, { op: "save", preset: { ...minimal } })).toBe(list);
		expect(applyPresets(list, { op: "remove", id: "gone" })).toBe(list);
		expect(applyPresets(list, { op: "save", preset: { ...minimal, tools: ["bash"] } })).toEqual([{ ...minimal, tools: ["bash"] }]);
		const review = { ...minimal, id: "review", name: "Review" };
		expect(applyPresets(list, { op: "save", preset: review }).map(preset => preset.id)).toEqual(["minimal", "review"]);
		expect(applyPresets(list, { op: "remove", id: "minimal" })).toEqual([]);
	});
});

describe("parsePreset", () => {
	test("keeps a whole preset with its name trimmed, and refuses an empty or repeated tool list, an unknown branch policy, and a blank name", () => {
		expect(parsePreset({ ...minimal, name: " Minimal ", extra: 1 })).toEqual({ ok: minimal });
		expect(parsePreset({ ...minimal, tools: null })?.ok.tools).toBeNull();
		expect(parsePreset({ ...minimal, tools: [] })).toBeNull();
		expect(parsePreset({ ...minimal, tools: ["bash", "bash"] })).toBeNull();
		expect(parsePreset({ ...minimal, tools: ["rm -rf"] })).toBeNull();
		expect(parsePreset({ ...minimal, worktree: "elsewhere" })).toBeNull();
		expect(parsePreset({ ...minimal, name: " " })).toBeNull();
		expect(parsePreset({ ...minimal, model: "anthropic/claude" })).toBeNull();
	});
});

describe("presetBranch", () => {
	const at = new Date(2026, 9, 5, 9, 4, 7);

	test("a new-branch preset names a branch after itself and the time, from the checked-out branch", () => {
		expect(presetBranch({ name: "Ship it!", worktree: "new-branch" }, "main", at)).toEqual({ kind: "new", name: "ship-it-20261005-090407", base: "main" });
		expect(presetBranch({ name: "🚀", worktree: "new-branch" }, "main", at)?.name).toBe("preset-20261005-090407");
	});

	test("a preset that works in place, or a checkout with nothing checked out, keeps the directory as it is", () => {
		expect(presetBranch({ name: "Minimal", worktree: "here" }, "main", at)).toBeNull();
		expect(presetBranch({ name: "Ship", worktree: "new-branch" }, null, at)).toBeNull();
	});
});
