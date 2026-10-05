import { describe, expect, test } from "bun:test";
import { overlayFiles, planSettings, settingsOf } from "./install";

const known = new Set(["modelRoles", "retry.fallbackChains", "task.isolation.merge"]);

describe("settingsOf", () => {
	test("walks mappings down to omp's setting keys, keeping record settings whole", () => {
		const template = { modelRoles: { default: "a/b" }, retry: { fallbackChains: { "a/b.1": ["c/d"] } }, task: { isolation: { merge: "patch" } } };
		expect(settingsOf(template, known)).toEqual([
			["modelRoles", { default: "a/b" }],
			["retry.fallbackChains", { "a/b.1": ["c/d"] }],
			["task.isolation.merge", "patch"],
		]);
	});

	test("refuses a key omp does not know", () => {
		expect(() => settingsOf({ task: { isolation: { merj: "patch" } } }, known)).toThrow("omp has no setting task.isolation.merj");
	});
});

describe("overlayFiles", () => {
	test("a later layer replaces AGENTS.md and adds the git workflow", () => {
		const files = overlayFiles([
			[
				{ rel: "AGENTS.md", text: "public" },
				{ rel: "docs/model-routing.md", text: "models" },
			],
			[
				{ rel: "AGENTS.md", text: "maintainer" },
				{ rel: "docs/git-workflow.md", text: "graphite" },
			],
		]);
		expect(files).toEqual([
			{ rel: "AGENTS.md", text: "maintainer" },
			{ rel: "docs/git-workflow.md", text: "graphite" },
			{ rel: "docs/model-routing.md", text: "models" },
		]);
	});

	test("one layer keeps only the files it was given", () => {
		expect(overlayFiles([[{ rel: "AGENTS.md", text: "public" }]])).toEqual([{ rel: "AGENTS.md", text: "public" }]);
	});
});

describe("planSettings", () => {
	const settings: [string, unknown][] = [
		["modelRoles", { default: "a/b" }],
		["task.isolation.merge", "patch"],
	];

	test("adds what you have not set, leaves what already matches, and keeps what you chose", () => {
		const user = { modelRoles: { default: "x/y" }, task: { isolation: { merge: "patch" } } };
		expect(planSettings(settings, user, false).map(s => s.action)).toEqual(["keep", "same"]);
		expect(planSettings(settings, {}, false).map(s => s.action)).toEqual(["create", "create"]);
	});

	test("--force overwrites what you chose", () => {
		expect(planSettings(settings, { modelRoles: { default: "x/y" } }, true).map(s => s.action)).toEqual(["update", "create"]);
	});
});
