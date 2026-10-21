import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecked } from "./proc";
import { readRunProfile, RunLocally, RunRefused, saveRunProfile } from "./run-locally";
import type { RunProfile } from "./shared/run-locally";
import { Terminals } from "./terminals";
import { Worktrees } from "./worktrees";

const dirs: string[] = [];
const terminals = new Terminals();
afterEach(() => {
	terminals.dispose();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const saved = process.env.SHELL;
beforeAll(() => {
	process.env.SHELL = "/bin/sh";
});
afterAll(() => {
	if (saved === undefined) delete process.env.SHELL;
	else process.env.SHELL = saved;
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });

/** A main checkout on `main` with installed modules, and a linked worktree on `feat`, whose commit changes `lockfile` when given. */
async function repo(lockfile?: string): Promise<{ main: string; linked: string }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-run-locally-")));
	dirs.push(parent);
	const main = join(parent, "app");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	writeFileSync(join(main, "package.json"), "{}\n");
	writeFileSync(join(main, ".gitignore"), "node_modules\n");
	await git(main, "add", ".");
	await git(main, "commit", "-q", "-m", "one");
	mkdirSync(join(main, "node_modules"));
	const linked = join(parent, "feat");
	await git(main, "worktree", "add", "-q", "-b", "feat", linked);
	writeFileSync(join(linked, lockfile ?? "notes.txt"), "changed\n");
	await git(linked, "add", ".");
	await git(linked, "commit", "-q", "-m", "two");
	return { main, linked };
}

const worktrees = new Worktrees({ knownCwds: () => [], activity: () => [], live: () => [], serverCwd: "/no/such/dashboard", mergedPullRequests: async () => new Map() });
const runner = (): RunLocally => new RunLocally(worktrees, terminals);
const PROFILE: RunProfile = { install: "echo installed > installed.txt", services: ["sleep 30"] };
const branchOf = async (dir: string): Promise<string> => (await git(dir, "branch", "--show-current")).trim();

describe("RunLocally", () => {
	test("frees the branch from its linked worktree, checks it out in the main checkout, and installs because a lockfile changed", async () => {
		const { main, linked } = await repo("package-lock.json");
		const outcome = await runner().run(linked, "feat", PROFILE);
		expect(outcome).toMatchObject({ dir: main, release: { kind: "removed", path: linked }, installed: true, stopped: 0 });
		expect(outcome.terminals.map(terminal => [terminal.cwd, terminal.title])).toEqual([[main, "sleep 30"]]);
		expect(existsSync(linked)).toBe(false);
		expect(await branchOf(main)).toBe("feat");
		expect(readFileSync(join(main, "installed.txt"), "utf8")).toBe("installed\n");
		expect(await readRunProfile(main)).toEqual(PROFILE);
	});

	test("skips the install when no lockfile changed and modules are installed", async () => {
		const { main, linked } = await repo();
		expect(await runner().run(linked, "feat", PROFILE)).toMatchObject({ dir: main, installed: false });
		expect(existsSync(join(main, "installed.txt"))).toBe(false);
	});

	test("runs in the linked worktree when its checks keep it", async () => {
		const { main, linked } = await repo();
		writeFileSync(join(linked, "untracked.txt"), "keep\n");
		const outcome = await runner().run(main, "feat", PROFILE);
		expect(outcome).toMatchObject({ dir: linked, release: { kind: "kept", path: linked }, installed: true });
		expect(await branchOf(main)).toBe("main");
	});

	test("refuses a main checkout with uncommitted changes and leaves it on its branch", async () => {
		const { main, linked } = await repo();
		writeFileSync(join(main, "package.json"), '{ "edited": true }\n');
		rmSync(linked, { recursive: true, force: true });
		await git(main, "worktree", "prune");
		await expect(runner().run(main, "feat", PROFILE)).rejects.toBeInstanceOf(RunRefused);
		expect(await branchOf(main)).toBe("main");
	});

	test("stops the repository's previous run before it starts the next", async () => {
		const { main, linked } = await repo();
		const run = runner();
		const first = await run.run(linked, "feat", PROFILE);
		const second = await run.run(main, "feat", { install: "", services: ["sleep 31", "sleep 32"] });
		expect(second.stopped).toBe(1);
		const ids = terminals.list().map(terminal => terminal.id);
		expect(ids).not.toContain(first.terminals[0]!.id);
		expect(second.terminals.map(terminal => terminal.title)).toEqual(["sleep 31", "sleep 32"]);
	});

	test("saving a profile replaces the services the repository kept", async () => {
		const { main } = await repo();
		await saveRunProfile(main, { install: "npm i", services: ["a", "b"] });
		await saveRunProfile(main, { install: "", services: ["c"] });
		expect(await readRunProfile(main)).toEqual({ install: "", services: ["c"] });
	});
});
