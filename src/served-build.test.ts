import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import { describeServed, provenance, readSourceIdentity, type ServedBuild, type SourceIdentity } from "./served-build";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-served-build-")));
	dirs.push(dir);
	return dir;
};

const commitAll = (dir: string, subject: string): Promise<string> => git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", subject);

const rev = async (dir: string, ref: string): Promise<string> => (await git(dir, "rev-parse", ref)).trim();

/** A checkout of `main` with one commit of `a.txt` and a `.gitignore` that ignores `ignored.txt`. */
async function repo(): Promise<string> {
	const dir = scratch();
	await git(dir, "init", "--quiet", "-b", "main");
	writeFileSync(join(dir, "a.txt"), "a\n");
	writeFileSync(join(dir, ".gitignore"), "ignored.txt\n");
	await git(dir, "add", "-A");
	await commitAll(dir, "first");
	return dir;
}

const treeOf = async (dir: string): Promise<string | undefined> => (await readSourceIdentity(dir))?.tree;

describe("readSourceIdentity", () => {
	test("a clean checkout is its branch, its HEAD, and HEAD's tree", async () => {
		const dir = await repo();
		expect(await readSourceIdentity(join(dir, "."))).toEqual({ checkout: dir, branch: "main", commit: await rev(dir, "HEAD"), tree: await rev(dir, "HEAD^{tree}") });
	});

	test("an edit of a tracked file gives the tree that committing it would", async () => {
		const dir = await repo();
		const clean = await rev(dir, "HEAD^{tree}");
		writeFileSync(join(dir, "a.txt"), "edited\n");
		const tree = await treeOf(dir);
		expect(tree).not.toBe(clean);
		await git(dir, "add", "a.txt");
		await commitAll(dir, "edit");
		expect(tree).toBe(await rev(dir, "HEAD^{tree}"));
	});

	test("an untracked file counts, an ignored one does not", async () => {
		const dir = await repo();
		const clean = await rev(dir, "HEAD^{tree}");
		writeFileSync(join(dir, "ignored.txt"), "ignored\n");
		expect(await treeOf(dir)).toBe(clean);
		writeFileSync(join(dir, "b.txt"), "b\n");
		const tree = await treeOf(dir);
		await git(dir, "add", "b.txt");
		await commitAll(dir, "b");
		expect(tree).toBe(await rev(dir, "HEAD^{tree}"));
		expect(tree).not.toBe(clean);
	});

	test("leaves what is staged, unstaged, and untracked as it was", async () => {
		const dir = await repo();
		writeFileSync(join(dir, "a.txt"), "staged\n");
		await git(dir, "add", "a.txt");
		writeFileSync(join(dir, "a.txt"), "staged, then edited\n");
		writeFileSync(join(dir, "b.txt"), "b\n");
		const status = "MM a.txt\n?? b.txt\n";
		expect(await git(dir, "status", "--porcelain")).toBe(status);
		const staged = await git(dir, "diff", "--cached");
		await readSourceIdentity(dir);
		expect(await git(dir, "status", "--porcelain")).toBe(status);
		expect(await git(dir, "diff", "--cached")).toBe(staged);
		expect(staged).toContain("+staged\n");
		expect(existsSync(join(dir, ".git", "index.lock"))).toBe(false);
	});

	test("a detached HEAD has no branch, and a branch before its first commit has no commit", async () => {
		const dir = await repo();
		await git(dir, "switch", "--quiet", "--detach");
		expect(await readSourceIdentity(dir)).toEqual({ checkout: dir, branch: null, commit: await rev(dir, "HEAD"), tree: await rev(dir, "HEAD^{tree}") });

		const unborn = scratch();
		await git(unborn, "init", "--quiet", "-b", "main");
		writeFileSync(join(unborn, "a.txt"), "a\n");
		const identity = await readSourceIdentity(unborn);
		await git(unborn, "add", "a.txt");
		await commitAll(unborn, "first");
		expect(identity).toEqual({ checkout: unborn, branch: "main", commit: null, tree: await rev(unborn, "HEAD^{tree}") });
	});

	test("a directory outside git has none", async () => {
		expect(await readSourceIdentity(scratch())).toBeNull();
	});
});

const local: SourceIdentity = { checkout: "/code/omp-agents", branch: "main", commit: "0123456789abcdef", tree: "aaaaaaaaaaaa" };
const served = (source: SourceIdentity | null): ServedBuild => ({ source, page: "p1", pid: 42, startedAt: "2026-10-26T12:00:00.000Z" });

describe("provenance", () => {
	test("the same checkout with the same tree matches, whatever the commit", () => {
		expect(provenance(served({ ...local, commit: "fedcba9876543210" }), local)).toEqual({ kind: "match" });
	});

	test("a server that names no checkout is unknown", () => {
		expect(provenance(served(null), local)).toEqual({ kind: "unknown" });
	});

	test("another checkout names both", () => {
		expect(provenance(served({ ...local, checkout: "/code/omp-agents-wt/other" }), local)).toEqual({ kind: "other-checkout", served: "/code/omp-agents-wt/other", local: "/code/omp-agents" });
	});

	test("the same checkout with another tree is stale, naming both trees", () => {
		expect(provenance(served({ ...local, tree: "bbbbbbbbbbbb" }), local)).toEqual({ kind: "stale", served: "bbbbbbbbbbbb", local: "aaaaaaaaaaaa" });
	});
});

test("describeServed names the checkout, branch, short commit, short tree, and page, or the page alone outside git", () => {
	expect(describeServed(served(local))).toBe("/code/omp-agents main@0123456, tree aaaaaaa, page p1");
	expect(describeServed(served({ ...local, branch: null, commit: null }))).toBe("/code/omp-agents detached@no commit, tree aaaaaaa, page p1");
	expect(describeServed(served(null))).toBe("page p1 from no git checkout");
});
