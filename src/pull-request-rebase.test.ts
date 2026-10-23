import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as github from "./github";
import * as proc from "./proc";
import { rebasePullRequest } from "./pull-request-rebase";

const realRunChecked = proc.runChecked;
const realRun = proc.run;
const dirs: string[] = [];
afterEach(() => {
	mock.restore();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]): Promise<string> => (await realRunChecked(["git", ...args], { cwd })).trim();

/**
 * `acme/app` checked out in `app` on `main`, its `origin` a bare repository beside it. Pull request 7 merges `feature`,
 * one commit on `one` that adds `feature.txt`, into `main`, which has `two` since; `app` has `feature` as `origin` does,
 * checked out nowhere. Pushes run the hooks in `hooks`, which holds none.
 */
async function setup() {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-pr-rebase-")));
	dirs.push(parent);
	const origin = join(parent, "origin.git");
	const main = join(parent, "app");
	const hooks = join(parent, "hooks");
	mkdirSync(main);
	mkdirSync(hooks);
	await git(parent, "init", "-q", "--bare", "-b", "main", origin);
	await git(main, "init", "-q", "-b", "main");
	for (const [key, value] of [["user.name", "t"], ["user.email", "t@t"], ["commit.gpgSign", "false"], ["core.hooksPath", hooks]]) await git(main, "config", key!, value!);
	const commit = async (dir: string, file: string, text: string, subject: string) => {
		writeFileSync(join(dir, file), text);
		await git(dir, "add", file);
		await git(dir, "commit", "-q", "-m", subject);
	};
	await commit(main, "README.md", "app\n", "one");
	await git(main, "remote", "add", "origin", origin);
	await git(main, "switch", "-q", "-c", "feature");
	await commit(main, "feature.txt", "feature\n", "the change");
	await git(main, "push", "-q", "origin", "main", "feature");
	await git(main, "switch", "-q", "main");
	await commit(main, "main.txt", "main\n", "two");
	await git(main, "push", "-q", "origin", "main");
	const before = await git(main, "rev-parse", "feature");

	/** Each pull request's head and base branch, by number. */
	const prs = new Map<number, [head: string, base: string]>([[7, ["feature", "main"]]]);
	spyOn(github, "repoOf").mockResolvedValue({ owner: "acme", repo: "app" });
	spyOn(proc, "runJson").mockImplementation(async argv => {
		const [head, base] = prs.get(Number(argv.at(-1)!.split("/").at(-1)))!;
		return { title: "Add the change", head: { ref: head, sha: "unused", repo: { full_name: "acme/app" } }, base: { ref: base, repo: { full_name: "acme/app" } } };
	});
	const rebase = (number = 7) => rebasePullRequest({ owner: "acme", repo: "app", number, cwd: main });
	const subjects = (dir: string, ref: string) => git(dir, "log", "--format=%s", ref);
	/** A linked worktree `review` on `feature`. */
	const review = async () => {
		const path = join(parent, "review");
		await git(main, "worktree", "add", "-q", path, "feature");
		return path;
	};
	return { parent, origin, main, hooks, before, prs, rebase, commit, subjects, review };
}

test("answers current when the branch already has its base, and pushes nothing", async () => {
	const { origin, main, rebase } = await setup();
	await git(main, "switch", "-q", "feature");
	await git(main, "merge", "-q", "--no-edit", "main");
	await git(main, "push", "-q", "origin", "feature");
	const merged = await git(main, "rev-parse", "HEAD");
	expect(await rebase()).toEqual({ kind: "current", branch: "feature", onto: "main" });
	expect(await git(origin, "rev-parse", "feature")).toBe(merged);
});

describe("a branch behind its base", () => {
	test("rebases it onto origin's base, pushes it, and moves the local branch, without leaving a worktree", async () => {
		const { origin, main, before, rebase, subjects } = await setup();
		expect(await rebase()).toEqual({ kind: "rebased", branch: "feature", onto: "main" });
		expect(await subjects(origin, "feature")).toBe("the change\ntwo\none");
		const pushed = await git(origin, "rev-parse", "feature");
		expect(pushed).not.toBe(before);
		expect(await git(main, "rev-parse", "feature")).toBe(pushed);
		expect(await git(main, "worktree", "list", "--porcelain")).toBe(`worktree ${main}\nHEAD ${await git(main, "rev-parse", "HEAD")}\nbranch refs/heads/main`);
	});

	test("fast-forwards and rebases the worktree that has the branch checked out", async () => {
		const { origin, rebase, subjects, review } = await setup();
		const path = await review();
		await git(path, "reset", "-q", "--hard", "HEAD~1");
		expect(await rebase()).toEqual({ kind: "rebased", branch: "feature", onto: "main" });
		expect(await subjects(origin, "feature")).toBe("the change\ntwo\none");
		expect(await git(path, "rev-parse", "HEAD")).toBe(await git(origin, "rev-parse", "feature"));
		expect(await git(path, "branch", "--show-current")).toBe("feature");
	});

	test("answers the conflicted files, leaving origin, the branch, and its worktree as they were", async () => {
		const { origin, main, before, rebase, commit, review } = await setup();
		await commit(main, "feature.txt", "theirs\n", "three");
		await git(main, "push", "-q", "origin", "main");
		const path = await review();
		expect(await rebase()).toEqual({ kind: "conflict", files: ["feature.txt"], branch: "feature", onto: "main" });
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
		expect(await git(path, "rev-parse", "HEAD")).toBe(before);
		expect(await git(path, "status", "--porcelain")).toBe("");
		expect(existsSync(await git(path, "rev-parse", "--path-format=absolute", "--git-path", "rebase-merge"))).toBe(false);
	});

	test("answers a conflict in a worktree of its own, which it removes, leaving the local branch where it was", async () => {
		const { origin, main, before, rebase, commit } = await setup();
		await commit(main, "feature.txt", "theirs\n", "three");
		await git(main, "push", "-q", "origin", "main");
		expect(await rebase()).toEqual({ kind: "conflict", files: ["feature.txt"], branch: "feature", onto: "main" });
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
		expect(await git(main, "rev-parse", "feature")).toBe(before);
		expect((await git(main, "worktree", "list")).split("\n")).toHaveLength(1);
	});
});

