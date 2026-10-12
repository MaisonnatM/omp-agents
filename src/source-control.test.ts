import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import { applyAutoPull, DEFAULT_AUTO_PULL, startingMethod } from "./shared/source-control";
import { pullDefaultBranch } from "./source-control";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function commit(dir: string, file: string): Promise<void> {
	writeFileSync(join(dir, file), file);
	await git(dir, "add", file);
	await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", file);
}

async function cloneBehind(): Promise<{ origin: string; clone: string }> {
	const root = mkdtempSync(join(tmpdir(), "omp-pull-"));
	dirs.push(root);
	const origin = join(root, "origin");
	const clone = join(root, "clone");
	await git(root, "init", "--quiet", "--initial-branch=main", origin);
	await commit(origin, "a");
	await git(root, "clone", "--quiet", origin, clone);
	await commit(origin, "b");
	return { origin, clone };
}

const head = async (dir: string, ref = "HEAD"): Promise<string> => (await git(dir, "rev-parse", ref)).trim();

describe("pullDefaultBranch", () => {
	test("fast-forwards a clean checkout of the default branch", async () => {
		const { origin, clone } = await cloneBehind();
		expect(await pullDefaultBranch(clone)).toEqual({ kind: "pulled", commits: 1 });
		expect(await head(clone)).toBe(await head(origin));
		expect(await pullDefaultBranch(clone)).toEqual({ kind: "current" });
	});

	test("leaves a checkout with uncommitted changes alone", async () => {
		const { origin, clone } = await cloneBehind();
		writeFileSync(join(clone, "a"), "edited");
		expect(await pullDefaultBranch(clone)).toMatchObject({ kind: "skipped", reason: "changes" });
		expect(await head(clone)).not.toBe(await head(origin));
	});

	test("leaves a default branch with local commits alone", async () => {
		const { clone } = await cloneBehind();
		await commit(clone, "c");
		const before = await head(clone);
		expect(await pullDefaultBranch(clone)).toMatchObject({ kind: "skipped", reason: "commits" });
		expect(await head(clone)).toBe(before);
	});

	test("moves the default branch when no worktree has it checked out", async () => {
		const { origin, clone } = await cloneBehind();
		await git(clone, "switch", "--quiet", "-c", "feature");
		writeFileSync(join(clone, "a"), "edited");
		expect(await pullDefaultBranch(clone)).toEqual({ kind: "pulled", commits: 1 });
		expect(await head(clone, "refs/heads/main")).toBe(await head(origin));
	});
});

describe("applyAutoPull", () => {
	test("a repository's own choice wins until it is dropped", () => {
		const own = applyAutoPull(DEFAULT_AUTO_PULL, { op: "repo", repo: "/r", on: true });
		expect(own).toEqual({ on: false, repos: { "/r": true } });
		expect(applyAutoPull(own, { op: "repo", repo: "/r", on: null })).toEqual(DEFAULT_AUTO_PULL);
		expect(applyAutoPull(own, { op: "repo", repo: "/r", on: true })).toBe(own);
	});
});

describe("startingMethod", () => {
	test("takes the choice, then the last pick, then what the repository allows first", () => {
		expect(startingMethod("rebase", "merge", ["merge", "squash", "rebase"])).toBe("rebase");
		expect(startingMethod("last", "squash", ["merge", "squash"])).toBe("squash");
		expect(startingMethod("last", null, ["squash", "rebase"])).toBe("squash");
		expect(startingMethod("rebase", null, ["merge"])).toBe("merge");
		expect(startingMethod("merge", null, [])).toBeNull();
	});
});
