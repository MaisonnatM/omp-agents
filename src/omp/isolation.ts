/** omp's task-isolation sandboxes: where they live, which omp process owns each, where an ovnfs-backed one's checkout is, and omp's teardown of one. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "../json";
import type { IsolationSweepDeps, OvnfsSandboxCheckout } from "../server/isolation-sweep";
import type { OvnfsLsReply } from "./module-types/processes";
import { dirs, isolationOwnership, ovnfsClient, ovnfsDaemon, ovnfsTask, worktreeCli } from "./modules";

/** The parts of {@link IsolationSweepDeps} that omp decides, read as omp's `omp worktree clear` reads them. */
export function ompSandboxes(): Pick<IsolationSweepDeps, "root" | "ownerFile" | "ownerLive" | "ovnfsCheckout" | "release"> {
	return {
		root: dirs.getWorktreesDir(),
		ownerFile: isolationOwnership.ISOLATION_OWNER_FILE,
		ownerLive: dir => isolationOwnership.hasLiveIsolationOwner(dir),
		ovnfsCheckout,
		release: async dir => {
			await worktreeCli.stopRetainedMount(dir);
			await ovnfsTask.releaseOvnfsCheckout(dir);
		},
	};
}

/**
 * The ovnfs checkout sandbox `dir` records, as the daemon of the ovnfs executable that opened it lists it.
 * It asks only a daemon that already runs: the sweep never starts a file system daemon of its own accord.
 */
async function ovnfsCheckout(dir: string): Promise<OvnfsSandboxCheckout | null> {
	const file = ovnfsTask.OVNFS_CHECKOUT_FILE;
	let text: string;
	try {
		text = await readFile(join(dir, file), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	let record: unknown;
	try {
		record = JSON.parse(text);
	} catch {
		record = null;
	}
	if (!isObject(record) || typeof record.command !== "string" || typeof record.checkout !== "string") throw new Error(`${file} names no ovnfs checkout.`);
	const { command, checkout } = record;
	const daemon = await ovnfsDaemon.runningDaemon(command);
	if (!daemon) throw new Error(`no ovnfs daemon of ${command} runs to say where ${checkout} is.`);
	let listed: OvnfsLsReply;
	try {
		listed = await ovnfsClient.callSocket(daemon.socket, "ls", {});
	} catch (error) {
		// As omp's own searches do: a socket that stopped answering is asked for again on the next sweep.
		if (!(error instanceof ovnfsClient.OvnfsError)) ovnfsDaemon.forgetDaemon(command);
		throw error;
	}
	const served = listed.checkouts.find(entry => entry.name === checkout);
	return served ? { kind: "ovnfs", path: served.path } : { kind: "none" };
}
