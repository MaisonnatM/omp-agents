/**
 * The server's side of a session keeper (`src/keeper.ts`): it starts one for each session the dashboard starts, finds
 * the ones a previous server left running, and connects to one as the process omp's `RpcClient` drives.
 */
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { isObject } from "./json";
import { HELLO, type KeeperMeta, pidFileOf, STOP } from "./keeper-wire";
import type { RpcProcess } from "./omp/modules";
import { ProcessCensus, signal } from "./process-census";
import { keeperScript } from "./server/resources";

/** One connection to a keeper. */
export interface KeeperLink {
	/** omp as the process its `RpcClient` drives: a kill stops omp, and `exited` settles with {@link ended}, either way. */
	process: RpcProcess;
	/** Why the connection ended: this server hung up ({@link detach}), or the keeper did, once omp exited. */
	ended: Promise<"detach" | "exit">;
	meta: KeeperMeta;
	/** Hangs up without stopping omp, which keeps running for the next server. */
	detach(): void;
}

/** How long a keeper gets to listen once spawned. */
const LISTEN_TIMEOUT_MS = 10_000;
/** How long a running keeper gets to greet a server that attaches; one greets at once unless it is stuck. */
const GREET_TIMEOUT_MS = 3_000;
/** How long a stuck keeper, its omp, and what omp started get to exit on SIGTERM before SIGKILL. */
const STUCK_GRACE_MS = 3_000;
/** The stderr tail `peekStderr` reads, as omp's `RpcClient` quotes it in a start error. */
const STDERR_TAIL_BYTES = 4_096;
/** macOS's `sun_path` holds 104 bytes with its NUL. */
const MAX_SOCKET_PATH_BYTES = 103;

const socketOf = (dir: string, instanceId: string): string => join(dir, `${instanceId}.sock`);
const logOf = (dir: string, instanceId: string): string => join(dir, `${instanceId}.log`);

/** The last {@link STDERR_TAIL_BYTES} of `path`, or `""` when it cannot be read. */
function tail(path: string): string {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		const { size } = fstatSync(fd);
		const length = Math.min(size, STDERR_TAIL_BYTES);
		const bytes = Buffer.alloc(length);
		readSync(fd, bytes, 0, length, size - length);
		return bytes.toString("utf8");
	} catch {
		return "";
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function parseMeta(value: unknown): KeeperMeta | null {
	return isObject(value) && typeof value.startedAt === "number" && typeof value.cwd === "string" ? { startedAt: value.startedAt, cwd: value.cwd } : null;
}

/** A keeper that took the connection and did not greet within `greetMs`, which the connection then hung up on. */
class KeeperSilent extends Error {}

/**
 * Connects to the keeper of session `instanceId` and reads its greeting. Rejects when none listens there, or it hangs
 * up before it greets, as one does whose omp exited before it was ready, or it does not greet within `greetMs`.
 */
function connect(dir: string, instanceId: string, greetMs: number | null): Promise<KeeperLink> {
	const log = logOf(dir, instanceId);
	const { promise, resolve, reject } = Promise.withResolvers<KeeperLink>();
	const socket = createConnection(socketOf(dir, instanceId));
	let output!: ReadableStreamDefaultController<Uint8Array>;
	const stdout = new ReadableStream<Uint8Array>({ start: controller => void (output = controller) });
	const ended = Promise.withResolvers<"detach" | "exit">();
	let greeted = false;
	let detached = false;
	/** The stderr tail once the keeper is gone and its log with it. */
	let lastStderr: string | null = null;
	let head = Buffer.alloc(0);
	const silence =
		greetMs === null
			? undefined
			: setTimeout(() => {
					socket.destroy();
					reject(new KeeperSilent(`The session keeper did not greet within ${greetMs / 1000} s.`));
				}, greetMs);

	socket.on("data", (chunk: Buffer) => {
		if (greeted) return output.enqueue(chunk);
		head = Buffer.concat([head, chunk]);
		const end = head.indexOf(0x0a);
		if (end === -1) return;
		let hello: unknown;
		try {
			hello = JSON.parse(head.subarray(0, end).toString("utf8"));
		} catch {
			hello = null;
		}
		const meta = isObject(hello) && hello.type === HELLO && Number.isSafeInteger(hello.pid) ? parseMeta(hello.meta) : null;
		if (!isObject(hello) || !meta) {
			socket.destroy();
			return reject(new Error("The session keeper did not greet as one."));
		}
		greeted = true;
		clearTimeout(silence);
		if (end + 1 < head.length) output.enqueue(head.subarray(end + 1));
		resolve({
			meta,
			ended: ended.promise,
			detach: () => {
				detached = true;
				socket.destroy();
			},
			process: {
				pid: hello.pid as number,
				// omp's `RpcClient` quotes it as an exit code.
				exited: ended.promise.then(() => 0),
				stdin: { write: data => socket.write(data) },
				stdout,
				peekStderr: () => lastStderr ?? tail(log),
				// omp's `RpcClient` also kills a process whose output ended: a hang-up, which must not stop omp.
				kill: () => {
					if (!detached && !socket.destroyed) socket.write(`${JSON.stringify(STOP)}\n`);
				},
			},
		});
	});
	socket.on("error", error => {
		if (!greeted) reject(error);
	});
	socket.on("close", () => {
		clearTimeout(silence);
		if (!greeted) reject(new Error(`The session keeper hung up before omp was ready. ${tail(log)}`.trim()));
		else if (!detached) {
			// The keeper hangs up once omp exited, so its log holds all omp wrote.
			lastStderr = tail(log);
			rmSync(log, { force: true });
		}
		try {
			output.close();
		} catch {
			// Already closed.
		}
		ended.resolve(detached ? "detach" : "exit");
	});
	return promise;
}

/** What a keeper runs: omp's `argv` in `cwd` with `env`, reading omp's output through omp's `rpc-frame.ts` at `frameModule`. */
export interface KeeperLaunch {
	cwd: string;
	argv: string[];
	env: Record<string, string | undefined>;
	frameModule: string;
	meta: KeeperMeta;
}

/**
 * Starts a keeper for session `instanceId` in `dir`, and connects to it once it listens. Detached, in its own session,
 * so neither the server's exit nor a signal to its process group reaches it.
 */
export async function startKeeper(dir: string, instanceId: string, { cwd, argv, env, frameModule, meta }: KeeperLaunch): Promise<KeeperLink> {
	const socket = socketOf(dir, instanceId);
	if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES) throw new Error(`The session socket path is too long for macOS: ${socket}. Set a shorter XDG_CONFIG_HOME.`);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const log = logOf(dir, instanceId);
	const fd = openSync(log, "a", 0o600);
	let shell: Bun.Subprocess<"ignore", "pipe", number>;
	try {
		// The shell starts the keeper in the background and exits, so the keeper is no child of the server's: whatever
		// stops the server's process tree, not only its process group, misses it.
		shell = Bun.spawn(["/bin/sh", "-c", '"$@" >&2 </dev/null & echo $!', "keeper", process.execPath, keeperScript, socket, JSON.stringify(meta), frameModule, ...argv], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: fd, detached: true });
	} finally {
		closeSync(fd);
	}
	const pid = Number((await new Response(shell.stdout).text()).trim());
	const running = (): boolean => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	const deadline = Date.now() + LISTEN_TIMEOUT_MS;
	for (;;) {
		try {
			return await connect(dir, instanceId, null);
		} catch (error) {
			const code = isObject(error) ? error.code : undefined;
			if (code !== "ENOENT" && code !== "ECONNREFUSED") throw error;
		}
		if (!Number.isSafeInteger(pid) || !running()) throw new Error(`The session keeper exited. ${tail(log)}`.trim());
		if (Date.now() > deadline) {
			process.kill(pid, "SIGTERM");
			throw new Error(`The session keeper did not listen within ${LISTEN_TIMEOUT_MS / 1000} s.`);
		}
		await Bun.sleep(20);
	}
}

