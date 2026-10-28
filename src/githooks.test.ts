import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, runChecked } from "./proc";

const HOOKS = join(import.meta.dir, "..", ".githooks");
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]): Promise<string> => (await runChecked(["git", ...args], { cwd })).trim();

/** A repository on `main` that runs this repository's hooks, with a `feature` branch; unless `fastForward`, a commit on `main` since makes merging `feature` a merge commit. */
async function setup(featureFiles: Record<string, string>, fastForward = false) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-githooks-")));
	dirs.push(dir);
	const commit = async (files: Record<string, string>, subject: string) => {
		for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
		await git(dir, "add", ...Object.keys(files));
		await git(dir, "commit", "-q", "-m", subject);
	};
	await git(dir, "init", "-q", "-b", "main");
	await git(dir, "config", "core.hooksPath", HOOKS);
	await commit({ "CHANGELOG.md": "# Changelog\n\n## 2026-10-27\n\n- An older change\n" }, "one");
	await git(dir, "switch", "-q", "-c", "feature");
	await commit(featureFiles, "the change");
	await git(dir, "switch", "-q", "main");
	if (!fastForward) await commit({ "main.txt": "main\n" }, "two");
	return { dir, head: () => git(dir, "rev-parse", "HEAD") };
}

describe("pre-merge-commit", () => {
	test("refuses merging a branch into main that leaves CHANGELOG.md unchanged, before main moves", async () => {
		const { dir, head } = await setup({ "feature.txt": "feature\n" });
		const before = await head();
		const merge = await run(["git", "merge", "--no-edit", "feature"], { cwd: dir });
		expect(merge.code).toBe(1);
		expect(merge.stderr).toContain("Merging into main needs new lines in CHANGELOG.md");
		expect(await head()).toBe(before);
	});

	test("merges a branch into main that adds CHANGELOG.md lines", async () => {
		const { dir } = await setup({ "CHANGELOG.md": "# Changelog\n\n## 2026-10-28\n\n- A new change\n\n## 2026-10-27\n\n- An older change\n" });
		await git(dir, "merge", "-q", "--no-edit", "feature");
		expect(await git(dir, "rev-parse", "HEAD^2")).toBe(await git(dir, "rev-parse", "feature"));
	});

	test("lets main merge into a branch without CHANGELOG.md lines", async () => {
		const { dir } = await setup({ "feature.txt": "feature\n" });
		await git(dir, "switch", "-q", "feature");
		await git(dir, "merge", "-q", "--no-edit", "main");
		expect(await git(dir, "rev-parse", "HEAD^2")).toBe(await git(dir, "rev-parse", "main"));
	});
});

describe("post-merge", () => {
	const WARNING = "this fast-forward into main leaves CHANGELOG.md unchanged";

	test("warns after a fast-forward into main that leaves CHANGELOG.md unchanged", async () => {
		const { dir } = await setup({ "feature.txt": "feature\n" }, true);
		const merge = await run(["git", "merge", "--ff-only", "feature"], { cwd: dir });
		expect(merge.code).toBe(0);
		expect(merge.stderr).toContain(WARNING);
	});

	test("stays quiet after a fast-forward into main that adds CHANGELOG.md lines", async () => {
		const { dir } = await setup({ "CHANGELOG.md": "# Changelog\n\n## 2026-10-28\n\n- A new change\n" }, true);
		const merge = await run(["git", "merge", "--ff-only", "feature"], { cwd: dir });
		expect(merge.stderr).not.toContain(WARNING);
	});

	test("stays quiet after a fast-forward of a branch other than main", async () => {
		const { dir } = await setup({ "feature.txt": "feature\n" }, true);
		await git(dir, "switch", "-q", "-c", "other", "main");
		const merge = await run(["git", "merge", "--ff-only", "feature"], { cwd: dir });
		expect(merge.stderr).not.toContain(WARNING);
	});
});
