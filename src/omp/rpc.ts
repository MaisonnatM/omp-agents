/** omp's RPC mode: a session this dashboard starts as a child process and drives through omp's own `RpcClient`. */
import { errorText, isObject } from "../json";
import type { Frame } from "./collab";
import { ompCommand } from "./install";
import { type RpcHostTool, type RpcProcess, rpc, rpcFrames, type ServiceTierModel, utils } from "./modules";

/** Subset of omp's `Model` (pi-ai src/types.ts) this app reads. */
export interface RpcModel extends ServiceTierModel {
	id: string;
	name: string;
	contextWindow: number;
}

/** Subset of omp's `RpcSessionState` (src/modes/rpc/rpc-types.ts) this app reads. */
export interface RpcState {
	sessionId: string;
	/** Where the session will write; the file appears with its first message. */
	sessionFile?: string;
	sessionName?: string;
	model?: RpcModel;
	/** omp's `ThinkingLevel`. */
	thinkingLevel?: string;
	/** omp's `ContextUsage`: estimated tokens in the context window. */
	contextUsage?: { tokens: number; contextWindow: number };
	/** Whether `/fast` is on for the model's service-tier family. */
	fastModeEnabled: boolean;
	/** Whether requests actually go out on the priority tier. */
	fastModeActive: boolean;
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
/** omp's `ImageContent`. */
export interface RpcImage {
	type: "image";
	data: string;
	mimeType: string;
}
/** omp's `RestoredQueuedMessage`; `images` is missing when there are none or they exceeded omp's frame limit. */
export interface RpcRestoredMessage {
	text: string;
	images?: RpcImage[];
}
/** Subset of omp's `RpcClient` (src/modes/rpc/rpc-client.ts). */
export interface RpcClient {
	start(): Promise<void>;
	stop(): Promise<void>;
	getState(): Promise<RpcState>;
	prompt(message: string, images?: RpcImage[], streamingBehavior?: "steer" | "followUp"): Promise<string>;
	/** Takes the first queued message with this text out of `queue`; `removed` is false once omp has delivered it. */
	removeQueuedMessage(message: string, queue: "steering" | "followUp"): Promise<{ removed: boolean; images?: RpcImage[] }>;
	/** Moves the first queued follow-up with this text to the end of the steering queue; `promoted` is false once it has gone. */
	promoteQueuedMessage(message: string): Promise<{ promoted: boolean }>;
	abort(): Promise<void>;
	/** Takes back the queued user messages, oldest first, then aborts, as Esc does in omp's terminal. */
	abortAndRestoreQueue(): Promise<{ steering: RpcRestoredMessage[]; followUp: RpcRestoredMessage[] }>;
	getAvailableModels(): Promise<RpcModel[]>;
	setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }>;
	/** Levels the live model accepts, `off` first. */
	getAvailableThinkingLevels(): Promise<string[]>;
	setThinkingLevel(level: string): Promise<void>;
	/** Turns `/fast` on or off; enabling rejects for a model without a priority tier. */
	setFastMode(enabled: boolean): Promise<{ enabled: boolean; active: boolean }>;
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
	/** Messages a running subagent as its user; rejects when it is not running or refuses the message. */
	steerSubagent(subagentId: string, message: string): Promise<void>;
	/** Hard-stops a running subagent; `false` when it was not running. */
	cancelSubagent(subagentId: string): Promise<boolean>;
	/** Runs a user `!` command in the session's directory and records it in the session. */
	bash(command: string): Promise<unknown>;
}

export interface RpcChild {
	client: RpcClient;
	pid: number;
	/** Settles when the process is gone, however it ended. */
	exited: Promise<unknown>;
	/** Write an `extension_ui_response` (or any frame `RpcClient` has no method for) to omp's stdin. */
	write(frame: object): void;
}

/** What a session gets on top of a plain one: extra `omp` arguments, and the tools this process serves it. */
export interface RpcLaunch {
	args: string[];
	tools: RpcHostTool[];
}

export const PLAIN_LAUNCH: RpcLaunch = { args: [], tools: [] };

/** Frames `RpcClient` drops: dialogs, which it hands only to its own login flow, title changes, and built-in slash commands' output and model switches. */
const UNROUTED_FRAMES: Record<string, true> = { extension_ui_request: true, session_info_update: true, command_output: true, config_update: true };

/**
 * Reads a copy of omp's stdout for {@link UNROUTED_FRAMES}, through omp's own JSONL reader and chunk decoder.
 * A listener that throws loses its frame, not the frames that follow it.
 */
async function readUnroutedFrames(stdout: ReadableStream<Uint8Array>, onFrame: (frame: Record<string, unknown>) => void): Promise<void> {
	const decoder = new rpcFrames.RpcFrameDecoder();
	try {
		for await (const line of utils.readJsonl(stdout)) {
			const frame = decoder.push(line);
			if (!isObject(frame) || typeof frame.type !== "string" || !Object.hasOwn(UNROUTED_FRAMES, frame.type)) continue;
			try {
				onFrame(frame);
			} catch (err) {
				console.error(`omp-agents: dropped an omp ${frame.type} frame: ${errorText(err)}`);
			}
		}
	} catch {
		// The client reads the other copy and reports a broken stream.
	}
}

/**
 * Start this same package's CLI in RPC mode (NDJSON over stdio) in `cwd`, through
 * omp's own `RpcClient`. Resolves once omp reports ready. `onFrame` gets every
 * frame of {@link UNROUTED_FRAMES} from spawn on, so a dialog raised while the session opens is not lost.
 */
export async function startRpc(cwd: string, onFrame: (frame: Record<string, unknown>) => void, launch: RpcLaunch): Promise<RpcChild> {
	let child: RpcProcess | undefined;
	const client = new rpc.RpcClient({
		// `rpc-ui` routes tool dialogs such as `ask` over the protocol; under plain `rpc` omp offers no `ask` tool.
		// omp reads the last `--mode`, and `RpcClient` puts `--mode rpc` first.
		args: ["--mode", "rpc-ui", ...launch.args],
		customTools: launch.tools,
		spawn: agentArgs => {
			const proc = utils.ptree.spawn([...ompCommand, ...agentArgs], { cwd, stdin: "pipe" });
			const [forClient, forFrames] = proc.stdout.tee();
			void readUnroutedFrames(forFrames, onFrame);
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
