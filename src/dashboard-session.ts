/**
 * A session this dashboard started: omp in RPC mode, a child process driven over
 * its stdio. Prompts, Stop, live events, and subagent progress all stay on this
 * machine. Like any session, its transcript is read from its session file.
 */
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { errorText, isObject, isTexts } from "./json";
import { type LiveRow, type LiveSession, type LiveUpdate, PromptRefused } from "./live-session";
import { loadOmpConfig } from "./omp/config";
import { connectedProviders, fastAvailable, modelEntries } from "./omp/models";
import { attachRpc, type RpcChild, type RpcClient, type RpcLaunch, type RpcState, startRpc } from "./omp/rpc";
import { endsMidTurn } from "./omp/sessions";
import type { PreparedReplay } from "./replay";
import { launchForReplayResume, readReplayMarker, replayLaunch, requireReplayReady } from "./omp/replay-launch";
import { type ModelEntry, type ModelOption, selectorOf } from "./shared/models";
import { type AgentRow, type AgentStatus, type ContextUsage, type Delivery, EMPTY_QUEUE, type FastMode, type HostStatus, type MessageQueue, type PromptImage, type UserAnswer, type UserRequest, type WithdrawnMessage } from "./shared/sessions";
import { isDashboardPrompt } from "./shared/transcript";
import { PromptTurn } from "./prompt-turn";
import { textOf } from "./session-entries";
import { contextOf, parseSubagentFrame, SUBAGENT_LIFECYCLE, SUBAGENT_PROGRESS } from "./subagents";
import { isUserPrompt, type StartingPrompt, splitSuggestions } from "./transcript";
import { SerialLane } from "./serial-lane";
import { PendingRequests, parseRpcRequest, rpcResponse } from "./user-requests";

interface RpcAgent {
	id: string;
	kind: string;
	status: AgentStatus;
	activity: string | null;
	sessionFile: string | null;
}

export type DashboardUpdate =
	| LiveUpdate
	/** `ended`: {@link DashboardSession.end} stopped it. Otherwise it went down with the dashboard or on its own. */
	| { kind: "exited"; ended: boolean }
	/** omp appended to `path` without the lock churn that the file watcher reports on macOS, as a `!` command's record. */
	| { kind: "written"; path: string }
	/** The session moved to a new file and session id, so its views read that file from now on. */
	| { kind: "switched" }
	/** The main agent's {@link DashboardSession.starting} prompt changed. */
	| { kind: "starting" }
	/** A turn ran to its end, which the queue did not hand to a follow-up; `reply` is its last text without suggested prompts, `null` when it ended on none. */
	| { kind: "turn-ended"; reply: string | null };

/** Same shape as a Collab instance id, so the page's hash routing treats both alike. */
export const newInstanceId = (): string => randomBytes(8).toString("hex");

export interface ForkedSession {
	session: DashboardSession;
	/** Text of the prompt forked at. */
	prompt: string;
}

/** The working directory a session file's header records; omp refuses to open the file from any other. */
async function recordedCwd(sessionFile: string): Promise<string> {
	const head = await Bun.file(sessionFile).slice(0, 1 << 16).text();
	// omp may write a title record ahead of the header.
	const header = head
		.split("\n", 4)
		.map(line => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				return null;
			}
		})
		.find(record => isObject(record) && record.type === "session");
	if (!isObject(header) || typeof header.cwd !== "string") throw new Error("the session file has no readable header");
	if (!(await stat(header.cwd).catch(() => null))?.isDirectory()) throw new Error(`${header.cwd} no longer exists`);
	return header.cwd;
}

/** Session events after which the model, thinking level, or context size can have changed. */
const STATE_EVENTS = new Set(["turn_end", "model_changed", "thinking_level_changed", "auto_compaction_end"]);

/** The text of the last assistant message among `messages` that has any, without its suggested prompts; `null` when none has text. */
function lastReply(messages: unknown): string | null {
	if (!Array.isArray(messages)) return null;
	for (const message of messages.toReversed()) {
		if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content
			.flatMap(block => (isObject(block) && block.type === "text" && typeof block.text === "string" && block.text.trim() ? [block.text] : []))
			.join("\n\n");
		if (text) return splitSuggestions(text).body;
	}
	return null;
}

