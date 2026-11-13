import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles } from "../fs";
import { runChecked } from "../proc";
import { type EndedWorktree, EndedWorktrees, endSession, type RemoveCheckout, restoreEndedWorktree } from "./session-end";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = async (cwd: string, ...args: string[]): Promise<string> => (await runChecked(["git", ...args], { cwd })).trim();

/** A session in `/work/s1` whose end and worktree removal are logged in order. */
function harness(end: () => Promise<void>) {
	const log: string[] = [];
	const removeCheckout: RemoveCheckout = async dir => {
		log.push(`remove ${dir}`);
		return null;
	};
	const session = {
		sessionId: "s1",
		workDir: "/work/s1",
		async end() {
			await end();
			log.push("end");
		},
	};
	return { log, run: () => endSession(session, removeCheckout, () => log.push("remembered")) };
}

/**
 * A repository `app` cloned from `origin.git`, both on `main`, with branch `topic` one commit ahead in the worktree
 * `app-wt/topic`, which a session ended in: its removal is remembered as `ended`.
 */
async function endedInWorktree(): Promise<{ parent: string; main: string; path: string; ended: EndedWorktree }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-session-end-")));
	dirs.push(parent);
	const origin = join(parent, "origin.git");
	const main = join(parent, "app");
	await git(parent, "init", "-q", "--bare", "-b", "main", origin);
	await git(parent, "clone", "-q", origin, main);
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	await git(main, "push", "-q", "origin", "main");
	await git(main, "remote", "set-head", "origin", "main");
	const path = join(parent, "app-wt", "topic");
	await git(main, "worktree", "add", "-q", "-b", "topic", path);
	await git(path, "commit", "-q", "--allow-empty", "-m", "topic work");
	const remembered: EndedWorktree[] = [];
	await endSession(
		{ sessionId: "s1", workDir: path, end: async () => {} },
		async dir => {
			await git(main, "worktree", "remove", "--", dir);
			return { repository: join(main, ".git"), path: dir, removed: true, blockers: [], error: null };
		},
		worktree => remembered.push(worktree),
	);
	expect(remembered).toEqual([{ path, repository: main, branch: "topic" }]);
	expect(existsSync(path)).toBe(false);
	return { parent, main, path, ended: remembered[0]! };
}

describe("endSession", () => {
	test("removes the worktree once the session has ended", async () => {
		const { log, run } = harness(async () => {});
		await run();
		expect(log).toEqual(["end", "remove /work/s1"]);
	});

	test("keeps the worktree of a session that could not be ended", async () => {
		const { log, run } = harness(async () => {
			throw new Error("gone");
		});
		await expect(run()).rejects.toThrow("gone");
		expect(log).toEqual([]);
	});

	test("worktree cleanup failure remains nonfatal after successful termination", async () => {
		const log: string[] = [];
		await endSession({
			sessionId: "s1",
			workDir: "/work/s1",
			end: async () => { log.push("ended"); },
		}, async dir => {
			log.push(`cleanup ${dir}`);
			throw new Error("dirty worktree");
		}, () => log.push("remembered"));
		expect(log).toEqual(["ended", "cleanup /work/s1"]);
	});

	test("remembers no worktree it kept", async () => {
		const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-session-end-")));
		dirs.push(parent);
		const main = join(parent, "app");
		await git(parent, "init", "-q", "-b", "main", main);
		await git(main, "commit", "-q", "--allow-empty", "-m", "one");
		const path = join(parent, "app-wt", "topic");
		await git(main, "worktree", "add", "-q", "-b", "topic", path);
		const remembered: EndedWorktree[] = [];
		await endSession(
			{ sessionId: "s1", workDir: path, end: async () => {} },
			async dir => ({ repository: join(main, ".git"), path: dir, removed: false, blockers: [{ code: "changed", message: "dirty" }], error: null }),
			worktree => remembered.push(worktree),
		);
		expect(remembered).toEqual([]);
	});
});

describe("restoreEndedWorktree", () => {
	test("adds the removed worktree back at its path on the branch ending the session kept", async () => {
		const { main, path, ended } = await endedInWorktree();
		const tip = await git(main, "rev-parse", "topic");
		await restoreEndedWorktree(ended);
		expect(await git(path, "branch", "--show-current")).toBe("topic");
		expect(await git(path, "rev-parse", "HEAD")).toBe(tip);
		// A second resume finds it in place and leaves it.
		await restoreEndedWorktree(ended);
		expect(await git(path, "rev-parse", "HEAD")).toBe(tip);
	});

	test("starts a new branch of that name from origin's default branch once the branch is gone", async () => {
		const { main, path, ended } = await endedInWorktree();
		await git(main, "branch", "-q", "-D", "topic");
		await git(main, "commit", "-q", "--allow-empty", "-m", "two");
		await git(main, "push", "-q", "origin", "main");
		await restoreEndedWorktree(ended);
		expect(await git(path, "branch", "--show-current")).toBe("topic");
		expect(await git(path, "rev-parse", "HEAD")).toBe(await git(main, "rev-parse", "origin/main"));
	});

	test("refuses, adding nothing, once the repository is gone", async () => {
		const { main, path, ended } = await endedInWorktree();
		rmSync(main, { recursive: true, force: true });
		await expect(restoreEndedWorktree(ended)).rejects.toThrow(`the repository ${main} of this session's worktree ${path} no longer exists`);
		expect(existsSync(path)).toBe(false);
	});

	test("does nothing for a session that ended in no worktree", async () => {
		await restoreEndedWorktree(null);
	});
});

describe("EndedWorktrees", () => {
	test("keeps each session's removed worktree across restarts, the latest per session", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-ended-")));
		dirs.push(dir);
		const file = join(dir, "ended-worktrees.json");
		const ended = new EndedWorktrees(file);
		ended.record("s1", { path: "/code/app-wt/a", repository: "/code/app", branch: "a" });
		ended.record("s1", { path: "/code/app-wt/b", repository: "/code/app", branch: "b" });
		ended.record("s2", { path: "/code/app-wt/c", repository: "/code/app", branch: "c" });
		flushJsonFiles();
		const reloaded = new EndedWorktrees(file);
		expect(reloaded.of(["s1"])).toEqual({ path: "/code/app-wt/b", repository: "/code/app", branch: "b" });
		expect(reloaded.of(["copy", "s2"])?.branch).toBe("c");
		expect(reloaded.of(["s3"])).toBeNull();
	});
});
