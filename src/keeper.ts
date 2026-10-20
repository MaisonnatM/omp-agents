/**
 * Keeps one dashboard session's omp running when the server that started it exits: it holds omp's RPC stdio and lends
 * it, through the Unix socket at `argv[2]`, to one server at a time. `startKeeper` in `src/keeper-link.ts` runs this
 * script detached from the server, in the session's directory, as `keeper <socket> <meta JSON> <rpc-frame.ts> <omp argv…>`.
 * Of omp's modules it loads only the frame decoder the server names, so it starts fast and holds little memory.
 *
 * Each connection gets a {@link KeeperHello} first, then omp's `ready` line again, so omp's own `RpcClient` starts on it as
 * on a fresh process. The client's `negotiate_protocol`, which omp answers again as it did the first, makes that
 * connection the one omp talks to; a client of an omp without protocol 2 sends none, and joins on the greeting. It then
 * hears the questions omp still waits on, and every whole frame omp writes from then on. omp's output while no client
 * listens is dropped: the server reads omp's state and the session file instead.
 */
import { unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { isObject } from "./json";
import { HELLO, type KeeperHello, pidFileOf, STOP } from "./keeper-wire";
import type { RpcFrameModule } from "./omp/modules";
import { ProcessCensus } from "./process-census";

/** How long omp and what it started get to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;
/** How often the keeper notes the processes under omp, which it stops once omp exited and they were reparented. */
const WATCH_MS = 10_000;
/** How long after a tool call ends the keeper notes them again: an async tool call starts its background job just after it returns. */
const AFTER_TOOL_MS = 1_000;
/** omp's `extension_ui_request` methods that wait for an answer; the others only show something. */
const DIALOGS: Record<string, true> = { select: true, confirm: true, input: true, editor: true };

type Frame = Record<string, unknown>;

/** Who may talk to omp. A connection that has not joined can neither write to omp nor stop it. */
type Gate =
	/** omp has not written `ready`, so connections wait for their greeting. */
	| { kind: "starting" }
	/** omp is ready, offering `protocol` at most; `client` is the connection it talks to, the last one that joined. */
	| { kind: "live"; ready: string; protocol: 1 | 2; client: Socket | null }
	/** omp is being stopped or exited: no connection joins any more, and `client` hears the end. */
	| { kind: "stopping"; client: Socket | null };

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
	const census = new ProcessCensus(omp.pid, { everyMs: WATCH_MS, soonMs: AFTER_TOOL_MS, graceMs: STOP_GRACE_MS });
	const write = (line: string): void => {
		omp.stdin.write(`${line}\n`);
		void Promise.resolve(omp.stdin.flush()).catch(() => {});
	};

	let gate: Gate = { kind: "starting" };
	/** Settles once the gate left `starting`, when the connections that wait get their greeting or their hang-up. */
	const opened = Promise.withResolvers<void>();
	/** Questions omp waits on, by request id, with when they came. */
	const dialogs = new Map<string, { frame: Frame; at: number }>();
	/** Host tool calls the current client heard and has not answered. */
	const toolCalls = new Set<string>();

	const failTool = (id: string): void =>
		write(JSON.stringify({ type: "host_tool_result", id, result: { content: [{ type: "text", text: "The dashboard restarted while this tool ran. Check what it did before you call it again." }], details: {} }, isError: true }));

	/** `gone` no longer hears omp; the tool calls it heard will never be answered, so they fail now rather than hang the turn. */
	const drop = (gone: Socket): void => {
		if (gate.kind === "starting" || gate.client !== gone) return;
		gate.client = null;
		if (gate.kind !== "live") return;
		for (const id of toolCalls) failTool(id);
		toolCalls.clear();
	};

	const join = (live: Extract<Gate, { kind: "live" }>, joining: Socket): void => {
		if (live.client) {
			const previous = live.client;
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
		live.client = joining;
	};

	/** The gate closes for good; the client that talks to omp keeps hearing it until it exits. */
	const close = (): void => {
		if (gate.kind === "stopping") return;
		gate = { kind: "stopping", client: gate.kind === "live" ? gate.client : null };
		opened.resolve();
	};

	/** End session: notes what omp started while omp is still its parent, then stops omp and all of it. */
	const stop = (): void => {
		if (gate.kind === "stopping") return;
		close();
		census.note();
		omp.kill("SIGTERM");
		setTimeout(() => omp.kill("SIGKILL"), STOP_GRACE_MS).unref();
		void census.reap();
	};

	const fromOmp = ({ frame, lines }: OmpFrame): void => {
		if (frame.type === "tool_execution_end") census.noteSoon();
		if (gate.kind === "starting") {
			if (frame.type !== "ready") return;
			const versions = frame.supportedProtocolVersions;
			gate = { kind: "live", ready: lines.join("\n"), protocol: Array.isArray(versions) && versions.includes(2) ? 2 : 1, client: null };
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
			if (!gate.client) return failTool(frame.id);
			toolCalls.add(frame.id);
		}
		gate.client?.write(`${lines.join("\n")}\n`);
	};

	const fromClient = (from: Socket, line: string): void => {
		if (gate.kind !== "live") return;
		const frame = parse(line);
		if (from !== gate.client) {
			// omp's client negotiates right after the greeting, so its negotiation is its join; omp answers it.
			if (frame?.type !== "negotiate_protocol" || gate.protocol !== 2) return;
			join(gate, from);
		} else if (frame?.type === STOP.type) return stop();
		else if (frame?.type === "extension_ui_response" && typeof frame.id === "string") dialogs.delete(frame.id);
		else if (frame?.type === "host_tool_result" && typeof frame.id === "string") toolCalls.delete(frame.id);
		write(line);
	};

	const greet = (socket: Socket): void => {
		if (socket.destroyed) return;
		switch (gate.kind) {
			// `opened` settles only once the gate left `starting`. A stopping omp greets no one; one that exited before it was ready left why in the log.
			case "starting":
			case "stopping":
				return void socket.end();
			case "live": {
				const hello: KeeperHello = { type: HELLO, pid: omp.pid, meta: JSON.parse(meta) };
				socket.write(`${JSON.stringify(hello)}\n${gate.ready}\n`);
				// A client of an omp without protocol 2 sends no `negotiate_protocol`.
				if (gate.protocol === 1) join(gate, socket);
				return;
			}
			default: {
				const unhandled: never = gate;
				return unhandled;
			}
		}
	};

	const server = createServer(socket => {
		const lines = new LineSplitter();
		socket.on("data", (chunk: Buffer) => lines.push(chunk, line => fromClient(socket, line)));
		socket.on("error", () => {});
		socket.on("close", () => drop(socket));
		void opened.promise.then(() => greet(socket));
	});
	const pidFile = pidFileOf(socketPath);
	writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
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
		close();
		// The client hears the end only once nothing omp started runs on.
		await census.reap();
		server.close();
		for (const path of [socketPath, pidFile]) {
			try {
				unlinkSync(path);
			} catch {
				// Already gone.
			}
		}
		const last = gate.kind === "starting" ? null : gate.client;
		if (!last) process.exit(code);
		last.end(() => process.exit(code));
		setTimeout(() => process.exit(code), 1_000).unref();
	});
	process.on("SIGTERM", stop);
}

await main();
