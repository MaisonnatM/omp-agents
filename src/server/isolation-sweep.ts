/**
 * The daily sweep of omp's isolation sandboxes: the directories under `~/.omp/wt` where omp runs a subagent's isolated
 * task, each a marker naming the omp process that owns it and the checkout `m` (`merged` in older ones), a full copy of
 * the repository. omp removes one when its task ends, but one whose omp exited first stays, gigabytes each.
 * The sweep removes a sandbox only when its omp no longer runs and its checkout is clean, unlocked, and unused; a
 * directory without the marker, such as a pull request's checkout, is not one, and anything it cannot read stays.
 */
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonical, type Registration, worktreeAt, worktreesOf } from "../git";
import { errorText, isObject } from "../json";
import { mapLimit } from "../map-limit";
import { run } from "../proc";
import { allocatedUsage, beneath } from "../worktrees";
import { CleanupBusy, type SandboxKeepReason, type SandboxPlan, type SandboxResult } from "../shared/storage";

/** How long between two sweeps: a sandbox left behind costs disk, not correctness, and each sweep runs `git status` in every one. */
export const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** Sandboxes read at once, each by a few git calls over a full checkout. */
const SANDBOX_READS = 4;
/** A first `git status` in a copied checkout hashes every file again, since the copy changed each file's inode and times. */
const STATUS_TIMEOUT_MS = 120_000;
/** The checkout directories omp makes in a sandbox, the current one first. */
const CHECKOUT_DIRS = ["m", "merged"];
/** The suffix a sandbox takes while it is removed, so a removal cut short is finished by the next sweep rather than read as a sandbox again. */
const REMOVING_SUFFIX = ".omp-agents-removing";

export interface IsolationSweepDeps {
	/** omp's directory of sandboxes, `getWorktreesDir`. */
	root: string;
	/** The name of the owner marker in a sandbox, `ISOLATION_OWNER_FILE`. */
	ownerFile: string;
	/** Whether the omp process the marker in sandbox `dir` names still runs: the same process id, not a reused one. */
	ownerLive(dir: string): Promise<boolean>;
	/** Stops the native mount a retained sandbox `dir` records, if any; throws when it cannot, which keeps the sandbox. */
	stopMount(dir: string): Promise<void>;
	/** The canonical directories live sessions and the server run in, and the paths live sessions' tool calls named, `Worktrees.inUse`. */
	inUse(): Promise<string[]>;
	now(): number;
}

const keep = (path: string, kept: SandboxKeepReason, detail: string): SandboxResult => ({ path, kept, detail });

export class IsolationSweep {
	readonly #deps: IsolationSweepDeps;
	#last = Number.NEGATIVE_INFINITY;
	#running = false;

	constructor(deps: IsolationSweepDeps) {
		this.#deps = deps;
	}

	/**
	 * A minute passed on the server that owns the unattended work: starts a sweep when none ran for {@link SWEEP_EVERY_MS}
	 * and none runs, and returns it, which logs its result; the minute tick does not wait for it.
	 */
	tick(): Promise<void> | null {
		const now = this.#deps.now();
		if (this.#running || now - this.#last < SWEEP_EVERY_MS) return null;
		this.#last = now;
		const running = this.sweep().then(logSweep, (error: unknown) => console.error(`omp-agents: cannot sweep omp's isolation sandboxes: ${errorText(error)}`));
		return running;
	}

	/** A dry run, including each kept reason, with measured sizes only for removable sandboxes. */
	preview(): Promise<SandboxPlan[]> {
		return this.#exclusive(() => this.#preview());
	}

	/** Rechecks each requested direct child before removal, never following a symlink out of the root. */
	remove(paths: readonly string[]): Promise<SandboxResult[]> {
		return this.#exclusive(async () => {
			const inUse = await this.#deps.inUse();
			const results: SandboxResult[] = [];
			for (const path of [...new Set(paths)]) {
				try {
					if (dirname(resolve(path)) !== resolve(this.#deps.root) || path.endsWith(REMOVING_SUFFIX) || !(await lstat(path)).isDirectory()) {
						results.push(keep(path, "unreadable", "Not an isolation sandbox in omp's directory."));
						continue;
					}
					const result = await this.#removeIfEligible(path, inUse);
					results.push(result ?? keep(path, "unreadable", "Its owner marker is gone."));
				} catch (error) { results.push(keep(path, "unreadable", errorText(error))); }
			}
			return results;
		});
	}

