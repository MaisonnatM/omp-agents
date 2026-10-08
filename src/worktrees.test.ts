import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecked } from "./proc";
import { Worktrees } from "./worktrees";
import type { WorktreeRemovalPlan } from "./worktrees-shared";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });

async function repo(): Promise<{ parent: string; main: string }> {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "omp-worktrees-")));
	dirs.push(parent);
	const main = join(parent, "app");
	mkdirSync(main);
	await git(main, "init", "-q", "-b", "main");
	await git(main, "commit", "-q", "--allow-empty", "-m", "one");
	return { parent, main };
}

const common = async (main: string): Promise<string> => realpathSync((await git(main, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());

async function linked(parent: string, main: string, name = "wip"): Promise<string> {
	const path = join(parent, name);
	await git(main, "worktree", "add", "-q", "-b", name, path);
	return path;
}

const quiet = new Worktrees({
	knownCwds: () => [],
	activity: () => [],
	live: () => [],
	serverCwd: "/no/such/dashboard",
});

/** A plan the server could read, which carries its confirmation. */
function readable(plan: WorktreeRemovalPlan): Exclude<WorktreeRemovalPlan, { kind: "unreadable" }> {
	if (plan.kind === "unreadable") throw new Error(plan.blockers.map(blocker => blocker.message).join(" "));
	return plan;
}

describe("worktree removal", () => {
	test("lists every registered worktree of a known repository and refuses the main checkout", async () => {
		const { parent, main } = await repo();
		const path = await linked(parent, main);
		const listed = await new Worktrees({ knownCwds: () => [main], activity: () => [{ id: "s", cwd: path, modifiedAt: 50 }], live: () => [], serverCwd: "/no/such/dashboard" }).inventory(null);
		expect(listed.repositories.map(item => item.worktrees.map(entry => entry.path))).toEqual([[main, path]]);
		expect(listed.repositories[0]?.worktrees[1]?.lastActivity).toBe(50);
		const repository = listed.repositories[0]?.repository ?? "";
		const plan = readable(await quiet.preview({ repository, path: main }));
		expect(plan.blockers.some(blocker => blocker.code === "main")).toBe(true);
		expect((await quiet.remove([plan])).map(result => result.removed)).toEqual([false]);
		expect(existsSync(main)).toBe(true);
	});

	test("removes a clean linked checkout, keeps its branch, and deletes ignored files", async () => {
		const { parent, main } = await repo();
		const path = await linked(parent, main, "keep-me");
		writeFileSync(join(path, ".gitignore"), ".env\n");
		writeFileSync(join(path, ".env"), "SECRET=1\n");
		await git(path, "add", ".gitignore");
		await git(path, "commit", "-q", "-m", "ignore");
		const plan = readable(await quiet.preview({ repository: await common(main), path }));
		expect(plan.blockers).toEqual([]);
		expect(plan.ignored).toContain(".env");
		expect((await quiet.remove([plan]))[0]?.removed).toBe(true);
		expect(existsSync(path)).toBe(false);
		expect((await git(main, "show-ref", "--verify", "refs/heads/keep-me")).trim()).toContain("refs/heads/keep-me");
	});

	test("removeCheckout waits for the session that just ended to leave, and leaves a main checkout or a directory outside git alone", async () => {
		const { parent, main } = await repo();
		const path = await linked(parent, main, "ending");
		let leaving = 2;
		const worktrees = new Worktrees({
			knownCwds: () => [],
			activity: () => [],
			live: () => (leaving-- > 0 ? [{ cwd: join(path, "src"), unknownAgents: false }] : []),
			serverCwd: "/no/such/dashboard",
		});
		expect((await worktrees.removeCheckout(join(path, ".")))?.removed).toBe(true);
		expect(existsSync(path)).toBe(false);
		expect(await worktrees.removeCheckout(main)).toBeNull();
		expect(await worktrees.removeCheckout(parent)).toBeNull();
		const stuck = await linked(parent, main, "stuck");
		const busy = new Worktrees({ knownCwds: () => [], activity: () => [], live: () => [{ cwd: stuck, unknownAgents: false }], serverCwd: "/no/such/dashboard" });
		expect((await busy.removeCheckout(stuck, 0))?.blockers.map(blocker => blocker.code)).toEqual(["occupied"]);
	});

	test("refuses a dirty checkout, a lock, a live session, an unknown subagent, and the server checkout", async () => {
		const { parent, main } = await repo();
		const dirty = await linked(parent, main, "dirty");
		writeFileSync(join(dirty, "untracked.txt"), "keep\n");
		const locked = await linked(parent, main, "locked");
		await git(main, "worktree", "lock", "--reason", "held", locked);
		const occupied = await linked(parent, main, "occupied");
		mkdirSync(join(occupied, "src"));
		const trees = new Worktrees({
			knownCwds: () => [main],
			activity: () => [],
			live: () => [
				{ cwd: join(occupied, "src"), unknownAgents: false },
				{ cwd: main, unknownAgents: true },
			],
			serverCwd: locked,
		});
		const repository = await common(main);
		expect((await trees.preview({ repository, path: dirty })).blockers.some(blocker => blocker.code === "changed")).toBe(true);
		const lockedPlan = readable(await trees.preview({ repository, path: locked }));
		expect(lockedPlan.blockers.map(blocker => blocker.code)).toContain("locked");
		expect(lockedPlan.blockers.map(blocker => blocker.code)).toContain("server");
		expect((await trees.preview({ repository, path: occupied })).blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(["occupied", "unknown-agent-location"]));
		expect((await trees.remove([lockedPlan]))[0]?.removed).toBe(false);
		expect(existsSync(locked)).toBe(true);
		expect(existsSync(join(dirty, "untracked.txt"))).toBe(true);
	});

	test("refuses a confirmation after the checkout changes", async () => {
		const { parent, main } = await repo();
		const path = await linked(parent, main, "drift");
		const plan = readable(await quiet.preview({ repository: await common(main), path }));
		writeFileSync(join(path, "later.txt"), "later\n");
		const result = (await quiet.remove([plan]))[0];
		expect(result?.removed).toBe(false);
		expect(result?.blockers.some(blocker => blocker.code === "drift" || blocker.code === "changed")).toBe(true);
		expect(existsSync(join(path, "later.txt"))).toBe(true);
	});

	test("forgets a missing registration and warns when its detached commit is otherwise unreachable", async () => {
		const { parent, main } = await repo();
		const gone = await linked(parent, main, "gone");
		rmSync(gone, { recursive: true, force: true });
		const repository = await common(main);
		const registration = readable(await quiet.preview({ repository, path: gone }));
		expect(registration.kind).toBe("registration");
		expect(registration.detachedCommitLoss).toBe(false);
		expect((await quiet.remove([registration]))[0]?.removed).toBe(true);
		expect(await git(main, "worktree", "list", "--porcelain")).not.toContain(gone);
		expect((await git(main, "show-ref", "--verify", "refs/heads/gone")).trim()).toContain("refs/heads/gone");

		const detached = join(parent, "detached");
		await git(main, "worktree", "add", "-q", "--detach", detached);
		await git(detached, "commit", "-q", "--allow-empty", "-m", "only-here");
		rmSync(detached, { recursive: true, force: true });
		const loss = readable(await quiet.preview({ repository, path: detached }));
		expect(loss.kind).toBe("registration");
		expect(loss.detachedCommitLoss).toBe(true);
	});

	test("refuses a checkout that points at another repository or contains a nested one", async () => {
		const { parent, main } = await repo();
		const path = await linked(parent, main, "foreign");
		const { main: other } = await repo();
		writeFileSync(join(path, ".git"), `gitdir: ${join(other, ".git")}\n`);
		const repository = await common(main);
		const foreign = readable(await quiet.preview({ repository, path }));
		expect(foreign.blockers.some(blocker => blocker.code === "foreign" || blocker.code === "unreadable")).toBe(true);
		expect((await quiet.remove([foreign]))[0]?.removed).toBe(false);
		expect(existsSync(path)).toBe(true);

		const nested = await linked(parent, main, "nested");
		writeFileSync(join(nested, ".gitignore"), "node_modules\n");
		await git(nested, "add", ".gitignore");
		await git(nested, "commit", "-q", "-m", "ignore");
		const inner = join(nested, "node_modules", "inner");
		mkdirSync(inner, { recursive: true });
		await git(inner, "init", "-q", "-b", "main");
		const plan = readable(await quiet.preview({ repository, path: nested }));
		expect(plan.blockers.some(blocker => blocker.code === "nested-repository")).toBe(true);
		expect((await quiet.remove([plan]))[0]?.removed).toBe(false);
		expect(existsSync(join(inner, ".git"))).toBe(true);

		const bare = join(nested, "node_modules", "archive.git");
		await git(nested, "init", "-q", "--bare", bare);
		expect((await quiet.preview({ repository, path: nested })).blockers.some(blocker => blocker.code === "nested-repository")).toBe(true);
	});

	test("lists a repository that no session has visited when its path is requested", async () => {
		const { main } = await repo();
		const listed = await quiet.inventory(main);
		expect(listed.errors).toEqual([]);
		expect(listed.repositories[0]?.worktrees.map(entry => entry.path)).toEqual([main]);
		expect((await quiet.inventory(null)).repositories).toEqual([]);
	});
});
