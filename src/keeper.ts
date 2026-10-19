/**
 * Keeps one dashboard session's omp running when the server that started it exits: it holds omp's RPC stdio and lends
 * it, through the Unix socket at `argv[2]`, to one server at a time. `startKeeper` in `src/keeper-link.ts` runs this
 * script detached from the server, in the session's directory, as `keeper <socket> <meta JSON> <omp argv…>`. It loads
 * none of omp's modules, so it starts fast and holds little memory.
 *
 * Each connection gets a {@link KeeperHello} first, then omp's `ready` line again, so omp's own `RpcClient` starts on it as
 * on a fresh process. The keeper negotiated omp's protocol itself and answers the client's `negotiate_protocol`.
 * Then the client hears the questions omp still waits on, and from the next whole frame on, whatever omp writes.
 * omp's output while no client listens is dropped: the server reads omp's state and the session file instead.
 */
import { unlinkSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { isObject } from "./json";
import { HELLO, type KeeperHello, STOP } from "./keeper-link";

/** The id of the keeper's own `negotiate_protocol`. */
const NEGOTIATE_ID = "omp-agents-keeper";
/** How long omp gets to exit on SIGTERM before its process group gets SIGKILL. */
const STOP_GRACE_MS = 3_000;
/** omp's `extension_ui_request` methods that wait for an answer; the others only show something. */
const DIALOGS: Record<string, true> = { select: true, confirm: true, input: true, editor: true };

type Frame = Record<string, unknown>;

/** Splits a byte stream into lines at `\n` without decoding a character cut between two chunks. */
class LineSplitter {
	#parts: Buffer[] = [];

	push(chunk: Uint8Array, onLine: (line: string) => void): void {
		let start = 0;
		let end = chunk.indexOf(0x0a);
		while (end !== -1) {
			const tail = Buffer.from(chunk.subarray(start, end));
			const line = this.#parts.length > 0 ? Buffer.concat([...this.#parts, tail]) : tail;
			this.#parts = [];
			onLine(line.toString("utf8"));
			start = end + 1;
			end = chunk.indexOf(0x0a, start);
		}
		if (start < chunk.length) this.#parts.push(Buffer.from(chunk.subarray(start)));
	}
}

function parse(line: string): Frame | null {
	try {
		const value: unknown = JSON.parse(line);
		return isObject(value) ? value : null;
	} catch {
		return null;
	}
}

/** A connected server: it hears omp once it negotiated, and from the next whole frame on. */
interface Client {
	socket: Socket;
	joined: boolean;
	live: boolean;
}

/** `root` and every process under it now, found through `ps`. */
function processTree(root: number): number[] {
	const children = new Map<number, number[]>();
	for (const line of Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid="]).stdout.toString().split("\n")) {
		const [pid, ppid] = line.trim().split(/\s+/).map(Number);
		if (pid && ppid) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
	}
	const tree = [root];
	for (let index = 0; index < tree.length; index++) tree.push(...(children.get(tree[index] ?? 0) ?? []));
	return tree;
}

/** Sends `signal` to `pid`; whether the process was there to receive it. */
function signal(pid: number, name: NodeJS.Signals | 0): boolean {
	try {
		process.kill(pid, name);
		return true;
	} catch {
		return false;
	}
}

function main(): void {
	const [socketPath, meta, ...command] = process.argv.slice(2);
	if (!socketPath || meta === undefined || command.length === 0) {
		console.error("usage: keeper <socket> <meta JSON> <omp argv…>");
		process.exit(2);
	}
	// The server's terminal or app going away is not a reason to stop omp; only End session is.
	process.on("SIGINT", () => {});
	process.on("SIGHUP", () => {});

	const omp = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
	const write = (line: string): void => {
		omp.stdin.write(`${line}\n`);
		void Promise.resolve(omp.stdin.flush()).catch(() => {});
	};

	/** omp's `ready` line, which every client starts on. */
	let ready: string | null = null;
	/** Whether the keeper negotiated omp's protocol 2, so each client's `negotiate_protocol` is answered here. */
	let negotiated = false;
	/** Settles once clients can start: omp is ready and negotiated, or it exited. */
	const opened = Promise.withResolvers<void>();
	/** Questions omp waits on, by request id, with when they came. */
	const dialogs = new Map<string, { frame: Frame; at: number }>();
	/** Host tool calls the current client runs. */
	const toolCalls = new Set<string>();
	let client: Client | null = null;
	/** Settles once End session stopped omp and everything it started. */
	let stopped: Promise<void> | null = null;

	const failTool = (id: string): void =>
		write(JSON.stringify({ type: "host_tool_result", id, result: { content: [{ type: "text", text: "The dashboard restarted while this tool ran. Check what it did before you call it again." }], details: {} }, isError: true }));

	const drop = (gone: Client): void => {
		if (client !== gone) return;
		client = null;
		for (const id of toolCalls) failTool(id);
		toolCalls.clear();
	};

	const join = (joining: Client): void => {
		const now = Date.now();
		for (const [id, { frame, at }] of dialogs) {
			const timeout = typeof frame.timeout === "number" && frame.timeout > 0 ? frame.timeout - (now - at) : null;
			if (timeout !== null && timeout <= 0) {
				dialogs.delete(id);
				continue;
			}
			joining.socket.write(`${JSON.stringify(timeout === null ? frame : { ...frame, timeout })}\n`);
		}
		joining.joined = true;
	};

	// omp's background jobs can lead process groups of their own, so the stop walks the tree, as omp's own `ptree` does.
	const stop = (): void => {
		stopped ??= (async () => {
			const tree = processTree(omp.pid);
			for (const pid of tree) signal(pid, "SIGTERM");
			const deadline = Date.now() + STOP_GRACE_MS;
			while (Date.now() < deadline && tree.some(pid => signal(pid, 0))) await Bun.sleep(50);
			for (const pid of tree) signal(pid, "SIGKILL");
		})();
	};

	const fromOmp = (line: string): void => {
		const frame = parse(line);
		if (ready === null) {
			if (frame?.type !== "ready") return;
			ready = line;
			const versions = frame.supportedProtocolVersions;
			if (Array.isArray(versions) && versions.includes(2)) write(JSON.stringify({ type: "negotiate_protocol", id: NEGOTIATE_ID, protocolVersion: 2 }));
			else opened.resolve();
			return;
		}
		if (frame?.type === "response" && frame.id === NEGOTIATE_ID) {
			negotiated = frame.success === true;
			if (!negotiated) {
				console.error(`omp-agents keeper: omp refused protocol 2: ${line}`);
				stop();
			}
			opened.resolve();
			return;
		}
		if (frame?.type === "extension_ui_request" && typeof frame.id === "string") {
			if (frame.method === "cancel" && typeof frame.targetId === "string") dialogs.delete(frame.targetId);
			else if (typeof frame.method === "string" && Object.hasOwn(DIALOGS, frame.method)) dialogs.set(frame.id, { frame, at: Date.now() });
		} else if (frame?.type === "host_tool_cancel" && typeof frame.targetId === "string") {
			toolCalls.delete(frame.targetId);
		} else if (frame?.type === "host_tool_call" && typeof frame.id === "string") {
			// Only the client that hears the call can run it; a call that reaches none fails now rather than hang the turn.
			if (client?.live) toolCalls.add(frame.id);
			else return failTool(frame.id);
		}
		const listening = client;
		if (!listening?.joined) return;
		// A client that joins in the middle of a chunked frame starts after it.
		if (!listening.live && !(frame?.type === "rpc_chunk" && frame.index !== 0)) listening.live = true;
		if (listening.live) listening.socket.write(`${line}\n`);
	};

	const fromClient = (from: Client, line: string): void => {
		const frame = parse(line);
		if (frame?.type === STOP.type) return stop();
		if (frame?.type === "negotiate_protocol" && negotiated && !from.joined) {
			from.socket.write(`${JSON.stringify({ id: frame.id, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } })}\n`);
			return join(from);
		}
		if (client !== from) return;
		if (frame?.type === "extension_ui_response" && typeof frame.id === "string") dialogs.delete(frame.id);
		else if (frame?.type === "host_tool_result" && typeof frame.id === "string") toolCalls.delete(frame.id);
		write(line);
	};

	const server = createServer(socket => {
		const joining: Client = { socket, joined: false, live: false };
		if (client) {
			const previous = client;
			drop(previous);
			previous.socket.destroy();
		}
		client = joining;
		const lines = new LineSplitter();
		socket.on("data", (chunk: Buffer) => lines.push(chunk, line => fromClient(joining, line)));
		socket.on("error", () => {});
		socket.on("close", () => drop(joining));
		void opened.promise.then(() => {
			if (socket.destroyed) return;
			// omp exited before it was ready, and the client reads why from the log; or End session already stops it.
			if (ready === null || stopped !== null) return void socket.end();
			const hello: KeeperHello = { type: HELLO, pid: omp.pid, meta: JSON.parse(meta) };
			socket.write(`${JSON.stringify(hello)}\n${ready}\n`);
			if (!negotiated) join(joining);
		});
	});
	server.listen(socketPath);

	const output = (async () => {
		const lines = new LineSplitter();
		for await (const chunk of omp.stdout) lines.push(chunk, fromOmp);
	})();
	void Promise.all([omp.exited, output.catch(() => {})]).then(async ([code]) => {
		// The client hears the end only once nothing omp started runs on.
		await stopped;
		opened.resolve();
		server.close();
		try {
			unlinkSync(socketPath);
		} catch {
			// Already gone.
		}
		const last = client;
		if (!last) process.exit(code);
		last.socket.end(() => process.exit(code));
		setTimeout(() => process.exit(code), 1_000).unref();
	});
	process.on("SIGTERM", stop);
}

main();