/** A message taken back from omp's queue, holding only the image fields the composer restores. */
function withdrawn({ text, images = [] }: { text: string; images?: readonly PromptImage[] }): WithdrawnMessage {
	return { text, images: images.map(({ data, mimeType }) => ({ data, mimeType })) };
}

/** How a session reaches its omp, which decides what a failed opening does to it. */
type Opening =
	/** A new omp in `cwd` with `launch`, which a failed opening stops, so no process outlives a failed start. */
	| { kind: "spawn"; cwd: string; launch: RpcLaunch }
	/** The omp a previous server started, which a failed opening leaves running, turn and all, for the next server. */
	| { kind: "attach" };

async function reach(instanceId: string, opening: Opening, onFrame: (frame: Record<string, unknown>) => void): Promise<{ child: RpcChild; abandon: () => Promise<void> }> {
	switch (opening.kind) {
		case "spawn": {
			const child = await startRpc(instanceId, opening.cwd, onFrame, opening.launch);
			return { child, abandon: () => child.client.stop() };
		}
		case "attach": {
			const child = await attachRpc(instanceId, onFrame);
			return { child, abandon: async () => child.detach() };
		}
		default: {
			const unhandled: never = opening;
			return unhandled;
		}
	}
}

export class DashboardSession implements LiveSession {
	readonly instanceId: string;
	readonly startedAt: number;
	/** Where omp works; a `/move` changes it. */
	cwd: string;
	readonly pid: number;
	sessionId: string;
	sessionFile: string | null;
	sessionName: string | null = null;
	model: string | null = null;
	thinkingLevel: string | null = null;
	/** Levels the current model accepts, `off` first. */
	thinkingLevels: string[] = [];
	switching = false;
	#switches = 0;
	/** `null` while the model has no priority tier for `/fast` to turn on. */
	fast: FastMode | null = null;
	context: ContextUsage | null = null;
	/** omp's own queues, from `get_state` and then each `queue_update`. */
	queue: MessageQueue;
	readonly #prompt = new PromptTurn();
	readonly #child: RpcChild;
	readonly #requests: PendingRequests;
	#agents = new Map<string, RpcAgent>();
	readonly #emit: (update: DashboardUpdate) => void;
	/** Whether the last prompt the user sent was a `/` command, whose `command_output` frames the conversation shows. */
	#userCommand = false;
	/** Whether **End session** stopped the process, rather than omp exiting on its own. */
	#ended = false;
	/** Whether the process exited, however it came to. */
	#exited = false;
	/** Whether this server hung up on omp as it shut down, leaving omp to run for the next server. */
	#detached = false;
	/** Prompt, dequeue, promote, interrupt, flush, and edit, so an abort cannot land before the steer it should deliver. */
	readonly #turn = new SerialLane();
	/** Model setters and state reads share a lane, separate from ordered turn commands. */
	readonly #modelLane = new SerialLane();
	#refreshQueued = false;
	/** Whether the automatic `/rename` was sent for this session; one try, so a title omp never makes does not repeat the note. */
	#titled = false;

