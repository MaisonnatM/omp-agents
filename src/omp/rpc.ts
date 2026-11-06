/**
 * omp's RPC mode: a session this dashboard starts as an omp process and drives through omp's own `RpcClient`. Each
 * process runs under a keeper (`src/keeper.ts`), so it outlives the server, and the next server attaches to it.
 */
import { errorText, isObject } from "../json";
import { attachKeeper, type KeeperLink, listKeepers, startKeeper } from "../keeper-link";
import type { KeeperMeta } from "../keeper-wire";
import { keepersDir } from "../paths";
import type { Frame } from "./collab";
import { childEnv } from "../proc";
import { ompCommand } from "./install";
import { rpc, rpcFrameFile, rpcFrames, utils } from "./modules";
import type { ServiceTierModel } from "./module-types/models";
import type { RpcHostTool } from "./module-types/rpc-host-tool";

/** Fields read from omp's Goal (pi-tui/tools/goal, exposed by goals/state.ts). */
export interface RpcGoal {
	objective: string;
	status: "active" | "paused" | "budget-limited" | "complete" | "dropped";
	tokensUsed: number;
	tokenBudget?: number;
	timeUsedSeconds: number;
}

export function parseRpcGoal(value: unknown): RpcGoal | null {
	if (!isObject(value) || typeof value.objective !== "string") return null;
	const { status, tokensUsed, tokenBudget, timeUsedSeconds } = value;
	if (status !== "active" && status !== "paused" && status !== "budget-limited" && status !== "complete" && status !== "dropped") return null;
	if (typeof tokensUsed !== "number" || !Number.isFinite(tokensUsed) || typeof timeUsedSeconds !== "number" || !Number.isFinite(timeUsedSeconds)) return null;
	if (tokenBudget !== undefined && (typeof tokenBudget !== "number" || !Number.isFinite(tokenBudget))) return null;
	return { objective: value.objective, status, tokensUsed, ...(tokenBudget === undefined ? {} : { tokenBudget }), timeUsedSeconds };
}

export interface RpcGoalState {
	enabled: boolean;
	mode: "active" | "exiting";
	goal: RpcGoal;
}

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
	autoCompactionEnabled: boolean;
	goal: RpcGoalState | null;
	/** Whether a turn runs. */
	isStreaming: boolean;
	/** Whether omp compacts the context, which a turn's own maintenance does before it goes on. */
	isCompacting: boolean;
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
	/** Resolves with the request id once omp admits the prompt; a builtin slash command, which omp completes itself, gets no {@link onPromptResult}. */
	prompt(message: string, images?: RpcImage[], streamingBehavior?: "steer" | "followUp"): Promise<string>;
	/** Once all the work of an admitted prompt settled: at once when it failed or was cancelled before a turn, else after its turn's terminal `agent_end`. */
	onPromptResult(listener: (result: { id?: string }) => void): () => void;
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
	setAutoCompaction(enabled: boolean): Promise<void>;
	goal(op: "get" | "create" | "pause" | "resume" | "drop", options?: { objective?: string; tokenBudget?: number }): Promise<{ goal: RpcGoal | null; state: RpcGoalState | null }>;
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
	/** Replaces the tools this process serves the session; `start()` sends the ones the client was made with. */
	setCustomTools(tools: RpcHostTool[]): Promise<string[]>;
	/** Runs a user `!` command in the session's directory and records it in the session. */
	bash(command: string): Promise<unknown>;
}

export interface RpcChild {
	client: RpcClient;
	pid: number;
	/** Settles with `exit` when omp is gone, however it ended, or with `detach` once {@link detach} hung up on it. */
	exited: Promise<"detach" | "exit">;
	/** Write an `extension_ui_response` (or any frame `RpcClient` has no method for) to omp's stdin. */
	write(frame: object): void;
	/** When the session started and where omp started, which its keeper hands every server that attaches. */
	meta: KeeperMeta;
	/** Hangs up on omp without stopping it, as the server shuts down; the next server attaches to it again. */
	detach(): void;
}

/** What a session gets on top of a plain one: extra `omp` arguments, and the tools this process serves it. */
export interface RpcLaunch {
	args: string[];
	tools: RpcHostTool[];
}

/** A launch that spawns a fresh omp, which `admit` keeps from spawning in `cwd` by rejecting. An attach to a running omp never asks. */
export interface AdmittedLaunch extends RpcLaunch {
	admit: (cwd: string) => Promise<void>;
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

/** Drives the omp that `link` connects to through omp's own `RpcClient`, which `start()`s on it as on a fresh process. */
async function drive(link: (agentArgs: string[]) => Promise<KeeperLink>, onFrame: (frame: Record<string, unknown>) => void, launch: RpcLaunch): Promise<RpcChild> {
	let linked: KeeperLink | undefined;
	const client = new rpc.RpcClient({
		// On the CLI path, the last mode wins over RpcClient's `rpc`; `rpc-ui` enables tool dialogs.
		args: ["--mode", "rpc-ui", ...launch.args],
		customTools: launch.tools,
		spawn: async agentArgs => {
			linked = await link(agentArgs);
			const [forClient, forFrames] = linked.process.stdout.tee();
			void readUnroutedFrames(forFrames, onFrame);
			return { ...linked.process, stdout: forClient };
		},
	});
	await client.start();
	if (!linked) throw new Error("omp RPC client started without a process");
	const { process: omp, ended, meta, detach } = linked;
	return {
		client,
		pid: omp.pid,
		exited: ended,
		// One line in one write, as `RpcClient` writes its own, so frames never interleave.
		write: frame => void omp.stdin.write(`${JSON.stringify(frame)}\n`),
		meta,
		detach,
	};
}

/**
 * Starts omp's CLI in `cwd` under a keeper for session `instanceId`, through omp's own `RpcClient`, once `launch` admits
 * `cwd`. Resolves once omp reports ready. `onFrame` gets every frame of {@link UNROUTED_FRAMES} from spawn on, so a
 * dialog raised while the session opens is not lost.
 */
export async function startRpc(instanceId: string, cwd: string, onFrame: (frame: Record<string, unknown>) => void, launch: AdmittedLaunch): Promise<RpcChild> {
	await launch.admit(cwd);
	return drive(
		agentArgs => startKeeper(keepersDir, instanceId, { cwd, argv: [...ompCommand, ...agentArgs], env: childEnv(), frameModule: rpcFrameFile, meta: { startedAt: Date.now(), cwd } }),
		onFrame,
		launch,
	);
}

/**
 * Attaches to session `instanceId`, which a previous server started and whose omp still runs. `onFrame` first gets the
 * questions omp still waits on. omp keeps the tools the last server served it until the caller replaces them.
 */
export function attachRpc(instanceId: string, onFrame: (frame: Record<string, unknown>) => void): Promise<RpcChild> {
	return drive(() => attachKeeper(keepersDir, instanceId), onFrame, PLAIN_LAUNCH);
}

/** The instance ids of the sessions a previous server started whose keeper may still run. */
export const keptSessions = (): string[] => listKeepers(keepersDir);