describe("refusals", () => {
	test("refuses a worktree with uncommitted changes on the branch", async () => {
		const { origin, before, rebase, review } = await setup();
		const path = await review();
		writeFileSync(join(path, "README.md"), "edited\n");
		await expect(rebase()).rejects.toThrow(`${path} has uncommitted changes on \`feature\`. Commit or stash them before rebasing pull request #7.`);
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
		expect(await git(path, "rev-parse", "HEAD")).toBe(before);
	});

	test("refuses a worktree in the middle of a merge, and leaves the merge as it was", async () => {
		const { origin, main, before, rebase, review } = await setup();
		const path = await review();
		const empty = await git(main, "commit-tree", "feature^{tree}", "-p", "feature", "-m", "side");
		await git(path, "merge", "-q", "--no-ff", "--no-commit", empty);
		await expect(rebase()).rejects.toThrow("MERGE_HEAD exists");
		expect(existsSync(await git(path, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"))).toBe(true);
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
	});

	test("refuses a local branch with commits the pull request lacks, and moves nothing", async () => {
		const { origin, main, before, rebase } = await setup();
		await git(main, "switch", "-q", "feature");
		await git(main, "commit", "-q", "--allow-empty", "-m", "mine");
		const mine = await git(main, "rev-parse", "HEAD");
		await git(main, "switch", "-q", "main");
		await expect(rebase()).rejects.toThrow("Local branch `feature` has commits pull request #7 does not. Push or drop them before rebasing it.");
		expect(await git(main, "rev-parse", "feature")).toBe(mine);
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
	});

	test("refuses a pull request whose branch is in a fork", async () => {
		const { rebase } = await setup();
		spyOn(proc, "runJson").mockResolvedValue({ head: { ref: "feature", repo: { full_name: "someone/app" } }, base: { ref: "main", repo: { full_name: "acme/app" } } });
		await expect(rebase()).rejects.toThrow("Pull request #7's branch is in a fork, which this dashboard does not push to.");
	});
});

describe("a refused push", () => {
	test("throws the pre-push hook's output and puts the worktree back where it was", async () => {
		const { origin, hooks, before, rebase, review } = await setup();
		writeFileSync(join(hooks, "pre-push"), '#!/bin/sh\necho "2 tests failed" >&2\nexit 1\n', { mode: 0o755 });
		const path = await review();
		await git(path, "reset", "-q", "--hard", "HEAD~1");
		const behind = await git(path, "rev-parse", "HEAD");
		await expect(rebase()).rejects.toThrow("2 tests failed");
		expect(await git(path, "rev-parse", "HEAD")).toBe(behind);
		expect(await git(path, "status", "--porcelain")).toBe("");
		expect(await git(origin, "rev-parse", "feature")).toBe(before);
	});

	test("runs the pre-push hook without the server's own PORT", async () => {
		const { hooks, rebase } = await setup();
		writeFileSync(join(hooks, "pre-push"), '#!/bin/sh\necho "PORT=${PORT-unset}" >&2\nexit 1\n', { mode: 0o755 });
		const port = process.env.PORT;
		process.env.PORT = "4317";
		try {
			await expect(rebase()).rejects.toThrow("PORT=unset");
		} finally {
			if (port === undefined) delete process.env.PORT;
			else process.env.PORT = port;
		}
	});

	test("refuses a push once origin's branch moved after the fetch, and moves nothing", async () => {
		const { origin, main, before, rebase } = await setup();
		spyOn(proc, "run").mockImplementation(async (argv, opts) => {
			if (argv.some(arg => arg.startsWith("--force-with-lease"))) await git(main, "push", "-q", "-f", "origin", "main:feature");
			return realRun(argv, opts);
		});
		await expect(rebase()).rejects.toThrow("(stale info)");
		expect(await git(origin, "rev-parse", "feature")).toBe(await git(main, "rev-parse", "main"));
		expect(await git(main, "rev-parse", "feature")).toBe(before);
	});
});

test("replays only a stacked branch's own commits onto a parent rewritten since it branched", async () => {
	const { origin, main, prs, rebase, commit, subjects } = await setup();
	await git(main, "switch", "-q", "-c", "parent", "main~1");
	await commit(main, "parent.txt", "p1\n", "p1");
	await git(main, "switch", "-q", "-c", "child");
	await commit(main, "child.txt", "c1\n", "c1");
	await git(main, "push", "-q", "origin", "parent", "child");
	await git(main, "switch", "-q", "parent");
	writeFileSync(join(main, "parent.txt"), "p1 v2\n");
	await git(main, "commit", "-q", "-a", "--amend", "-m", "p1 v2");
	await git(main, "push", "-q", "-f", "origin", "parent");
	await git(main, "switch", "-q", "main");
	prs.set(8, ["child", "parent"]);
	expect(await rebase(8)).toEqual({ kind: "rebased", branch: "child", onto: "parent" });
	expect(await subjects(origin, "child")).toBe("c1\np1 v2\none");
});
