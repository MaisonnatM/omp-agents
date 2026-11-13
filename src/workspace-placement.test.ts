import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeAt } from "./git";
import { runChecked } from "./proc";
import { WorkspacePlacement } from "./workspace-placement";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-placement-")));
	dirs.push(dir);
	return dir;
};

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", "-C", cwd, ...args], { env: IDENTITY });

/** A repository at `<parent>/app` on `main`, with `wip` checked out in worktree `app-wip`. Returns the main checkout. */
async function repoWithWorktree(parent: string): Promise<string> {
	const main = join(parent, "app");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	await git(main, "worktree", "add", "-q", "-b", "wip", join(parent, "app-wip"));
	return main;
}

describe("WorkspacePlacement", () => {
	test("counts a linked worktree, or a gone directory named after a main checkout seen since, in that checkout", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const [wip, gone, stray] = ["app-wip", "app-gone", "other-gone"].map(name => join(parent, name));
		const placement = new WorkspacePlacement();

		expect(await placement.place([gone, stray], worktreeAt)).toBe(false);
		expect([gone, stray].map(cwd => placement.at(cwd))).toEqual([null, null]);
		expect(await placement.place([gone, stray, wip, main], worktreeAt)).toBe(true);
		const app = { cwd: main, cwdDisplay: main };
		expect([wip, main, gone, stray].map(cwd => placement.at(cwd))).toEqual([app, null, app, null]);
		expect([wip, main, gone, stray].map(placement.cwdOf)).toEqual([main, main, main, stray]);
	});

	test("counts a subfolder, and a test repository nested in a worktree, in the outermost main checkout", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const sub = join(main, "web");
		const nested = join(parent, "app-wip", "tmp", "smoke");
		mkdirSync(sub);
		mkdirSync(nested, { recursive: true });
		await git(nested, "init", "-q", "-b", "main");
		const placement = new WorkspacePlacement();

		await placement.place([sub, nested], worktreeAt);
		expect([sub, nested].map(placement.cwdOf)).toEqual([main, main]);
	});

	test("marks a gone directory no main checkout claims as gone", async () => {
		const parent = tempDir();
		const gone = join(parent, "other-gone");
		const placement = new WorkspacePlacement();

		await placement.place([gone, parent], worktreeAt);
		expect([gone, parent].map(placement.gone)).toEqual([true, false]);
	});

	test("asks git about each directory once and keeps its workspace", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const wip = join(parent, "app-wip");
		const asked: string[] = [];
		const counted = (dir: string) => {
			asked.push(dir);
			return worktreeAt(dir);
		};
		const placement = new WorkspacePlacement();

		expect(placement.at(wip)).toBeNull();
		expect(await placement.place([wip, main, wip], counted)).toBe(true);
		const app = placement.at(wip);
		expect(app).toEqual({ cwd: main, cwdDisplay: main });
		expect(await placement.place([wip, main], counted)).toBe(false);
		expect(placement.at(wip)).toBe(app);
		expect(asked.toSorted()).toEqual([parent, main, wip]);
	});

	test("counts a gone Codex worktree `<root>/<id>/<name>` in the one main checkout of that name, and in none when two share it", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const codex = join(parent, "codex", "abcd", "app");
		const placement = new WorkspacePlacement();

		expect(await placement.place([codex, main], worktreeAt)).toBe(true);
		expect(placement.at(codex)).toEqual({ cwd: main, cwdDisplay: main });

		const other = join(parent, "other", "app");
		mkdirSync(other, { recursive: true });
		await git(other, "init", "-q", "-b", "main");
		await git(other, "commit", "-q", "--allow-empty", "-m", "one");
		const shared = join(parent, "codex", "efgh", "app");
		expect(await placement.place([other, shared], worktreeAt)).toBe(false);
		expect(placement.at(shared)).toBeNull();
	});

	test("counts a directory a removed worktree left behind in its main checkout, but not a folder that only shares its name", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const [leftover, namesake] = [join(parent, "app-wt", "done"), join(parent, "elsewhere", "app")];
		for (const dir of [leftover, namesake]) mkdirSync(dir, { recursive: true });
		const placement = new WorkspacePlacement();

		expect(await placement.place([leftover, namesake, main], worktreeAt)).toBe(true);
		expect([leftover, namesake].map(placement.cwdOf)).toEqual([main, namesake]);
	});

	test("a worktree git had not placed yet counts in its main checkout once asked", async () => {
		const parent = tempDir();
		const main = await repoWithWorktree(parent);
		const wip = join(parent, "app-wip");
		const placement = new WorkspacePlacement();

		expect(placement.cwdOf(wip)).toBe(wip);
		expect(await placement.workspaceOf(wip, worktreeAt)).toBe(main);
	});
});
