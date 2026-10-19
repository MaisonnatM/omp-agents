/**
 * Keeps one dashboard session's omp running when the server that started it exits: it holds omp's RPC stdio and lends
 * it, through the Unix socket at `argv[2]`, to one server at a time. `startKeeper` in `src/keeper-link.ts` runs this
 * script detached from the server, in the session's directory, as `keeper <socket> <meta JSON> <rpc-frame.ts> <omp argv…>`.
 * Of omp's modules it loads only the frame decoder the server names, so it starts fast and holds little memory.
 *
 * Each connection gets a {@link KeeperHello} first, then omp's `ready` line again, so omp's own `RpcClient` starts on it as
 * on a fresh process. The keeper negotiated omp's protocol itself and answers the client's `negotiate_protocol`, which
 * makes that connection the one omp talks to. It then hears the questions omp still waits on, and every whole frame
 * omp writes from then on. omp's output while no client listens is dropped: the server reads omp's state and the
 * session file instead.
 */
import { unlinkSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { isObject } from "./json";
import { HELLO, type KeeperHello, STOP } from "./keeper-link";
import type { RpcFrameModule } from "./omp/modules";

/** The id of the keeper's own `negotiate_protocol`. */
const NEGOTIATE_ID = "omp-agents-keeper";
/** How long omp and what it started get to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;
/** How often the keeper notes the processes under omp, which it stops once omp exited and they were reparented. */
const WATCH_MS = 10_000;
/** How long after a tool call ends the keeper notes them again: an async tool call starts its background job just after it returns. */
const AFTER_TOOL_MS = 1_000;
/** omp's `extension_ui_request` methods that wait for an answer; the others only show something. */
const DIALOGS: Record<string, true> = { select: true, confirm: true, input: true, editor: true };

type Frame = Record<string, unknown>;

/** One logical frame of omp's output, with the physical lines that carry it: one, or a whole `rpc_chunk` sequence. */
interface OmpFrame {
	frame: Frame;
	lines: string[];
}

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

/** Groups omp's output lines into logical frames through omp's own decoder, so an `rpc_chunk` sequence counts as the frame it carries. */
class FrameReader {
	readonly #Decoder: RpcFrameModule["RpcFrameDecoder"];
	#decoder: InstanceType<RpcFrameModule["RpcFrameDecoder"]>;
	#lines: string[] = [];

	constructor(Decoder: RpcFrameModule["RpcFrameDecoder"]) {
		this.#Decoder = Decoder;
		this.#decoder = new Decoder();
	}

	/** The frame `line` completes, or `null` while a chunk sequence is still open or the line is no frame. */
	push(line: string): OmpFrame | null {
		let frame: object | undefined;
		try {
			frame = this.#decoder.push(JSON.parse(line));
		} catch (err) {
			// omp's client would fail on this line and stop omp; dropping it, and the sequence it broke, keeps the session.
			console.error(`omp-agents keeper: dropped omp output that is no RPC frame: ${err instanceof Error ? err.message : String(err)}`);
			this.#decoder = new this.#Decoder();
			this.#lines = [];
			return null;
		}
		this.#lines.push(line);
		if (!frame) return null;
		const lines = this.#lines;
		this.#lines = [];
		return { frame: frame as Frame, lines };
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

/** Processes by pid, each with its start time, which tells it from a later process that reuses the pid. */
type Processes = Map<number, string>;

/** Every process by pid, with its parent and start time. */
type ProcessTable = Map<number, { ppid: number; started: string }>;

/** Every process now; `null` when `ps` failed. */
function processTable(): ProcessTable | null {
	const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,lstart="]);
	if (!ps.success) return null;
	const table: ProcessTable = new Map();
	for (const line of ps.stdout.toString().split("\n")) {
		const [pid, ppid, ...started] = line.trim().split(/\s+/);
		if (pid && ppid && started.length > 0) table.set(Number(pid), { ppid: Number(ppid), started: started.join(" ") });
	}
	return table;
}

/** The processes under `root` in `table`, without `root`. */
function descendants(table: ProcessTable, root: number): Processes {
	const children = new Map<number, number[]>();
	for (const [pid, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
	const found: Processes = new Map();
	const queue = [...(children.get(root) ?? [])];
	for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
		found.set(pid, table.get(pid)?.started ?? "");
		queue.push(...(children.get(pid) ?? []));
	}
	return found;
}

/** Sends `signal` to `pid`, which may be gone already. */
function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {
		// Gone already.
	}
}

async function main(): Promise<void> {
	const [socketPath, meta, frameModule, ...command] = process.argv.slice(2);
	if (!socketPath || meta === undefined || !frameModule || command.length === 0) {
		console.error("usage: keeper <socket> <meta JSON> <rpc-frame.ts> <omp argv…>");
		process.exit(2);
	}
	// omp's install directory is known only at run time; the server checked this module's exports at its own startup.
	const { RpcFrameDecoder } = (await import(frameModule)) as RpcFrameModule;
	// The server's terminal or app going away is not a reason to stop omp; only End session is.
	process.on("SIGINT", () => {});
	process.on("SIGHUP", () => {});

	const omp = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
	/** Bun leaves `exitCode` null for a process a signal ended. */
	let ompExited = false;
	void omp.exited.then(() => {
		ompExited = true;
	});
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
	/** Host tool calls the current client heard and has not answered. */
	const toolCalls = new Set<string>();
	/** The connection omp talks to: the last one that negotiated. */
	let client: Socket | null = null;
	/** The processes omp started, as last seen: once omp exited they are no longer under it, so the reap goes by these. */
	const started: Processes = new Map();
	/** Settles once omp and everything it started stopped. */
	let reaping: Promise<void> | null = null;

	const failTool = (id: string): void =>
		write(JSON.stringify({ type: "host_tool_result", id, result: { content: [{ type: "text", text: "The dashboard restarted while this tool ran. Check what it did before you call it again." }], details: {} }, isError: true }));

	/** `gone` no longer hears omp; the tool calls it heard will never be answered, so they fail now rather than hang the turn. */
	const drop = (gone: Socket): void => {
		if (client !== gone) return;
		client = null;
		for (const id of toolCalls) failTool(id);
		toolCalls.clear();
	};

	const join = (joining: Socket): void => {
		if (client) {
			const previous = client;
			drop(previous);
			previous.destroy();
		}
		const now = Date.now();
		for (const [id, { frame, at }] of dialogs) {
			const timeout = typeof frame.timeout === "number" && frame.timeout > 0 ? frame.timeout - (now - at) : null;
			if (timeout !== null && timeout <= 0) {
				dialogs.delete(id);
				continue;
			}
			joining.write(`${JSON.stringify(timeout === null ? frame : { ...frame, timeout })}\n`);
		}
		client = joining;
	};

	/** Notes the processes under omp, and forgets those that are gone; whether `ps` answered. */
	const watch = (): boolean => {
		const table = processTable();
		if (!table) return false;
		for (const [pid, at] of started) if (table.get(pid)?.started !== at) started.delete(pid);
		if (!ompExited) for (const [pid, at] of descendants(table, omp.pid)) started.set(pid, at);
		return true;
	};
	const watcher = setInterval(watch, WATCH_MS);
	/** Whether a watch is due after a tool call ended, so a burst of calls costs one `ps`. */
	let watchDue = false;

	/**
	 * Stops omp and every process it started, for End session and for omp exiting on its own alike. omp's background jobs
	 * and kernels lead process groups or sessions of their own, and are reparented once omp exits, so only the processes
	 * the keeper saw under omp find them.
	 */
	const reap = (): Promise<void> =>
		(reaping ??= (async () => {
			let listed = watch();
			omp.kill("SIGTERM");
			for (const pid of started.keys()) signal(pid, "SIGTERM");
			const deadline = Date.now() + STOP_GRACE_MS;
			while (Date.now() < deadline && (!ompExited || started.size > 0 || !listed)) {
				await Bun.sleep(50);
				listed = watch();
			}
			omp.kill("SIGKILL");
			for (const pid of started.keys()) signal(pid, "SIGKILL");
			clearInterval(watcher);
			if (!listed) console.error(`omp-agents keeper: ps failed, so these processes omp started may still run: ${[...started.keys()].join(" ")}`);
		})());

	const fromOmp = ({ frame, lines }: OmpFrame): void => {
		if (frame.type === "tool_execution_end" && !watchDue) {
			watchDue = true;
			setTimeout(() => {
				watchDue = false;
				watch();
			}, AFTER_TOOL_MS);
		}
		if (ready === null) {
			if (frame.type !== "ready") return;
			ready = lines.join("\n");
			const versions = frame.supportedProtocolVersions;
			if (Array.isArray(versions) && versions.includes(2)) write(JSON.stringify({ type: "negotiate_protocol", id: NEGOTIATE_ID, protocolVersion: 2 }));
			else opened.resolve();
			return;
		}
		if (frame.type === "response" && frame.id === NEGOTIATE_ID) {
			negotiated = frame.success === true;
			if (!negotiated) {
				console.error(`omp-agents keeper: omp refused protocol 2: ${lines.join("\n")}`);
				void reap();
			}
			opened.resolve();
			return;
		}
		if (frame.type === "extension_ui_request" && typeof frame.id === "string") {
			if (frame.method === "cancel" && typeof frame.targetId === "string") dialogs.delete(frame.targetId);
			else if (typeof frame.method === "string" && Object.hasOwn(DIALOGS, frame.method)) dialogs.set(frame.id, { frame, at: Date.now() });
		} else if (frame.type === "host_tool_cancel" && typeof frame.targetId === "string") {
			toolCalls.delete(frame.targetId);
		} else if (frame.type === "host_tool_call" && typeof frame.id === "string") {
			// Only the client that hears the call can run it.
			if (!client) return failTool(frame.id);
			toolCalls.add(frame.id);
		}
		client?.write(`${lines.join("\n")}\n`);
	};

	const fromClient = (from: Socket, line: string): void => {
		const frame = parse(line);
		if (from !== client) {
			if (frame?.type === "negotiate_protocol" && negotiated) {
				from.write(`${JSON.stringify({ id: frame.id, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } })}\n`);
				join(from);
			}
			return;
		}
		if (frame?.type === STOP.type) return void reap();
		if (frame?.type === "extension_ui_response" && typeof frame.id === "string") dialogs.delete(frame.id);
		else if (frame?.type === "host_tool_result" && typeof frame.id === "string") toolCalls.delete(frame.id);
		write(line);
	};

	const server = createServer(socket => {
		const lines = new LineSplitter();
		socket.on("data", (chunk: Buffer) => lines.push(chunk, line => fromClient(socket, line)));
		socket.on("error", () => {});
		socket.on("close", () => drop(socket));
		void opened.promise.then(() => {
			if (socket.destroyed) return;
			// omp exited before it was ready, and the client reads why from the log; or it is being stopped.
			if (ready === null || reaping !== null) return void socket.end();
			const hello: KeeperHello = { type: HELLO, pid: omp.pid, meta: JSON.parse(meta) };
			socket.write(`${JSON.stringify(hello)}\n${ready}\n`);
			// A client of an omp without protocol 2 sends no `negotiate_protocol`, so it joins on the greeting.
			if (!negotiated) join(socket);
		});
	});
	server.listen(socketPath);

	const output = (async () => {
		const lines = new LineSplitter();
		const frames = new FrameReader(RpcFrameDecoder);
		for await (const chunk of omp.stdout)
			lines.push(chunk, line => {
				const read = frames.push(line);
				if (read) fromOmp(read);
			});
	})();
	void Promise.all([omp.exited, output.catch(() => {})]).then(async ([code]) => {
		// The client hears the end only once nothing omp started runs on.
		await reap();
		opened.resolve();
		server.close();
		try {
			unlinkSync(socketPath);
		} catch {
			// Already gone.
		}
		const last = client;
		if (!last) process.exit(code);
		last.end(() => process.exit(code));
		setTimeout(() => process.exit(code), 1_000).unref();
	});
	process.on("SIGTERM", () => void reap());
}

await main();
