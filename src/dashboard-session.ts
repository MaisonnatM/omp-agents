/**
 * A session this dashboard started: omp in RPC mode, a child process driven over
 * its stdio. Prompts, Stop, live events, and subagent progress all stay on this
 * machine. Like any session, its transcript is read from its session file.
 */
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { activityOf, contextOf, SUBAGENT_LIFECYCLE, SUBAGENT_PROGRESS } from "./guest";
import { errorText, isObject } from "./json";
import type { LiveSession, LiveUpdate, SessionFacts } from "./live-session";
import { type RpcChild, type RpcClient, type RpcState, startRpc } from "./omp/rpc";
import { endsMidTurn } from "./omp/sessions";
import { displayPath } from "./paths";
import { type AgentRow, type AgentStatus, type ContextUsage, type Delivery, EMPTY_QUEUE, type HostStatus, type MessageQueue, type ModelOption, type RosterHost, type UserAnswer, type UserRequest } from "./shared";
import { PendingRequests, parseRpcRequest, rpcResponse } from "./user-requests";

/** omp's subagent lifecycle and progress statuses, as the roster's agent statuses. */
const RPC_AGENT_STATUSES: Record<string, AgentStatus> = {
	started: "running",
	pending: "running",
	running: "running",
	completed: "idle",
	failed: "aborted",
	aborted: "aborted",
};

interface RpcAgent {
	id: string;
	kind: string;
	status: AgentStatus;
	activity: string | null;
	sessionFile: string | null;
}