	private constructor(
		instanceId: string,
		cwd: string,
		child: RpcChild,
		requests: PendingRequests,
		state: RpcState,
		emit: (update: DashboardUpdate) => void,
	) {
		this.instanceId = instanceId;
		this.cwd = cwd;
		this.#child = child;
		this.#requests = requests;
		this.pid = child.pid;
		this.startedAt = child.meta.startedAt;
		this.#emit = emit;
		this.sessionId = state.sessionId;
		this.sessionFile = state.sessionFile ?? null;
		this.#applyState(state);
		this.queue = state.queuedMessages;
		// A session this server attached to may be in a turn an earlier server started: streaming, compacting, or waiting
		// on a background job, whose result goes on with the turn and ends it with the terminal `agent_end`.
		if (state.isStreaming || state.isCompacting || state.hasPendingAsyncWork) this.#prompt.turnStarted();

		const { client } = child;
		client.onSessionEvent(event => this.#onEvent(event));
		client.onPromptResult(({ id }) => {
			if (id === undefined) return;
			if (this.#replayInitial === "running") this.#replayInitial = null;
			this.#change(() => this.#prompt.result(id));
		});
		client.onSubagentLifecycle(payload => this.#onSubagent(SUBAGENT_LIFECYCLE, payload));
		client.onSubagentProgress(payload => this.#onSubagent(SUBAGENT_PROGRESS, payload));
		void child.exited.then(() => {
			this.#exited = true;
			if (this.#detached) return;
			this.#change(() => this.#prompt.release());
			requests.clear();
			emit({ kind: "exited", ended: this.#ended });
		});
	}

	#replayInitial: "unsent" | "running" | null = null;
	#replayExpected: PreparedReplay["first"] | null = null;
	#protectedReplay = false;

	/** Spawn omp in `cwd` with `launch`, on `model` and at `thinking` when they name one, and wait until it accepts commands. `emit` hears `instanceId` from spawn on, before this resolves. */
	static start(
		instanceId: string,
		cwd: string,
		model: ModelOption | null,
		thinking: string | null,
		launch: RpcLaunch,
		emit: (update: DashboardUpdate) => void,
	): Promise<DashboardSession> {
		return DashboardSession.#spawn(instanceId, cwd, launch, emit, async client => {
			if (model) await client.setModel(model.provider, model.id);
			if (thinking) {
				const levels = await client.getAvailableThinkingLevels();
				if (!levels.includes(thinking)) throw new Error(`This model does not support thinking level ${thinking}.`);
				await client.setThinkingLevel(thinking);
			}
		});
	}

	static async replay(instanceId: string, prepared: PreparedReplay, launch: RpcLaunch, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		const launchWithGuard = replayLaunch(prepared.config, launch);
		const session = await DashboardSession.#spawn(instanceId, prepared.cwd, launchWithGuard, emit, async client => {
			if ((await client.switchSession(prepared.forkFile)).cancelled) throw new Error("An omp extension cancelled opening the replay.");
			await client.setModel(prepared.marker.model.provider, prepared.marker.model.id);
			if (prepared.marker.thinking) {
				const levels = await client.getAvailableThinkingLevels();
				if (!levels.includes(prepared.marker.thinking)) throw new Error(`This model does not support thinking level ${prepared.marker.thinking}.`);
				await client.setThinkingLevel(prepared.marker.thinking);
			}
			await requireReplayReady(prepared.forkFile, prepared.marker.id, launchWithGuard.readyToken);
		});
		session.#replayInitial = "unsent";
		session.#replayExpected = prepared.first;
		session.#protectedReplay = true;
		return session;
	}

	/**
	 * Spawn omp with `launch` holding the history of `sourceFile` before its user prompt `entryId`, as omp's
	 * `/branch` does. omp writes the fork to a new file; `sourceFile` is only read.
	 */
	static async fork(instanceId: string, sourceFile: string, entryId: string, launch: RpcLaunch, emit: (update: DashboardUpdate) => void): Promise<ForkedSession> {
		// omp would repair such a file in place on open.
		if (await endsMidTurn(sourceFile)) throw new Error("this session ended mid-turn. Resume it in omp once, then fork.");
		let prompt = "";
		const session = await DashboardSession.#spawn(instanceId, await recordedCwd(sourceFile), launch, emit, async client => {
			if ((await client.switchSession(sourceFile)).cancelled) throw new Error("an omp extension cancelled opening the session");
			try {
				const branched = await client.branch(entryId);
				if (branched.cancelled) throw new Error("an omp extension cancelled the branch");
				prompt = branched.text;
			} catch (err) {
				// omp records its exit in the session it holds, so leave the source before stopping.
				await client.newSession().catch(() => {});
				throw err;
			}
		});
		return { session, prompt };
	}

	/** Spawn omp with `launch` holding `sessionFile`, as `omp --resume` does. omp records an abort in a file that ended mid-turn. */
	static async resume(instanceId: string, sessionFile: string, launch: RpcLaunch, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		const replay = await launchForReplayResume(sessionFile, launch);
		const session = await DashboardSession.#spawn(instanceId, await recordedCwd(sessionFile), replay.launch, emit, async client => {
			if ((await client.switchSession(sessionFile)).cancelled) throw new Error("an omp extension cancelled opening the session");
			if (replay.marker) await requireReplayReady(sessionFile, replay.marker.id, replay.launch.readyToken);
		});
		session.#protectedReplay = replay.marker !== null;
		return session;
	}

	/**
	 * Attach to session `instanceId`, whose omp a previous server started and left running, as it stands now: in the
	 * middle of a turn, with its questions and its subagents. `toolsFor` names the tools this server serves the session.
	 */
	static async reattach(instanceId: string, toolsFor: (sessionId: string) => RpcLaunch["tools"], emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		let protectedReplay = false;
		const session = await DashboardSession.#open(instanceId, emit, { kind: "attach" }, async child => {
			const { sessionId, sessionFile } = await child.client.getState();
			const tools = toolsFor(sessionId);
			if (tools.length > 0) await child.client.setCustomTools(tools);
			// omp runs already, so its session file decides only how this server shows it, never whether it runs.
			if (!sessionFile || !(await stat(sessionFile).catch(() => null))) return child.meta.cwd;
			// A marker that cannot be read holds prompts back as a replay's would.
			protectedReplay = (await readReplayMarker(sessionFile).catch(() => "unreadable")) !== null;
			return recordedCwd(sessionFile).catch(() => child.meta.cwd);
		});
		session.#protectedReplay = protectedReplay;
		// Whether a running turn is a replay's first one is not known here, so it holds prompts back as the first one would.
		if (protectedReplay && session.#prompt.running) session.#replayInitial = "running";
		return session;
	}

	/** Listens only once `prepare` is done, so the session reports the state `prepare` left it in. Questions count from spawn. */
	static #spawn(
		instanceId: string,
		cwd: string,
		launch: RpcLaunch,
		emit: (update: DashboardUpdate) => void,
		prepare: (client: RpcClient) => Promise<void>,
	): Promise<DashboardSession> {
		return DashboardSession.#open(instanceId, emit, { kind: "spawn", cwd, launch }, async child => {
			await prepare(child.client);
			return cwd;
		});
	}

	/** Opens the session on the omp `opening` reaches, once `prepare` readied it and named the directory it works in. */
	static async #open(
		instanceId: string,
		emit: (update: DashboardUpdate) => void,
		opening: Opening,
		prepare: (child: RpcChild) => Promise<string>,
	): Promise<DashboardSession> {
		const requests = new PendingRequests(() => emit({ kind: "roster" }));
		let session: DashboardSession | undefined;
		const onFrame = (frame: Record<string, unknown>): void => {
			if (frame.type === "session_info_update" || frame.type === "config_update") {
				if (session) session.#refresh();
				return;
			}
			if (frame.type === "command_output") {
				// The bare `/rename` that titles a session prints too; only a command the user typed shows its output.
				if (session && session.#userCommand && typeof frame.text === "string") emit({ kind: "note", agentId: null, level: "info", text: frame.text });
				return;
			}
			const change = parseRpcRequest(frame, Date.now());
			if (change?.kind === "add") requests.add(change.request);
			else if (change?.kind === "cancel") requests.remove(change.id);
		};
		const { child, abandon } = await reach(instanceId, opening, onFrame);
		try {
			await child.client.setSubagentSubscription("progress");
			const cwd = await prepare(child);
			session = new DashboardSession(instanceId, cwd, child, requests, await child.client.getState(), emit);
			session.thinkingLevels = await child.client.getAvailableThinkingLevels();
			// omp's snapshot has the fields of a lifecycle frame.
			for (const agent of await child.client.getSubagents()) session.#onSubagent(SUBAGENT_LIFECYCLE, agent);
			return session;
		} catch (err) {
			await abandon();
			requests.clear();
			throw err;
		}
	}

	row(): LiveRow {
		return {
			source: "dashboard",
			instanceId: this.instanceId,
			pid: this.pid,
			sessionId: this.sessionId,
			sessionName: this.sessionName,
			cwd: this.cwd,
			model: this.model,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: this.thinkingLevels,
			switching: this.switching,
			fast: this.fast,
			context: this.context,
			startedAt: this.startedAt,
			status: this.status,
			control: { phase: "live", readOnly: false },
			agents: this.agents(),
			requests: this.requests(),
			queue: this.queue,
		};
	}

	transcriptPath(agentId: string | null): string | null {
		return agentId ? this.agentFile(agentId) : this.sessionFile;
	}

	/** A session this dashboard started follows its own process, which reports its exit, so the registry tells it nothing. */
	follow(): void {}

	/** Once its process exited. That reports itself ({@link DashboardUpdate} `exited`), so this catches only a session that exited before it was listed. */
	finished(): boolean {
		return this.#exited;
	}

	/** omp keeps running, turn and all, and the next server attaches to it again ({@link reattach}). */
	async dispose(): Promise<void> {
		this.#detached = true;
		this.#child.detach();
	}

	/** `working` from the ack of a prompt sent while idle, through its turn; `needs-input` over that while a question waits. */
	get status(): HostStatus {
		if (this.#requests.list().length > 0) return "needs-input";
		return this.#prompt.busy ? "working" : "idle";
	}

	/**
	 * The prompt omp admitted while the main agent was idle, from its ack until its turn shows it as a live user message,
	 * its `prompt_result` comes, or a stop, a switch to another file, or the exit ends it.
	 */
	get starting(): StartingPrompt | null {
		return this.#prompt.starting;
	}

	requests(): UserRequest[] {
		return this.#requests.list();
	}

	/** Reply to a pending question; an answer the question cannot take, or one for a question already gone, is dropped. */
	answer(requestId: string, answer: UserAnswer): void {
		if (!this.#requests.take(requestId, answer)) return;
		try {
			this.#child.write(rpcResponse(requestId, answer));
		} catch (err) {
			this.#fail("Answer failed", err);
		}
	}

	agents(): AgentRow[] {
		return [...this.#agents.values()].map(agent => ({
			id: agent.id,
			kind: agent.kind,
			parentId: null,
			status: agent.status,
			activity: agent.activity,
			// omp's `steer_subagent` reaches only a running subagent.
			canMessage: agent.status === "running",
			queue: EMPTY_QUEUE,
		}));
	}

	agentFile(agentId: string): string | null {
		return this.#agents.get(agentId)?.sessionFile ?? null;
	}

	/**
	 * omp queues a prompt sent while a turn runs, as a steer or a follow-up, and starts one sent while idle. Its prompt runs
	 * the session's own slash-command and skill pipeline. A subagent takes every message as a steer: omp reaches only a
	 * running one, so a follow-up held until it stopped could never be sent. A message omp refuses is shown as a note and
	 * rejects with {@link PromptRefused}.
	 */
	async prompt(agentId: string | null, text: string, images: PromptImage[], delivery: Delivery): Promise<void> {
		if (this.#protectedReplay && agentId !== null) throw new PromptRefused("Subagent prompts are blocked in a replay.");
		if (this.#protectedReplay && /^\/(?!skill:)/.test(text.trimStart())) throw new PromptRefused("Local slash commands are blocked in a replay. Use text, !<command>, or /skill:<name>.");
		if (this.#replayInitial === "running") throw new PromptRefused("Wait for the first replay turn to finish before continuing.");
		if (this.#replayInitial === "unsent") {
			const expected = this.#replayExpected;
			if (!expected || text !== expected.text || images.length !== expected.images.length || images.some((image, index) => image.mimeType !== expected.images[index]?.mimeType || image.data !== expected.images[index]?.data)) throw new PromptRefused("Wait for the selected first replay prompt to be sent before continuing.");
			this.#replayInitial = "running";
			this.#replayExpected = null;
		}
		if (agentId !== null && images.length > 0) throw new Error("omp sends a subagent text only.");
		if (agentId === null && text.startsWith("!")) {
			if (images.length > 0) throw new Error("A ! command takes no images.");
			return this.#shell(text);
		}
		const sent =
			agentId !== null
				? this.#noting("Message failed", () => this.#child.client.steerSubagent(agentId, text), agentId)
				: this.#noting("Prompt failed", () => this.#send(text, images, delivery));
		await sent.catch((err: unknown) => {
			this.#replayInitial = null;
			throw new PromptRefused(errorText(err));
		});
	}

	/** Sends `text` and `images` to the main agent through the turn gate; rejects when omp does not take them. */
	async #send(text: string, images: PromptImage[], delivery: Delivery): Promise<void> {
		await this.#turn.run(() => this.#promptMain(text, images, delivery));
	}

	/**
	 * Prompts the main agent, and holds a prompt omp admitted while idle as {@link starting}. omp completes a builtin slash
	 * command itself without a turn or a `prompt_result`, so only a `/skill:` prompt among `/` prompts is held.
	 */
	async #promptMain(text: string, images: PromptImage[], delivery?: Delivery): Promise<void> {
		this.#userCommand = text.startsWith("/");
		const pending = this.#prompt.send();
		const content = images.map(image => ({ type: "image" as const, ...image }));
		const id = await this.#child.client.prompt(text, content.length > 0 ? content : undefined, delivery).finally(() => pending.close());
		const local = text.startsWith("/") && !text.startsWith("/skill:");
		this.#change(() => pending.acked(id && !local ? { id, text, images } : null));
	}

	/** A `!` command, which omp runs in the session's directory and records in its file for the agent to see. */
	async #shell(text: string): Promise<void> {
		if (text.startsWith("!!")) throw new Error("omp's RPC mode cannot keep a command's output out of context. Use ! or the omp terminal.");
		// omp writes a fresh session's file only with its first reply, so a command run before it would show nowhere.
		if (!this.sessionFile || !(await stat(this.sessionFile).catch(() => null))) {
			throw new Error("omp saves this session with its first reply. Send a prompt before a ! command.");
		}
		const command = text.slice(1).trim();
		if (!command) throw new Error("! needs a command.");
		const file = this.sessionFile;
		await this.#child.client.bash(command).then(
			() => this.#emit({ kind: "written", path: file }),
			(err: unknown) => this.#fail("Shell command failed", err),
		);
	}

	async dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<WithdrawnMessage | null> {
		return this.#turn.run(async () => {
			if (agentId !== null) return null;
			try {
				const { removed, images = [] } = await this.#child.client.removeQueuedMessage(text, queue);
				return removed ? withdrawn({ text, images }) : null;
			} catch (err) {
				this.#fail("Dequeue failed", err);
				return null;
			}
		});
	}

	async promote(agentId: string | null, text: string): Promise<boolean> {
		return this.#turn.run(async () => {
			if (agentId !== null) return false;
			try {
				return (await this.#child.client.promoteQueuedMessage(text)).promoted;
			} catch (err) {
				this.#fail("Send now failed", err);
				return false;
			}
		});
	}

	async interrupt(): Promise<WithdrawnMessage[]> {
		return this.#turn.run(() =>
			this.#noting("Stop failed", async () => {
				const mark = this.#prompt.interrupt();
				const { steering, followUp } = await this.#child.client.abortAndRestoreQueue();
				this.#change(() => this.#prompt.release());
				// omp's restore leaves out a prompt it admitted but never ran, so the composer gets it back from here.
				return [...mark.unsent(), ...steering, ...followUp].map(withdrawn);
			}),
		);
	}

	/** omp's queue as it stands now, not as the page last saw it: the turn may already have taken the steer. */
	flush(): void {
		void this.#turn
			.run(async () => {
				const { queuedMessages } = await this.#child.client.getState();
				if (queuedMessages.steering.length > 0) await this.#child.client.abort();
			})
			.catch((err: unknown) => this.#fail("Send now failed", err));
	}

	/**
	 * Replace user prompt `entryId` with `text` in this same process, as omp's `/branch` then a prompt does. A running
	 * turn stops first. omp moves the session to a new file holding the history before that prompt; the old file stays.
	 */
	async editPrompt(entryId: string, text: string): Promise<void> {
		if (this.#replayInitial !== null) throw new PromptRefused("Wait for the first replay turn to finish before editing its history.");
		if (this.#protectedReplay && /^\/(?!skill:)/.test(text.trimStart())) throw new PromptRefused("Local slash commands are blocked in a replay. Use text, !<command>, or /skill:<name>.");
		const { client } = this.#child;
		await this.#noting("Edit failed", () =>
			this.#turn.run(async () => {
				if (text.startsWith("!")) throw new Error("an edited prompt cannot be a ! command");
				if (this.#prompt.busy) {
					await client.abort();
					this.#change(() => this.#prompt.release());
				}
				if ((await client.branch(entryId)).cancelled) throw new Error("an omp extension cancelled the branch");
				const state = await client.getState();
				// omp keeps the directory on a branch, and writes a branch from the first prompt only with its reply.
				await this.#follow(state, this.cwd);
				this.queue = state.queuedMessages;
				this.#applyState(state);
				this.#emit({ kind: "switched" });
				await this.#promptMain(text, []);
			}),
		);
	}

	async cancelAgent(agentId: string): Promise<void> {
		if (this.#agents.get(agentId)?.status !== "running") return;
		await this.#noting("Cancel failed", () => this.#child.client.cancelSubagent(agentId), agentId);
	}

	/** The models omp offers this session, from the providers you are connected to. */
	async models(): Promise<ModelEntry[]> {
		const [models, connected, config] = await Promise.all([this.#child.client.getAvailableModels(), connectedProviders(), loadOmpConfig(this.cwd)]);
		return modelEntries(models, config, connected);
	}

	/** Switches serialize with state reads; the flag is set before queuing so the page can show progress immediately. Rejects when omp refuses the switch. */
	setModel({ provider, id }: ModelOption, thinking: string | null): Promise<void> {
		if (this.#replayInitial !== null) return Promise.reject(new PromptRefused("Wait for the first replay turn to finish before changing its model."));
		this.switching = ++this.#switches > 0;
		this.thinkingLevels = [];
		this.#emit({ kind: "roster" });
		return this.#modelLane.run(async () => {
			const { client } = this.#child;
			try {
				await client.setModel(provider, id);
				if (thinking) await client.setThinkingLevel(thinking);
			} catch (err) {
				this.#fail("Model switch failed", err);
				throw err;
			} finally {
				await this.#readModelState("Model state refresh failed");
				this.switching = --this.#switches > 0;
				this.#emit({ kind: "roster" });
			}
		});
	}

	setThinking(level: string): Promise<void> {
		if (this.#replayInitial !== null) return Promise.reject(new PromptRefused("Wait for the first replay turn to finish before changing its thinking level."));
		return this.#modelLane.run(async () => {
			if (!this.thinkingLevels.includes(level)) return;
			await this.#noting("Thinking level switch failed", async () => {
				const levels = await this.#child.client.getAvailableThinkingLevels();
				if (!levels.includes(level)) return;
				await this.#child.client.setThinkingLevel(level);
			}).finally(() => this.#readModelState("Model state refresh failed"));
		});
	}

	setFast(enabled: boolean): Promise<void> {
		return this.#modelLane.run(async () => {
			await this.#noting("Fast mode switch failed", () => this.#child.client.setFastMode(enabled)).finally(() => this.#readModelState("Model state refresh failed"));
		});
	}

	end(): Promise<void> {
		this.#ended = true;
		return this.#child.client.stop();
	}

	#fail(what: string, err: unknown, agentId: string | null = null): void {
		this.#emit({ kind: "note", agentId, level: "error", text: `${what}: ${errorText(err)}` });
	}

	/** Runs `work`, and shows its failure as an error note before rejecting with it. */
	async #noting<T>(what: string, work: () => Promise<T>, agentId: string | null = null): Promise<T> {
		try {
			return await work();
		} catch (err) {
			this.#fail(what, err, agentId);
			throw err;
		}
	}

	#onEvent(event: unknown): void {
		this.#emit({ kind: "event", event });
		if (!isObject(event)) return;
		if ((event.type === "message_start" || event.type === "message_end") && isObject(event.message) && isUserPrompt(event.message)) {
			this.#change(() => this.#prompt.shown());
		}
		if (event.type === "agent_start") {
			this.#change(() => this.#prompt.turnStarted());
		} else if (event.type === "agent_end" && event.isTerminal !== false) {
			this.#replayInitial = null;
			// A non-terminal end hands over to a queued follow-up.
			this.#change(() => this.#prompt.turnEnded());
			this.#refresh();
			this.#emit({ kind: "turn-ended", reply: lastReply(event.messages) });
		} else if (event.type === "queue_update" && isTexts(event.steering) && isTexts(event.followUp)) {
			this.queue = { steering: event.steering, followUp: event.followUp };
			this.#emit({ kind: "roster" });
		} else if (
			event.type === "message_end" && isObject(event.message) && isUserPrompt(event.message) && !isDashboardPrompt(textOf(event.message.content)) && this.sessionName === null && !this.#titled
		) {
			// omp's RPC mode titles no prompt itself; a bare `/rename` makes omp title the session from the prompt it now holds.
			// A prompt the dashboard sent waits for the user's own, which the title should name.
			// A `/skill:` prompt is a custom message, not a user one, and omp's title context reads it as the user's prompt.
			// Through the turn gate, `/rename` can land after the turn's last state event, so read the title it made here.
			this.#titled = true;
			void this.#turn
				.run(() => this.#child.client.prompt("/rename"))
				.then(() => this.#refresh())
				.catch((err: unknown) => this.#fail("Titling failed", err));
		} else if (typeof event.type === "string" && STATE_EVENTS.has(event.type)) this.#refresh();
	}

	#applyState(state: RpcState): void {
		this.sessionName = state.sessionName ?? this.sessionName;
		this.model = state.model ? selectorOf(state.model) : this.model;
		this.thinkingLevel = state.thinkingLevel ?? null;
		this.context = contextOf(state.contextUsage);
		this.fast = state.model && fastAvailable(state.model) ? { enabled: state.fastModeEnabled, active: state.fastModeActive } : null;
	}

	/** Coalesce bursts while one read waits, without letting a read overtake a model setter. */
	#refresh(): void {
		if (this.#refreshQueued) return;
		this.#refreshQueued = true;
		void this.#modelLane.run(() => {
			this.#refreshQueued = false;
			// A failure means the process exited; `exited` reports it.
			return this.#readModelState(null);
		});
	}

	async #readModelState(failure: string | null): Promise<void> {
		try {
			const [state, levels] = await Promise.all([this.#child.client.getState(), this.#child.client.getAvailableThinkingLevels()]);
			const moved = await this.#follow(state);
			this.#applyState(state);
			this.thinkingLevels = levels;
			if (moved) this.#change(() => this.#prompt.release());
			this.#emit({ kind: moved ? "switched" : "roster" });
		} catch (err) {
			if (failure) this.#fail(failure, err);
		}
	}

	/**
	 * Whether omp now holds another file, as after `/move` or a branch; the session then works where that file's header
	 * says, or in `cwd` when the caller knows it.
	 */
	async #follow(state: RpcState, cwd?: string): Promise<boolean> {
		const file = state.sessionFile ?? null;
		if (file === this.sessionFile) return false;
		if (cwd === undefined) {
			// omp writes a moved session with no reply yet only with that reply, so the session follows on a later read.
			if (file && !(await stat(file).catch(() => null))) return false;
			cwd = file ? await recordedCwd(file) : this.cwd;
		}
		this.sessionFile = file;
		this.cwd = cwd;
		if (state.sessionId !== this.sessionId) {
			this.sessionId = state.sessionId;
			this.#titled = false;
			this.#agents.clear();
		}
		return true;
	}

	/** Runs a {@link PromptTurn} transition, then tells the page what it changed. */
	#change(transition: () => void): void {
		const status = this.status;
		const starting = this.#prompt.starting;
		transition();
		if (this.#prompt.starting !== starting) this.#emit({ kind: "starting" });
		if (this.status !== status) this.#emit({ kind: "roster" });
	}

	#onSubagent(channel: string, payload: unknown): void {
		const frame = parseSubagentFrame(channel, payload);
		if (!frame) return;
		const prev = this.#agents.get(frame.id);
		this.#agents.set(frame.id, {
			id: frame.id,
			kind: frame.kind ?? prev?.kind ?? "agent",
			status: frame.status ?? prev?.status ?? "running",
			activity: frame.activity ?? prev?.activity ?? null,
			sessionFile: frame.sessionFile ?? prev?.sessionFile ?? null,
		});
		this.#emit({ kind: "roster" });
	}
}
