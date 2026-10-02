/** omp's RPC mode: a session this dashboard starts as a child process and drives through omp's own `RpcClient`. */
import { errorText, isObject } from "../json";
import type { Frame } from "./collab";
import { ompCommand } from "./install";
import { type RpcProcess, rpc, rpcFrames, utils } from "./modules";

/** Subset of omp's `RpcSessionState` (src/modes/rpc/rpc-types.ts) this app reads. */
export interface RpcState {
	sessionId: string;
	/** Where the session will write; the file appears with its first message. */
	sessionFile?: string;
	sessionName?: string;
	model?: { provider: string; id: string };
	/** omp's `ThinkingLevel`. */
	thinkingLevel?: string;
	/** omp's `ContextUsage`: estimated tokens in the context window. */
	contextUsage?: { tokens: number; contextWindow: number };
	/** omp's displayable steering and follow-up queues, as its `queue_update` event reports them. */
	queuedMessages: { steering: string[]; followUp: string[] };
}
/** Subset of omp's `RpcSubagentSnapshot` this app reads. */
export interface RpcSubagent {
	id: string;
	agent: string;
	/** omp's `AgentProgress["status"]`. */
	status: string;
	description?: string;
	sessionFile?: string;
}
/** Subset of omp's `RpcClient` (src/modes/rpc/rpc-client.ts). */
export interface RpcClient {
	start(): Promise<void>;
	stop(): Promise<void>;
	getState(): Promise<RpcState>;
	prompt(message: string, images?: undefined, streamingBehavior?: "steer" | "followUp"): Promise<string>;
	/** Takes the first queued message with this text out of `queue`; `removed` is false once omp has delivered it. */
	removeQueuedMessage(message: string, queue: "steering" | "followUp"): Promise<{ removed: boolean }>;
	abort(): Promise<void>;
	/** omp's `ModelInfo` carries more fields; this app reads the selector parts. */
	getAvailableModels(): Promise<{ provider: string; id: string }[]>;
	setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
	/** Levels the live model accepts, `off` first. */
	getAvailableThinkingLevels(): Promise<string[]>;
	setThinkingLevel(level: string): Promise<void>;
	setSubagentSubscription(level: "progress"): Promise<string>;
	getSubagents(): Promise<RpcSubagent[]>;
	switchSession(sessionPath: string): Promise<{ cancelled: boolean }>;
	/** Moves to a new session file holding the history before the user prompt `entryId`; `text` is that prompt. */
	branch(entryId: string): Promise<{ text: string; cancelled: boolean }>;
	newSession(parentSession?: string): Promise<{ cancelled: boolean }>;
	onSessionEvent(listener: (event: Frame) => void): () => void;
	/** Payloads are the `task:subagent:lifecycle` / `task:subagent:progress` bus payloads. */
	onSubagentLifecycle(listener: (payload: unknown) => void): () => void;
	onSubagentProgress(listener: (payload: unknown) => void): () => void;
}

export interface RpcChild {
	client: RpcClient;
	pid: number;
	/** Settles when the process is gone, however it ended. */
	exited: Promise<unknown>;
	/** Write an `extension_ui_response` (or any frame `RpcClient` has no method for) to omp's stdin. */
	write(frame: object): void;
}

/**
 * omp's `RpcClient` parses `extension_ui_request` frames but hands them only to its own login
 * flow, so this reads a copy of omp's stdout for them, through omp's own JSONL reader and chunk decoder.
 * A listener that throws loses its frame, not the dialogs and cancels that follow it.
 */
async function readUiRequests(stdout: ReadableStream<Uint8Array>, onUiRequest: (frame: Record<string, unknown>) => void): Promise<void> {
	const decoder = new rpcFrames.RpcFrameDecoder();
	try {
		for await (const line of utils.readJsonl(stdout)) {
			const frame = decoder.push(line);
			if (!isObject(frame) || frame.type !== "extension_ui_request") continue;
			try {
				onUiRequest(frame);
			} catch (err) {
				console.error(`omp-agents: dropped an omp dialog: ${errorText(err)}`);
			}
		}
	} catch {
		// The client reads the other copy and reports a broken stream.
	}
}

/**
 * Start this same package's CLI in RPC mode (NDJSON over stdio) in `cwd`, through
 * omp's own `RpcClient`. Resolves once omp reports ready. `onUiRequest` gets every
 * `extension_ui_request` frame from spawn on, so a dialog raised while the session opens is not lost.
 */
export async function startRpc(cwd: string, onUiRequest: (frame: Record<string, unknown>) => void): Promise<RpcChild> {
	let child: RpcProcess | undefined;
	const client = new rpc.RpcClient({
		// `rpc-ui` routes tool dialogs such as `ask` over the protocol; under plain `rpc` omp offers no `ask` tool.
		// omp reads the last `--mode`, and `RpcClient` puts `--mode rpc` first.
		args: ["--mode", "rpc-ui"],
		spawn: agentArgs => {
			const proc = utils.ptree.spawn([...ompCommand, ...agentArgs], { cwd, stdin: "pipe" });
			const [forClient, forDialogs] = proc.stdout.tee();
			void readUiRequests(forDialogs, onUiRequest);
			child = proc;
			// ptree's ChildProcess keeps its state in private fields, so the copy forwards to it rather than inheriting.
			return {
				pid: proc.pid,
				exited: proc.exited,
				stdin: proc.stdin,
				stdout: forClient,
				peekStderr: () => proc.peekStderr(),
				kill: (signal, graceMs) => proc.kill(signal, graceMs),
			};
		},
	});
	await client.start();
	if (!child) throw new Error("omp RPC client started without spawning a process");
	const { stdin } = child;
	return {
		client,
		pid: child.pid,
		// ptree rejects `exited` for a killed child.
		exited: child.exited.catch(() => undefined),
		write: frame => {
			// One synchronous line, as `RpcClient` writes its own, so frames never interleave.
			stdin.write(`${JSON.stringify(frame)}\n`);
			// A failed flush means the process is gone, which `exited` reports.
			Promise.resolve(stdin.flush?.()).catch(() => {});
		},
	};
}
