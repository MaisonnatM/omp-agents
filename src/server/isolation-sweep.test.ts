import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runChecked } from "../proc";
import { CleanupBusy } from "../shared/storage";
import { IsolationSweep, type IsolationSweepDeps, SWEEP_EVERY_MS } from "./isolation-sweep";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]): Promise<string> => runChecked(["git", ...args], { cwd, env: IDENTITY });
const OWNER_FILE = ".omp-isolation-owner.json";
const RECORD_FILE = "ovnfs-record";

function scratch(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-isolation-")));
	dirs.push(dir);
	return dir;
}

/** A committed Git checkout at `dir`. */
async function repo(dir: string): Promise<string> {
	mkdirSync(dir);
	await git(dir, "init", "-q", "-b", "main");
	writeFileSync(join(dir, "a.txt"), "a\n");
	await git(dir, "add", "a.txt");
	await git(dir, "commit", "-q", "-m", "one");
	return dir;
}

/** A sandbox named `name` under `root` as omp leaves it: the owner marker and, unless `checkout` is false, a committed checkout `m`. */
async function sandbox(root: string, name: string, checkout = true): Promise<string> {
	const dir = join(root, name);
	mkdirSync(dir);
	writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: 4242, id: name, startToken: "Mon Oct 19 09:00:00 2026" }));
	if (checkout) await repo(join(dir, "m"));
	return dir;
}

/** A sandbox named `name` under `root` as omp leaves an ovnfs-backed one: the owner marker and a record naming ovnfs checkout `checkout`. */
async function ovnfsSandbox(root: string, name: string, checkout: string): Promise<string> {
	const dir = await sandbox(root, name, false);
	writeFileSync(join(dir, RECORD_FILE), checkout);
	return dir;
}

/**
 * An ovnfs whose running daemon serves each checkout `served` maps to a path, lists none it maps to `null` or leaves out,
 * and cannot be asked about one it maps to an error. Releasing a checkout deletes its files, as ovnfs's `rm` does, and
 * records its name in `released`.
 */
function fakeOvnfs(served: Record<string, string | null | Error>): Pick<IsolationSweepDeps, "ovnfsRecord" | "releaseOvnfs"> & { released: string[] } {
	const released: string[] = [];
	return {
		released,
		ovnfsRecord: async dir => {
			if (!existsSync(join(dir, RECORD_FILE))) return null;
			const checkout = readFileSync(join(dir, RECORD_FILE), "utf8");
			const entry = served[checkout] ?? null;
			if (entry instanceof Error) throw entry;
			return { command: "ovnfs", checkout, socket: "/ovnfs.sock", served: entry };
		},
		releaseOvnfs: async ({ checkout }) => {
			released.push(checkout);
			const entry = served[checkout];
			if (typeof entry === "string") rmSync(entry, { recursive: true, force: true });
		},
	};
}

