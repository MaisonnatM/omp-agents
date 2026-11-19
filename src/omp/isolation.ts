/** omp's task-isolation sandboxes: where they live, which omp process owns each, the ovnfs checkout an ovnfs-backed one records, and their teardown. */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { arrayOf, fields, isNonEmpty, isNumber, isString, optional } from "../json";
import type { IsolationSweepDeps, OvnfsRecord } from "../server/isolation-sweep";
import { dirs, isolationNatives, isolationOwnership, ovnfsClient, ovnfsTask } from "./modules";

/** omp's `CheckoutRecord`: the ovnfs executable that opened a sandbox's checkout, the checkout's name, and its baseline checkout while one exists. */
const isRecord = fields<{ command: string; checkout: string; start?: string }>({ command: isNonEmpty, checkout: isNonEmpty, start: optional(isNonEmpty) });
/** The part of ovnfs's `api.LsReply` the sweep reads: every live checkout, by name, and the folder it is served in. */
const isLsReply = fields<{ checkouts: { name: string; path: string }[] }>({ checkouts: arrayOf(fields({ name: isString, path: isString })) });
/** The part of ovnfs's `api.Status`, which `ovnfs --json status` prints, the sweep reads: the admin protocol and socket of the daemon that runs. */
const isStatus = fields<{ version: number; socket: string }>({ version: isNumber, socket: isNonEmpty });
/** How long `ovnfs status` may take before the sweep counts no daemon, as omp's own status query allowed. */
const STATUS_TIMEOUT_MS = 5_000;
/** The folders a retained sandbox mounts its merged view at, in the order omp's `TASK_ISOLATION_MOUNT_DIRS` checks them. */
const MOUNT_DIRS = ["m", "merged"];

/** The parts of {@link IsolationSweepDeps} that omp decides, read as omp's `omp worktree clear` reads them. */
export function ompSandboxes(): Pick<IsolationSweepDeps, "root" | "ownerFile" | "ownerLive" | "ovnfsRecord" | "stopMount" | "releaseOvnfs"> {
	return {
		root: dirs.getWorktreesDir(),
		ownerFile: isolationOwnership.ISOLATION_OWNER_FILE,
		ownerLive: dir => isolationOwnership.hasLiveIsolationOwner(dir),
		ovnfsRecord,
		stopMount,
		releaseOvnfs,
	};
}

/**
 * Stops the native mount of retained sandbox `dir`, when its record names a backend that needs it, as omp's private
 * `stopRetainedMount` does before `omp worktree clear` removes it; throws when the record is malformed or teardown fails.
 */
async function stopMount(dir: string): Promise<void> {
	const backend = await isolationOwnership.readRetainedMountBackend(dir);
	if (backend === undefined) return;
	for (const name of MOUNT_DIRS) {
		const merged = join(dir, name);
		if (await stat(merged).then(entry => entry.isDirectory(), () => false)) return isolationNatives.isoStop(backend, merged);
	}
}

/** The ovnfs command, checkout name, and baseline checkout, if any, in the text of an ovnfs sandbox's record; throws when it names no checkout. */
export function parseOvnfsRecord(text: string): { command: string; checkout: string; start?: string } {
	const record: unknown = JSON.parse(text);
	if (!isRecord(record)) throw new Error(`${ovnfsTask.OVNFS_CHECKOUT_FILE} names no ovnfs checkout.`);
	const { command, checkout, start } = record;
	return start === undefined ? { command, checkout } : { command, checkout, start };
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
	const { command, checkout, start } = parseOvnfsRecord(text);
	const daemon = await runningDaemon(command);
	if (!daemon) throw new Error(`no ovnfs daemon of ${command} runs to say where ${checkout} is.`);
	const reply = await ovnfsClient.callSocket(daemon.socket, "ls", {});
	return { command, checkout, start, socket: daemon.socket, served: servedPath(reply, checkout) };
}

/**
 * The admin socket of the daemon `command` runs, asked with `ovnfs --json status`, which never starts one; `undefined`
 * when none answers, the command fails or hangs, or the daemon speaks another admin protocol than omp's client.
 * omp 18.21 dropped its own `runningDaemon`, so the sweep asks the command as that function did.
 */
async function runningDaemon(command: string): Promise<{ socket: string } | undefined> {
	let child: Bun.Subprocess<"ignore", "pipe", "ignore">;
	try {
		child = Bun.spawn([command, "--json", "status"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", timeout: STATUS_TIMEOUT_MS, killSignal: "SIGKILL" });
	} catch {
		return undefined;
	}
	const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
	if (code !== 0) return undefined;
	let status: unknown;
	try {
		status = JSON.parse(stdout);
	} catch {
		return undefined;
	}
	return isStatus(status) && status.version === ovnfsClient.PROTOCOL_VERSION ? { socket: status.socket } : undefined;
}

/** Removes the judged checkout, after its baseline checkout as omp's `releaseOvnfsCheckout` does, on the daemon that listed it, never starting a daemon; one already gone counts as removed. */
async function releaseOvnfs({ checkout, start, socket }: OvnfsRecord): Promise<void> {
	for (const name of start === undefined ? [checkout] : [start, checkout]) {
		try {
			await ovnfsClient.callSocket(socket, "rm", { checkout: name });
		} catch (error) {
			if (!(error instanceof ovnfsClient.OvnfsError && error.code === "not_found")) throw error;
		}
	}
}
