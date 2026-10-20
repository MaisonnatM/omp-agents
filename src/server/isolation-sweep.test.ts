import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runChecked } from "../proc";
import { IsolationSweep, type IsolationSweepDeps, SWEEP_EVERY_MS } from "./isolation-sweep";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });
const OWNER_FILE = ".omp-isolation-owner.json";

function scratch(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-isolation-")));
	dirs.push(dir);
	return dir;
}

/** A sandbox named `name` under `root` as omp leaves it: the owner marker and, unless `checkout` is false, a committed checkout `m`. */
async function sandbox(root: string, name: string, checkout = true): Promise<string> {
	const dir = join(root, name);
	mkdirSync(dir);
	writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: 4242, id: name, startToken: "Mon Oct 19 09:00:00 2026" }));
	if (checkout) {
		const m = join(dir, "m");
		mkdirSync(m);
		await git(m, "init", "-q", "-b", "main");
		writeFileSync(join(m, "a.txt"), "a\n");
		await git(m, "add", "a.txt");
		await git(m, "commit", "-q", "-m", "one");
	}
	return dir;
}

/** A sweep over `root`, where the sandboxes named in `live` have a running owner. */
function sweepOf(root: string, overrides: Partial<IsolationSweepDeps> & { live?: string[] } = {}): IsolationSweep {
	const live = new Set(overrides.live ?? []);
	return new IsolationSweep({
		root,
		ownerFile: OWNER_FILE,
		ownerLive: async dir => live.has(basename(dir)),
		stopMount: async () => {},
		inUse: async () => [],
		now: () => 0,
		...overrides,
	});
}

describe("isolation sweep", () => {
	test("removes a clean sandbox whose omp exited, and one omp left before it made the checkout", async () => {
		const root = scratch();
		const done = await sandbox(root, "tdone");
		const empty = await sandbox(root, "tempty", false);
		const results = await sweepOf(root).sweep();
		expect(results.map(result => [basename(result.path), result.kept]).sort()).toEqual([["tdone", null], ["tempty", null]]);
		expect(existsSync(done)).toBe(false);
		expect(existsSync(empty)).toBe(false);
		expect(readdirSync(root)).toEqual([]);
	});

	test("keeps a sandbox whose omp still runs", async () => {
		const root = scratch();
		const dir = await sandbox(root, "tlive");
		expect((await sweepOf(root, { live: ["tlive"] }).sweep()).map(result => result.kept)).toEqual(["owner-live"]);
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a sandbox with an untracked file or a tracked change", async () => {
		const root = scratch();
		const untracked = await sandbox(root, "tuntracked");
		writeFileSync(join(untracked, "m", "new.txt"), "new\n");
		const modified = await sandbox(root, "tmodified");
		writeFileSync(join(modified, "m", "a.txt"), "changed\n");
		const results = await sweepOf(root).sweep();
		expect(results.map(result => result.kept)).toEqual(["changed", "changed"]);
		expect(existsSync(untracked) && existsSync(modified)).toBe(true);
	});

	test("keeps a sandbox whose checkout is a linked worktree Git locked", async () => {
		const root = scratch();
		const source = join(scratch(), "app");
		mkdirSync(source);
		await git(source, "init", "-q", "-b", "main");
		await git(source, "commit", "-q", "--allow-empty", "-m", "one");
		const dir = join(root, "tlocked");
		mkdirSync(dir);
		writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: 4242, id: "tlocked" }));
		await git(source, "worktree", "add", "-q", "-b", "task", join(dir, "m"));
		await git(source, "worktree", "lock", "--reason", "keep me", join(dir, "m"));
		const [result] = await sweepOf(root).sweep();
		expect(result?.kept).toBe("locked");
		expect(result?.detail).toContain("keep me");
		expect(existsSync(dir)).toBe(true);
	});

	test("keeps a sandbox a live session runs in", async () => {
		const root = scratch();
		const dir = await sandbox(root, "tused");
		mkdirSync(join(dir, "m", "src"));
		const results = await sweepOf(root, { inUse: async () => [join(dir, "m", "src"), "/elsewhere"] }).sweep();
		expect(results.map(result => result.kept)).toEqual(["occupied"]);
		expect(existsSync(dir)).toBe(true);
	});

	test("leaves a directory without the owner marker alone, and keeps one whose marker names no process", async () => {
		const root = scratch();
		const checkout = join(root, "pr-123");
		mkdirSync(checkout);
		writeFileSync(join(checkout, ".git"), "gitdir: /somewhere\n");
		const garbled = await sandbox(root, "tgarbled");
		writeFileSync(join(garbled, OWNER_FILE), "{");
		const nameless = await sandbox(root, "tnameless");
		writeFileSync(join(nameless, OWNER_FILE), JSON.stringify({ id: "tnameless" }));
		const results = await sweepOf(root).sweep();
		expect(results.map(result => [basename(result.path), result.kept]).sort()).toEqual([["tgarbled", "unreadable"], ["tnameless", "unreadable"]]);
		expect(existsSync(checkout) && existsSync(garbled) && existsSync(nameless)).toBe(true);
	});

	test("keeps a sandbox a new task claimed after it was read, and one whose mount would not stop", async () => {
		const root = scratch();
		const claimed = await sandbox(root, "tclaimed");
		const mounted = await sandbox(root, "tmounted");
		let reads = 0;
		const results = await sweepOf(root, {
			ownerLive: async dir => basename(dir) === "tclaimed" && ++reads > 1,
			stopMount: async dir => {
				if (basename(dir) === "tmounted") throw new Error("isoStop failed");
			},
		}).sweep();
		expect(results.map(result => [basename(result.path), result.kept]).sort()).toEqual([["tclaimed", "owner-live"], ["tmounted", "failed"]]);
		expect(existsSync(claimed) && existsSync(mounted)).toBe(true);
	});

	test("finishes a removal an earlier sweep began", async () => {
		const root = scratch();
		const left = join(root, "told.omp-agents-removing");
		mkdirSync(join(left, "m"), { recursive: true });
		writeFileSync(join(left, OWNER_FILE), JSON.stringify({ pid: 4242, id: "told" }));
		expect(await sweepOf(root).sweep()).toEqual([]);
		expect(existsSync(left)).toBe(false);
	});

	test("a missing root sweeps nothing", async () => {
		expect(await sweepOf(join(scratch(), "wt")).sweep()).toEqual([]);
	});

	test("ticks sweep once a day, never two at once", async () => {
		const root = scratch();
		await sandbox(root, "tday");
		let now = 1_000;
		const sweep = sweepOf(root, { now: () => now });
		const first = sweep.tick();
		expect(first).not.toBeNull();
		expect(sweep.tick()).toBeNull();
		await first;
		expect(existsSync(join(root, "tday"))).toBe(false);
		now += SWEEP_EVERY_MS - 1;
		expect(sweep.tick()).toBeNull();
		now += 1;
		await sandbox(root, "tnext");
		await sweep.tick();
		expect(existsSync(join(root, "tnext"))).toBe(false);
	});
});