/** A sweep over `root`, where the sandboxes named in `live` have a running owner. */
function sweepOf(root: string, overrides: Partial<IsolationSweepDeps> & { live?: string[] } = {}): IsolationSweep {
	const live = new Set(overrides.live ?? []);
	return new IsolationSweep({
		root,
		ownerFile: OWNER_FILE,
		ownerLive: async dir => live.has(basename(dir)),
		ovnfsRecord: async () => null,
		stopMount: async () => {},
		releaseOvnfs: async () => {},
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

	test("removes an ovnfs sandbox whose omp exited, releasing its clean checkout, and one ovnfs no longer lists without asking ovnfs to remove anything", async () => {
		const root = scratch();
		const served = await repo(join(scratch(), "served"));
		const done = await ovnfsSandbox(root, "tdone", "omp-tdone-a1b2c3");
		const gone = await ovnfsSandbox(root, "tgone", "omp-tgone-d4e5f6");
		const ovnfs = fakeOvnfs({ "omp-tdone-a1b2c3": served, "omp-tgone-d4e5f6": null });
		const results = await sweepOf(root, ovnfs).sweep();
		expect(results.map(result => [basename(result.path), result.kept]).sort()).toEqual([["tdone", null], ["tgone", null]]);
		expect(existsSync(done) || existsSync(gone) || existsSync(served)).toBe(false);
		expect(ovnfs.released).toEqual(["omp-tdone-a1b2c3"]);
	});

	test("keeps an ovnfs sandbox whose checkout changed, is in use, or cannot be located, releasing none", async () => {
		const root = scratch();
		const edited = await repo(join(scratch(), "edited"));
		writeFileSync(join(edited, "a.txt"), "edited\n");
		const used = await repo(join(scratch(), "used"));
		mkdirSync(join(used, "src"));
		const sandboxes = [await ovnfsSandbox(root, "tedited", "omp-edited"), await ovnfsSandbox(root, "tused", "omp-used"), await ovnfsSandbox(root, "tlost", "omp-lost")];
		const ovnfs = fakeOvnfs({ "omp-edited": edited, "omp-used": used, "omp-lost": new Error("no ovnfs daemon runs") });
		const results = await sweepOf(root, { ...ovnfs, inUse: async () => [join(used, "src")] }).sweep();
		expect(results.map(result => [basename(result.path), result.kept]).sort()).toEqual([["tedited", "changed"], ["tlost", "unreadable"], ["tused", "occupied"]]);
		expect(results.find(result => basename(result.path) === "tlost")?.detail).toContain("no ovnfs daemon runs");
		expect(sandboxes.every(dir => existsSync(dir)) && existsSync(edited) && existsSync(used)).toBe(true);
		expect(ovnfs.released).toEqual([]);
	});

	test("a removal that discards changes releases a changed ovnfs checkout", async () => {
		const root = scratch();
		const edited = await repo(join(scratch(), "edited"));
		writeFileSync(join(edited, "new.txt"), "new\n");
		const dir = await ovnfsSandbox(root, "tedited", "omp-edited");
		const ovnfs = fakeOvnfs({ "omp-edited": edited });
		const [result] = await sweepOf(root, ovnfs).remove([dir], { discardChanges: true });
		expect(result?.kept).toBeNull();
		expect(existsSync(dir) || existsSync(edited)).toBe(false);
		expect(ovnfs.released).toEqual(["omp-edited"]);
	});

	test("releases the ovnfs checkout it judged, though the sandbox's record names another by the time it is removed", async () => {
		const root = scratch();
		const judged = await repo(join(scratch(), "judged"));
		const other = await repo(join(scratch(), "other"));
		const dir = await ovnfsSandbox(root, "trerun", "omp-trerun-aaaaaa");
		const ovnfs = fakeOvnfs({ "omp-trerun-aaaaaa": judged, "omp-trerun-bbbbbb": other });
		let reads = 0;
		const results = await sweepOf(root, {
			...ovnfs,
			ownerLive: async () => {
				if (++reads === 2) writeFileSync(join(dir, RECORD_FILE), "omp-trerun-bbbbbb");
				return false;
			},
		}).sweep();
		expect(results.map(result => result.kept)).toEqual([null]);
		expect(ovnfs.released).toEqual(["omp-trerun-aaaaaa"]);
		expect(existsSync(other)).toBe(true);
	});

	test("preview gives no size for an ovnfs sandbox whose checkout ovnfs serves, and sizes one whose checkout it no longer lists", async () => {
		const root = scratch();
		const served = await ovnfsSandbox(root, "tserved", "omp-served");
		const gone = await ovnfsSandbox(root, "tgone", "omp-gone");
		const plans = await sweepOf(root, fakeOvnfs({ "omp-served": await repo(join(scratch(), "served")) })).preview();
		expect(plans.find(plan => plan.path === served)).toMatchObject({ kept: null, bytes: null });
		expect(plans.find(plan => plan.path === gone)?.bytes).toBeGreaterThan(0);
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

	test("preview measures removable sandboxes without deleting them or interrupted removals", async () => {
		const root = scratch();
		const done = await sandbox(root, "tdone");
		const live = await sandbox(root, "tlive");
		const pending = join(root, "told.omp-agents-removing");
		mkdirSync(pending);
		const plans = await sweepOf(root, { live: ["tlive"] }).preview();
		expect(plans.find(plan => plan.path === done)?.bytes).toBeGreaterThan(0);
		expect(plans.find(plan => plan.path === live)).toMatchObject({ kept: "owner-live", bytes: null });
		expect(plans).toHaveLength(2);
		expect(existsSync(done) && existsSync(live) && existsSync(pending)).toBe(true);
	});

	test("manual removal rechecks changes and rejects outside paths and directory symlinks", async () => {
		const root = scratch();
		const changed = await sandbox(root, "tchanged");
		const clean = await sandbox(root, "tclean");
		const outside = await sandbox(scratch(), "toutside");
		const linked = join(root, "tlinked");
		symlinkSync(outside, linked, "dir");
		let inUseReads = 0;
		const sweep = sweepOf(root, { inUse: async () => { inUseReads++; return []; } });
		await sweep.preview();
		writeFileSync(join(changed, "m", "new.txt"), "keep me");
		const results = await sweep.remove([changed, clean, outside, linked]);
		expect(inUseReads).toBe(2);
		expect(results.map(result => result.kept)).toEqual(["changed", null, "unreadable", "unreadable"]);
		expect(existsSync(changed) && existsSync(outside) && existsSync(linked)).toBe(true);
		expect(existsSync(clean)).toBe(false);
	});

	test("preview sizes a sandbox kept for its changes, and only a removal that discards changes takes it", async () => {
		const root = scratch();
		const edited = await sandbox(root, "tedited");
		writeFileSync(join(edited, "m", "a.txt"), "edited\n");
		const live = await sandbox(root, "tlive");
		writeFileSync(join(live, "m", "a.txt"), "edited\n");
		const sweep = sweepOf(root, { live: ["tlive"] });
		const plans = await sweep.preview();
		expect(plans.find(plan => plan.path === edited)?.kept).toBe("changed");
		expect(plans.find(plan => plan.path === edited)?.bytes).toBeGreaterThan(0);
		expect(plans.find(plan => plan.path === live)).toMatchObject({ kept: "owner-live", bytes: null });
		expect((await sweep.sweep()).map(result => result.kept).sort()).toEqual(["changed", "owner-live"]);
		expect((await sweep.remove([edited, live], { discardChanges: true })).map(result => result.kept)).toEqual([null, "owner-live"]);
		expect(existsSync(edited)).toBe(false);
		expect(existsSync(live)).toBe(true);
	});

	test("a removal that discards changes still keeps a changed checkout Git locked", async () => {
		const root = scratch();
		const source = join(scratch(), "app");
		mkdirSync(source);
		await git(source, "init", "-q", "-b", "main");
		await git(source, "commit", "-q", "--allow-empty", "-m", "one");
		const dir = join(root, "tlocked");
		mkdirSync(dir);
		writeFileSync(join(dir, OWNER_FILE), JSON.stringify({ pid: 4242, id: "tlocked" }));
		await git(source, "worktree", "add", "-q", "-b", "task", join(dir, "m"));
		await git(source, "worktree", "lock", join(dir, "m"));
		writeFileSync(join(dir, "m", "new.txt"), "new\n");
		const [result] = await sweepOf(root).remove([dir], { discardChanges: true });
		expect(result?.kept).toBe("locked");
		expect(existsSync(dir)).toBe(true);
	});

	test("manual preview, removal, and the unattended sweep share one guard", async () => {
		const root = scratch();
		await sandbox(root, "tguard", false);
		const barrier = Promise.withResolvers<string[]>();
		const sweep = sweepOf(root, { inUse: () => barrier.promise });
		const preview = sweep.preview();
		await expect(sweep.remove([])).rejects.toBeInstanceOf(CleanupBusy);
		await expect(sweep.sweep()).rejects.toBeInstanceOf(CleanupBusy);
		expect(sweep.tick()).toBeNull();
		barrier.resolve([]);
		await preview;
		expect(await sweep.remove([])).toEqual([]);
	});

	test("the unattended sweep reads occupied paths once and judges each sandbox only once", async () => {
		const root = scratch();
		await sandbox(root, "tone");
		await sandbox(root, "ttwo");
		let inUseReads = 0;
		const ownerReads = new Map<string, number>();
		const sweep = sweepOf(root, {
			inUse: async () => { inUseReads++; return []; },
			ownerLive: async path => { ownerReads.set(path, (ownerReads.get(path) ?? 0) + 1); return false; },
		});
		expect((await sweep.sweep()).map(result => result.kept)).toEqual([null, null]);
		expect(inUseReads).toBe(1);
		expect([...ownerReads.values()]).toEqual([2, 2]);
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