export type DashboardUpdate = LiveUpdate | { kind: "exited" };

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
	if (!statSync(header.cwd, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${header.cwd} no longer exists`);
	return header.cwd;
}

/** Session events after which the model, thinking level, or context size can have changed. */
const STATE_EVENTS = new Set(["turn_end", "model_changed", "thinking_level_changed", "auto_compaction_end"]);

const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

export class DashboardSession implements LiveSession {
	readonly instanceId: string;
	readonly startedAt = Date.now();
	readonly cwd: string;
	readonly pid: number;
	sessionId: string;
	sessionFile: string | null;
	sessionName: string | null = null;
	model: string | null = null;
	thinkingLevel: string | null = null;
	/** Levels the current model accepts, `off` first. */
	thinkingLevels: string[] = [];
	context: ContextUsage | null = null;
	/** omp's own queues, from `get_state` and then each `queue_update`. */
	queue: MessageQueue;
	/** Whether a turn runs; {@link status} reports `needs-input` over it while a question waits. */
	#activity: "working" | "idle" = "idle";
	readonly #child: RpcChild;
	readonly #requests: PendingRequests;
	#agents = new Map<string, RpcAgent>();
	readonly #emit: (update: DashboardUpdate) => void;
	#refreshing = false;
	#refreshAgain = false;

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
		this.#emit = emit;
		this.sessionId = state.sessionId;
		this.sessionFile = state.sessionFile ?? null;
		this.#applyState(state);
		this.queue = state.queuedMessages;

		const { client } = child;
		client.onSessionEvent(event => this.#onEvent(event));
		client.onSubagentLifecycle(payload => this.#onSubagent(SUBAGENT_LIFECYCLE, payload));
		client.onSubagentProgress(payload => this.#onSubagent(SUBAGENT_PROGRESS, payload));
		void child.exited.then(() => {
			requests.clear();
			emit({ kind: "exited" });
		});
	}

	/** Spawn omp in `cwd` and wait until it accepts commands. `emit` hears `instanceId` from spawn on, before this resolves. */
	static start(instanceId: string, cwd: string, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		return DashboardSession.#spawn(instanceId, cwd, emit, async () => {});
	}

	/**
	 * Spawn omp holding the history of `sourceFile` before its user prompt `entryId`, as omp's
	 * `/branch` does. omp writes the fork to a new file; `sourceFile` is only read.
	 */
	static async fork(instanceId: string, sourceFile: string, entryId: string, emit: (update: DashboardUpdate) => void): Promise<ForkedSession> {
		// omp would repair such a file in place on open.
		if (await endsMidTurn(sourceFile)) throw new Error("this session ended mid-turn. Resume it in omp once, then fork.");
		let prompt = "";
		const session = await DashboardSession.#spawn(instanceId, await recordedCwd(sourceFile), emit, async client => {
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

	/** Spawn omp holding `sessionFile`, as `omp --resume` does. omp records an abort in a file that ended mid-turn. */
	static async resume(instanceId: string, sessionFile: string, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		return DashboardSession.#spawn(instanceId, await recordedCwd(sessionFile), emit, async client => {
			if ((await client.switchSession(sessionFile)).cancelled) throw new Error("an omp extension cancelled opening the session");
		});
	}

	/** Listens only once `prepare` is done, so the session reports the state `prepare` left it in. Questions count from spawn. */
	static async #spawn(
		instanceId: string,
		cwd: string,
		emit: (update: DashboardUpdate) => void,
		prepare: (client: RpcClient) => Promise<void>,
	): Promise<DashboardSession> {
		const requests = new PendingRequests(() => emit({ kind: "roster" }));
		let session: DashboardSession | undefined;
		const child = await startRpc(cwd, frame => {
			if (frame.type === "session_info_update") {
				if (session) session.#refresh();
				return;
			}
			const change = parseRpcRequest(frame, Date.now());
			if (change?.kind === "add") requests.add(change.request);
			else if (change?.kind === "cancel") requests.remove(change.id);
		});
		try {
			await child.client.setSubagentSubscription("progress");
			await prepare(child.client);
			session = new DashboardSession(instanceId, cwd, child, requests, await child.client.getState(), emit);
			session.thinkingLevels = await child.client.getAvailableThinkingLevels();
			return session;
		} catch (err) {
			// Stop omp before anything else can throw, or the process outlives the failed start.
			await child.client.stop();
			requests.clear();
			throw err;
		}
	}

	row(facts: SessionFacts): RosterHost {
		return {
			source: "dashboard",
			instanceId: this.instanceId,
			pid: this.pid,
			sessionId: this.sessionId,
			sessionName: this.sessionName,
			cwd: this.cwd,
			cwdDisplay: displayPath(this.cwd),
			model: this.model,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: this.thinkingLevels,
			context: this.context,
			startedAt: this.startedAt,
			status: this.status,
			control: { phase: "live", readOnly: false },
			agents: this.agents(),
			...facts,
			requests: this.requests(),
			queue: this.queue,
		};
	}

	transcriptPath(agentId: string | null): string | null {
		return agentId ? this.agentFile(agentId) : this.sessionFile;
	}

	/** A session this dashboard started follows its own process, which reports its exit. */
	follow(): boolean {
		return true;
	}

	dispose(): Promise<void> {
		return this.end();
	}

	get status(): HostStatus {
		return this.#requests.list().length > 0 ? "needs-input" : this.#activity;
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
			// omp's RPC mode has no command that reaches a subagent.
			canMessage: false,
			queue: EMPTY_QUEUE,
		}));
	}

	agentFile(agentId: string): string | null {
		return this.#agents.get(agentId)?.sessionFile ?? null;
	}

	/** omp queues a prompt sent while a turn runs, as a steer or a follow-up, and starts one sent while idle. */
	async prompt(agentId: string | null, text: string, delivery: Delivery): Promise<void> {
		// omp's RPC mode has no command that reaches a subagent. Its prompt runs the session's own slash-command and skill pipeline.
		if (agentId !== null) return;
		await this.#child.client.prompt(text, undefined, delivery).catch((err: unknown) => this.#fail("Prompt failed", err));
	}

	/** Whether omp still held the message; it may have delivered it since the page saw the queue. */
	async dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<boolean> {
		if (agentId !== null) return false;
		try {
			return (await this.#child.client.removeQueuedMessage(text, queue)).removed;
		} catch (err) {
			this.#fail("Dequeue failed", err);
			return false;
		}
	}

	abort(): void {
		this.#child.client.abort().catch((err: unknown) => this.#fail("Stop failed", err));
	}

	async models(): Promise<ModelOption[]> {
		const models = await this.#child.client.getAvailableModels();
		return models.map(({ provider, id }) => ({ provider, id }));
	}

	setModel({ provider, id }: ModelOption): void {
		this.#child.client.setModel(provider, id).then(
			() => this.#refresh(),
			(err: unknown) => this.#fail("Model switch failed", err),
		);
	}

	setThinking(level: string): void {
		if (!this.thinkingLevels.includes(level)) return;
		this.#child.client.setThinkingLevel(level).then(
			() => this.#refresh(),
			(err: unknown) => this.#fail("Thinking level switch failed", err),
		);
	}

	end(): Promise<void> {
		return this.#child.client.stop();
	}

	#fail(what: string, err: unknown): void {
		this.#emit({ kind: "note", agentId: null, level: "error", text: `${what}: ${errorText(err)}` });
	}

	#onEvent(event: unknown): void {
		this.#emit({ kind: "event", event });
		if (!isObject(event)) return;
		if (event.type === "agent_start") this.#setActivity("working");
		// A non-terminal end hands over to a queued follow-up.
		else if (event.type === "agent_end" && event.isTerminal !== false) {
			this.#setActivity("idle");
			this.#refresh();
		} else if (event.type === "queue_update" && isTexts(event.steering) && isTexts(event.followUp)) {
			this.queue = { steering: event.steering, followUp: event.followUp };
			this.#emit({ kind: "roster" });
		} else if (event.type === "message_end" && isObject(event.message) && event.message.role === "user" && this.sessionName === null) {
			// omp's RPC mode titles no prompt itself; a bare `/rename` makes omp title the session from the prompt it now holds.
			this.#child.client.prompt("/rename").catch((err: unknown) => this.#fail("Titling failed", err));
		} else if (typeof event.type === "string" && STATE_EVENTS.has(event.type)) this.#refresh();
	}

	#applyState(state: RpcState): void {
		this.sessionName = state.sessionName ?? this.sessionName;
		this.model = state.model ? `${state.model.provider}/${state.model.id}` : this.model;
		this.thinkingLevel = state.thinkingLevel ?? null;
		this.context = contextOf(state.contextUsage);
	}

	/** Re-read omp's state; a request that arrives mid-read runs once more after it, so the last change always lands. */
	#refresh(): void {
		if (this.#refreshing) {
			this.#refreshAgain = true;
			return;
		}
		this.#refreshing = true;
		const { client } = this.#child;
		Promise.all([client.getState(), client.getAvailableThinkingLevels()])
			.then(
				([state, levels]) => {
					this.#applyState(state);
					this.thinkingLevels = levels;
					this.#emit({ kind: "roster" });
				},
				// The process exited; `exited` reports it.
				() => {},
			)
			.finally(() => {
				this.#refreshing = false;
				if (!this.#refreshAgain) return;
				this.#refreshAgain = false;
				this.#refresh();
			});
	}

	#setActivity(activity: "working" | "idle"): void {
		if (this.#activity === activity) return;
		this.#activity = activity;
		this.#emit({ kind: "roster" });
	}

	#onSubagent(channel: string, payload: unknown): void {
		if (!isObject(payload)) return;
		const body = channel === SUBAGENT_PROGRESS && isObject(payload.progress) ? payload.progress : payload;
		const id = body.id;
		if (typeof id !== "string") return;
		const prev = this.#agents.get(id);
		const status = typeof body.status === "string" ? RPC_AGENT_STATUSES[body.status] : undefined;
		const update = activityOf(channel, payload);
		this.#agents.set(id, {
			id,
			kind: typeof payload.agent === "string" ? payload.agent : (prev?.kind ?? "agent"),
			status: status ?? prev?.status ?? "running",
			activity: update?.activity ?? prev?.activity ?? null,
			sessionFile: typeof payload.sessionFile === "string" ? payload.sessionFile : (prev?.sessionFile ?? null),
		});
		this.#emit({ kind: "roster" });
	}
}