/**
 * Stops the keeper whose pid `pidFile` records, with its omp and every process under it, without its help: SIGTERM,
 * then SIGKILL to what is left after {@link STUCK_GRACE_MS}. Whether the file named a pid.
 */
async function endKeeper(pidFile: string): Promise<boolean> {
	let pid: number;
	try {
		pid = Number(readFileSync(pidFile, "utf8").trim());
	} catch {
		return false;
	}
	if (!Number.isSafeInteger(pid) || pid <= 1) return false;
	const tree = new ProcessCensus(pid, { everyMs: STUCK_GRACE_MS, soonMs: STUCK_GRACE_MS, graceMs: STUCK_GRACE_MS });
	tree.note();
	signal(pid, "SIGTERM");
	await tree.reap();
	signal(pid, "SIGKILL");
	return true;
}

/**
 * Connects to the keeper of session `instanceId`; one that no longer listens leaves no files behind. One that takes the
 * connection and does not greet within {@link GREET_TIMEOUT_MS} is stuck: it is stopped with the omp it holds, so no
 * Resume starts a second omp on the session's file.
 */
export async function attachKeeper(dir: string, instanceId: string): Promise<KeeperLink> {
	const socket = socketOf(dir, instanceId);
	try {
		return await connect(dir, instanceId, GREET_TIMEOUT_MS);
	} catch (error) {
		const stuck = error instanceof KeeperSilent ? `${error.message} ${(await endKeeper(pidFileOf(socket))) ? "It was stopped with the omp it held." : "Its pid is not recorded, so it and its omp may still run."}` : null;
		for (const path of [socket, logOf(dir, instanceId), pidFileOf(socket)]) rmSync(path, { force: true });
		throw stuck === null ? error : new Error(stuck);
	}
}

/** The sessions whose keeper may still listen in `dir`; a log or pid file that lost its keeper is removed. */
export function listKeepers(dir: string): string[] {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const ids = names.flatMap(name => (name.endsWith(".sock") ? [name.slice(0, -".sock".length)] : []));
	for (const name of names) {
		const id = name.replace(/\.(log|pid)$/, "");
		if (id !== name && !ids.includes(id)) rmSync(join(dir, name), { force: true });
	}
	return ids;
}
