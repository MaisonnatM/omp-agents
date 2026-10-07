import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutDir, gitCheckout, worktreeAt } from "./git";
import { runChecked } from "./proc";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });
const LATER = { ...IDENTITY, GIT_COMMITTER_DATE: "2030-01-01T00:00:00" };

/** A repository on `main` with branches `old` and `wip`, `wip` checked out in its own worktree, all in a fresh directory. */
async function repo(): Promise<{ parent: string; main: string }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-git-")));
	dirs.push(parent);
	const main = join(parent, "app");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	await git(main, "branch", "old");
	await runChecked(["git", "commit", "-q", "--allow-empty", "-m", "two"], { cwd: main, env: LATER });
	await git(main, "worktree", "add", "-q", "-b", "wip", join(parent, "app-wip"));
	return { parent, main };
}

describe("worktreeAt", () => {
	test("tells a linked worktree from the main checkout, with the branch each has checked out, none while HEAD is detached", async () => {
		const { parent, main } = await repo();
		mkdirSync(join(main, "src"));
		const common = join(main, ".git");
		expect(await worktreeAt(join(main, "src"))).toEqual({ top: main, common, linked: false, branch: "main" });
		expect(await worktreeAt(join(parent, "app-wip"))).toEqual({ top: join(parent, "app-wip"), common, linked: true, branch: "wip" });
		await git(main, "update-ref", "refs/tags/wip", "HEAD");
		expect((await worktreeAt(join(parent, "app-wip")))?.branch).toBe("wip");
		await git(main, "switch", "-q", "--detach", "old");
		expect((await worktreeAt(main))?.branch).toBeNull();
	});
});

describe("gitCheckout", () => {
	test("lists the checked-out branch first and where each branch is checked out", async () => {
		const { parent, main } = await repo();
		mkdirSync(join(main, "src"));
		expect(await gitCheckout(join(main, "src"))).toEqual({
			branch: "main",
			branches: [
				{ name: "main", worktree: main },
				{ name: "wip", worktree: join(parent, "app-wip") },
				{ name: "old", worktree: null },
			],
			mainWorktree: main,
		});
	});

	test("is null outside a checkout", async () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-git-")));
		dirs.push(dir);
		expect(await gitCheckout(dir)).toBeNull();
	});
});

describe("checkoutDir", () => {
	test("keeps the directory for the branch it has checked out, and uses the worktree that has another", async () => {
		const { parent, main } = await repo();
		mkdirSync(join(main, "src"));
		expect(await checkoutDir(join(main, "src"), { kind: "existing", name: "main" })).toBe(join(main, "src"));
		expect(await checkoutDir(main, { kind: "existing", name: "wip" })).toBe(join(parent, "app-wip"));
	});

	test("adds a worktree beside the main one for a branch none has checked out", async () => {
		const { parent } = await repo();
		const dir = await checkoutDir(join(parent, "app-wip"), { kind: "existing", name: "old" });
		expect(dir).toBe(join(parent, "app-old"));
		expect((await git(dir, "branch", "--show-current")).trim()).toBe("old");
	});

	test("creates a new branch from its base in its own worktree, named after the branch", async () => {
		const { parent, main } = await repo();
		const dir = await checkoutDir(main, { kind: "new", name: "fix/login", base: "old" });
		expect(dir).toBe(join(parent, "app-fix-login"));
		expect((await git(dir, "branch", "--show-current")).trim()).toBe("fix/login");
		expect(await git(dir, "rev-parse", "HEAD")).toBe(await git(main, "rev-parse", "old"));
	});

	test("refuses an unknown branch, a taken name, and a name git rejects, adding no worktree", async () => {
		const { main } = await repo();
		await expect(checkoutDir(main, { kind: "existing", name: "nope" })).rejects.toThrow("No local branch is named nope.");
		await expect(checkoutDir(main, { kind: "new", name: "x", base: "nope" })).rejects.toThrow("No local branch is named nope.");
		await expect(checkoutDir(main, { kind: "new", name: "old", base: "main" })).rejects.toThrow("A branch named old already exists.");
		await expect(checkoutDir(main, { kind: "new", name: "bad..name", base: "main" })).rejects.toThrow();
		expect((await gitCheckout(main))?.branches.map(branch => branch.name)).toEqual(["main", "wip", "old"]);
	});

	test("from a worktree nested in the main one, the main branch runs in the main worktree", async () => {
		const { main } = await repo();
		const nested = join(main, ".worktrees", "feat");
		await git(main, "worktree", "add", "-q", "-b", "feat", nested);
		expect(await checkoutDir(nested, { kind: "existing", name: "main" })).toBe(main);
		expect(await checkoutDir(nested, { kind: "existing", name: "feat" })).toBe(nested);
	});

	test("refuses a worktree path that is taken, leaving no branch behind", async () => {
		const { parent, main } = await repo();
		mkdirSync(join(parent, "app-fix-login"));
		await expect(checkoutDir(main, { kind: "new", name: "fix/login", base: "main" })).rejects.toThrow(`${join(parent, "app-fix-login")} already exists.`);
		expect((await gitCheckout(main))?.branches.map(branch => branch.name)).toEqual(["main", "wip", "old"]);
	});
});