	/** The unattended sweep keeps its existing recovery of interrupted removals. */
	sweep(): Promise<SandboxResult[]> {
		return this.#exclusive(async () => {
			const dirs = await this.#directories();
			await Promise.all(dirs.filter(dir => dir.endsWith(REMOVING_SUFFIX)).map(dir => rm(dir, { recursive: true, force: true }).catch((error: unknown) => console.error(`omp-agents: cannot finish removing ${dir}: ${errorText(error)}`))));
			const inUse = await this.#deps.inUse();
			const results = await mapLimit(dirs.filter(dir => !dir.endsWith(REMOVING_SUFFIX)), SANDBOX_READS, async path => {
				try { return await this.#removeIfEligible(path, inUse); }
				catch (error) { return keep(path, "unreadable", errorText(error)); }
			});
			return results.filter(result => result !== null);
		});
	}

	async #exclusive<T>(run: () => Promise<T>): Promise<T> {
		if (this.#running) throw new CleanupBusy();
		this.#running = true;
		try { return await run(); }
		finally { this.#running = false; }
	}

	async #directories(): Promise<string[]> {
		let entries: Dirent[];
		try { entries = await readdir(this.#deps.root, { withFileTypes: true }); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		return entries.filter(entry => entry.isDirectory()).map(entry => join(this.#deps.root, entry.name));
	}

	async #preview(): Promise<SandboxPlan[]> {
		const dirs = (await this.#directories()).filter(dir => !dir.endsWith(REMOVING_SUFFIX));
		const inUse = await this.#deps.inUse();
		const plans = await mapLimit(dirs, SANDBOX_READS, async (path): Promise<SandboxPlan | null> => {
			try {
				const judged = await this.#judge(path, inUse);
				if (judged === null) return null;
				if (judged) return { ...judged, bytes: null };
				const bytes = await allocatedUsage(path).catch(() => null);
				return { path, kept: null, detail: null, bytes };
			} catch (error) { return { ...keep(path, "unreadable", errorText(error)), bytes: null }; }
		});
		return plans.filter(plan => plan !== null);
	}

	/** Why sandbox `dir` stays, `undefined` when it may go, `null` when it is no sandbox. */
	async #judge(dir: string, inUse: readonly string[]): Promise<SandboxResult | null | undefined> {
		let marker: unknown;
		try {
			marker = JSON.parse(await readFile(join(dir, this.#deps.ownerFile), "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			return keep(dir, "unreadable", `Cannot read its owner marker: ${errorText(error)}`);
		}
		// omp reads a marker without a process id as no owner; the sweep keeps what it cannot attribute.
		if (!isObject(marker) || typeof marker.pid !== "number" || !Number.isInteger(marker.pid) || marker.pid <= 0) return keep(dir, "unreadable", "Its owner marker names no process.");
		if (await this.#deps.ownerLive(dir)) return keep(dir, "owner-live", `omp process ${marker.pid} still runs.`);
		const real = await canonical(dir);
		const user = inUse.find(path => beneath(real, path));
		if (user) return keep(dir, "occupied", `A live session or the server runs in ${user}.`);
		const checkout = await checkoutOf(dir);
		// omp claims a sandbox before it makes the checkout, so one whose omp died in between holds nothing of a task.
		if (checkout === null) return undefined;
		const at = await worktreeAt(checkout);
		if (!at || (await canonical(at.top)) !== (await canonical(checkout))) return keep(dir, "unreadable", `${checkout} is not a Git checkout of its own.`);
		const status = await run(["git", "-C", checkout, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { timeoutMs: STATUS_TIMEOUT_MS });
		if (status.code !== 0) return keep(dir, "unreadable", status.stderr.trim() || "git status failed.");
		if (status.stdout) return keep(dir, "changed", "Its checkout has tracked modifications or untracked files.");
		if (at.linked) {
			const top = await canonical(at.top);
			let own: Registration | undefined;
			for (const registration of await worktreesOf(checkout)) {
				if ((await canonical(registration.path)) !== top) continue;
				own = registration;
				break;
			}
			if (!own) return keep(dir, "unreadable", "Its checkout is not registered in its repository.");
			if (own.locked !== null) return keep(dir, "locked", `Git locked its checkout${own.locked ? `: ${own.locked}` : "."}`);
		}
		return undefined;
	}

	async #removeIfEligible(path: string, inUse: readonly string[]): Promise<SandboxResult | null> {
		const judged = await this.#judge(path, inUse);
		return judged === undefined ? this.#remove(path) : judged;
	}

	/** Removes sandbox `dir`, which {@link #judge} let go, unless a new task claimed it meanwhile. */
	async #remove(dir: string): Promise<SandboxResult> {
		// omp names a sandbox after its repository and task id, so a task run again takes the same directory.
		if (await this.#deps.ownerLive(dir)) return keep(dir, "owner-live", "A new omp process claimed it.");
		try {
			await this.#deps.stopMount(dir);
			const removing = `${dir}${REMOVING_SUFFIX}`;
			await rename(dir, removing);
			await rm(removing, { recursive: true, force: true });
			return { path: dir, kept: null, detail: null };
		} catch (error) {
			return keep(dir, "failed", errorText(error));
		}
	}
}

/** The checkout directory in sandbox `dir`, `null` when it has none. */
async function checkoutOf(dir: string): Promise<string | null> {
	for (const name of CHECKOUT_DIRS) {
		const path = join(dir, name);
		try {
			const stat = await lstat(path);
			if (stat.isDirectory()) return path;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return null;
}

const KEPT_WHY: Record<SandboxKeepReason, string> = {
	"owner-live": "whose omp still runs",
	occupied: "in use",
	changed: "with changes",
	locked: "locked",
	unreadable: "unreadable",
	failed: "whose removal failed",
};

/** One line for the sweep, and one more for each sandbox it could not read or remove. */
function logSweep(results: readonly SandboxResult[]): void {
	if (results.length === 0) return;
	const removed = results.filter(result => result.kept === null).length;
	const counts = Map.groupBy(results.filter(result => result.kept !== null), result => result.kept!);
	const kept = [...counts].map(([reason, some]) => `${some.length} ${KEPT_WHY[reason]}`).join(", ");
	console.log(`omp-agents: the isolation sweep removed ${removed} of omp's sandboxes and kept ${results.length - removed}${kept ? ` (${kept})` : ""}.`);
	for (const result of results) if (result.kept === "unreadable" || result.kept === "failed") console.error(`omp-agents: kept the isolation sandbox ${result.path}: ${result.detail}`);
}
