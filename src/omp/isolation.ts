/** omp's task-isolation sandboxes: where they live, which omp process owns each, the ovnfs checkout an ovnfs-backed one records, and their teardown. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { arrayOf, fields, isNonEmpty, isString } from "../json";
import type { IsolationSweepDeps, OvnfsRecord } from "../server/isolation-sweep";
import { dirs, isolationOwnership, ovnfsClient, ovnfsDaemon, ovnfsTask, worktreeCli } from "./modules";

/** omp's `CheckoutRecord`: the ovnfs executable that opened a sandbox's checkout, and the checkout's name. */
const isRecord = fields<{ command: string; checkout: string }>({ command: isNonEmpty, checkout: isNonEmpty });
/** The part of ovnfs's `api.LsReply` the sweep reads: every live checkout, by name, and the folder it is served in. */
const isLsReply = fields<{ checkouts: { name: string; path: string }[] }>({ checkouts: arrayOf(fields({ name: isString, path: isString })) });

/** The parts of {@link IsolationSweepDeps} that omp decides, read as omp's `omp worktree clear` reads them. */
export function ompSandboxes(): Pick<IsolationSweepDeps, "root" | "ownerFile" | "ownerLive" | "ovnfsRecord" | "stopMount" | "releaseOvnfs"> {
	return {
		root: dirs.getWorktreesDir(),
		ownerFile: isolationOwnership.ISOLATION_OWNER_FILE,
		ownerLive: dir => isolationOwnership.hasLiveIsolationOwner(dir),
		ovnfsRecord,
		stopMount: async dir => {
			await worktreeCli.stopRetainedMount(dir);
		},
		releaseOvnfs,
	};
}

/** The ovnfs command and checkout name in the text of an ovnfs sandbox's record; throws when it names neither. */
export function parseOvnfsRecord(text: string): { command: string; checkout: string } {
	const record: unknown = JSON.parse(text);
	if (!isRecord(record)) throw new Error(`${ovnfsTask.OVNFS_CHECKOUT_FILE} names no ovnfs checkout.`);
	return { command: record.command, checkout: record.checkout };
}

/** The folder ovnfs's `ls` `reply` serves `checkout` in, `null` when it lists no checkout by that name; throws on any other reply. */
export function servedPath(reply: unknown, checkout: string): string | null {
	if (!isLsReply(reply)) throw new Error("ovnfs answered ls without a list of checkouts.");
	return reply.checkouts.find(entry => entry.name === checkout)?.path ?? null;
}

/** The ovnfs checkout sandbox `dir` records, as the daemon of the executable that opened it lists it; asks only a daemon that already runs. */
async function ovnfsRecord(dir: string): Promise<OvnfsRecord | null> {
	let text: string;
	try {
		text = await readFile(join(dir, ovnfsTask.OVNFS_CHECKOUT_FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const { command, checkout } = parseOvnfsRecord(text);
	const daemon = await ovnfsDaemon.runningDaemon(command);
	if (!daemon) throw new Error(`no ovnfs daemon of ${command} runs to say where ${checkout} is.`);
	const reply = await call(command, daemon.socket, "ls");
	return { command, checkout, socket: daemon.socket, served: servedPath(reply, checkout) };
}

/** Removes the judged checkout on the daemon that listed it, as omp's `removeCheckout` does but never starting a daemon; one already gone counts as removed. */
async function releaseOvnfs({ command, checkout, socket }: OvnfsRecord): Promise<void> {
	try {
		await call(command, socket, "rm", { checkout });
	} catch (error) {
		if (!(error instanceof ovnfsClient.OvnfsError && error.code === "not_found")) throw error;
	}
}

/** One operation on the daemon at `socket`; a socket that stopped answering is forgotten, as omp's own `call` does, so the next sweep asks `command` again. */
async function call(command: string, socket: string, op: "ls" | "rm", args: object = {}): Promise<unknown> {
	try {
		return await ovnfsClient.callSocket(socket, op, args);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ECONNREFUSED" || code === "ENOENT") ovnfsDaemon.forgetDaemon(command);
		throw error;
	}
}
