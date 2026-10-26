import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFiles, overlayFiles, planFiles, planSettings, settingsOf } from "./install";

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

describe("installed files", () => {
	const dirs: string[] = [];
	const directory = () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-template-"));
		dirs.push(dir);
		return dir;
	};
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});
	const kit = (text: string) => [{ rel: "file.txt", text }];
	const content = (dir: string) => readFileSync(join(dir, "file.txt"), "utf8");

	test("updates an unedited installed file across successive template versions", async () => {
		const dir = directory();
		await installFiles(planFiles(kit("first"), dir, false));
		await installFiles(planFiles(kit("second"), dir, false));
		expect(content(dir)).toBe("second");
		await installFiles(planFiles(kit("third"), dir, false));
		expect(content(dir)).toBe("third");
	});

	test("keeps local edits across reruns, but updates again after restoring the installed version", async () => {
		const dir = directory();
		await installFiles(planFiles(kit("installed"), dir, false));
		writeFileSync(join(dir, "file.txt"), "my edits");
		await installFiles(planFiles(kit("next"), dir, false));
		await installFiles(planFiles(kit("later"), dir, false));
		expect(content(dir)).toBe("my edits");
		writeFileSync(join(dir, "file.txt"), "installed");
		await installFiles(planFiles(kit("later"), dir, false));
		expect(content(dir)).toBe("later");
	});

	test("preserves an unknown existing file, even when its contents were installed at another path", async () => {
		const dir = directory();
		await installFiles(planFiles([{ rel: "other.txt", text: "old" }], dir, false));
		writeFileSync(join(dir, "file.txt"), "old");
		await installFiles(planFiles(kit("new"), dir, false));
		expect(content(dir)).toBe("old");
	});

	test("adopts an existing exact match, including after a dry-run plan", async () => {
		const dir = directory();
		writeFileSync(join(dir, "file.txt"), "old");
		const plan = planFiles(kit("old"), dir, false);
		expect(existsSync(plan.statePath)).toBe(false);
		await installFiles(plan);
		await installFiles(planFiles(kit("new"), dir, false));
		expect(content(dir)).toBe("new");
	});

	test("--force replaces local edits and records the replacement for future updates", async () => {
		const dir = directory();
		writeFileSync(join(dir, "file.txt"), "my edits");
		await installFiles(planFiles(kit("forced"), dir, true));
		expect(content(dir)).toBe("forced");
		await installFiles(planFiles(kit("next"), dir, false));
		expect(content(dir)).toBe("next");
	});

	test("planning an upgrade writes neither the file nor its installed baseline", async () => {
		const dir = directory();
		await installFiles(planFiles(kit("old"), dir, false));
		const baseline = readFileSync(planFiles(kit("old"), dir, false).statePath, "utf8");
		const plan = planFiles(kit("new"), dir, false);
		expect(plan.files[0].action).toBe("update");
		expect(content(dir)).toBe("old");
		expect(readFileSync(plan.statePath, "utf8")).toBe(baseline);
		writeFileSync(join(dir, "file.txt"), "new");
		await installFiles(planFiles(kit("later"), dir, false));
		expect(content(dir)).toBe("new");
	});

	test("a fresh dry-run plan creates neither files nor its destination directory", () => {
		const dir = join(directory(), "agent");
		planFiles(kit("new"), dir, true);
		expect(existsSync(dir)).toBe(false);
	});

	test("does not overwrite edits made after planning", async () => {
		const dir = directory();
		await installFiles(planFiles(kit("old"), dir, false));
		const plan = planFiles(kit("new"), dir, false);
		writeFileSync(join(dir, "file.txt"), "my edits");
		await expect(installFiles(plan)).rejects.toThrow("changed after planning");
		expect(content(dir)).toBe("my edits");
	});

	test("an interrupted install records only the files it finished", async () => {
		const dir = directory();
		const plan = planFiles([{ rel: "file.txt", text: "first" }, { rel: "other.txt", text: "other" }], dir, false);
		writeFileSync(join(dir, "other.txt"), "arrived after planning");
		await expect(installFiles(plan)).rejects.toThrow("changed after planning");
		await installFiles(planFiles([{ rel: "file.txt", text: "second" }, { rel: "other.txt", text: "new" }], dir, false));
		expect(content(dir)).toBe("second");
		expect(readFileSync(join(dir, "other.txt"), "utf8")).toBe("arrived after planning");
	});

	test("refuses corrupt install hashes without changing files", async () => {
		const dir = directory();
		await installFiles(planFiles(kit("old"), dir, false));
		const { statePath } = planFiles(kit("new"), dir, false);
		writeFileSync(statePath, JSON.stringify({ "file.txt": 42 }));
		expect(() => planFiles(kit("new"), dir, false)).toThrow("does not hold installed file hashes");
		expect(content(dir)).toBe("old");
	});
});
