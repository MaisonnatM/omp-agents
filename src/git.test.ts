import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutDir, gitCheckout, gitStatus, switchBranch } from "./git";
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

describe("gitStatus", () => {
	test("counts commits against the upstream and lists staged, unstaged, renamed, and untracked files once each", async () => {
		const { parent, main } = await repo();
		await git(parent, "init", "-q", "--bare", "remote.git");
		await git(main, "remote", "add", "origin", join(parent, "remote.git"));
		writeFileSync(join(main, "a.txt"), "a\n");
		writeFileSync(join(main, "old name.txt"), "r\n");
		await git(main, "add", ".");
		await git(main, "commit", "-q", "-m", "files");
		await git(main, "push", "-q", "-u", "origin", "main");
		await git(main, "commit", "-q", "--allow-empty", "-m", "local");
		writeFileSync(join(main, "a.txt"), "changed\n");
		await git(main, "mv", "old name.txt", "new name.txt");
		writeFileSync(join(main, "staged.txt"), "s\n");
		await git(main, "add", "staged.txt");
		mkdirSync(join(main, "src"));
		writeFileSync(join(main, "src", "loose.txt"), "u\n");
		expect(await gitStatus(join(main, "src"))).toEqual({
			root: main,
			branch: "main",
			upstream: { name: "origin/main", ahead: 1, behind: 0 },
			files: [
				{ path: "a.txt", kind: "modified" },
				{ path: "new name.txt", kind: "renamed" },
				{ path: "staged.txt", kind: "added" },
				{ path: "src/loose.txt", kind: "untracked" },
			],
		});
	});

	test("has no upstream for a branch without one, and no branch while HEAD is detached", async () => {
		const { main } = await repo();
		expect(await gitStatus(main)).toEqual({ root: main, branch: "main", upstream: null, files: [] });
		await git(main, "switch", "-q", "--detach", "old");
		expect((await gitStatus(main))?.branch).toBeNull();
	});
});

describe("switchBranch", () => {
	test("switches the checkout to an existing branch, carrying its uncommitted files", async () => {
		const { main } = await repo();
		writeFileSync(join(main, "loose.txt"), "u\n");
		await switchBranch(main, { kind: "existing", name: "old" });
		expect(await gitStatus(main)).toMatchObject({ branch: "old", files: [{ path: "loose.txt", kind: "untracked" }] });
	});

	test("creates a new branch from its base in the same checkout", async () => {
		const { main } = await repo();
		await switchBranch(main, { kind: "new", name: "fix/login", base: "old" });
		expect((await git(main, "branch", "--show-current")).trim()).toBe("fix/login");
		expect(await git(main, "rev-parse", "HEAD")).toBe(await git(main, "rev-parse", "old"));
	});

	test("refuses a branch another worktree has checked out, an unknown branch, and a taken name, staying put", async () => {
		const { main } = await repo();
		await expect(switchBranch(main, { kind: "existing", name: "wip" })).rejects.toThrow("wip");
		await expect(switchBranch(main, { kind: "existing", name: "nope" })).rejects.toThrow("No local branch is named nope.");
		await expect(switchBranch(main, { kind: "new", name: "old", base: "main" })).rejects.toThrow("A branch named old already exists.");
		expect((await git(main, "branch", "--show-current")).trim()).toBe("main");
	});
});
