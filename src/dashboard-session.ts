/**
 * A session this dashboard started: omp in RPC mode, a child process driven over
 * its stdio. Prompts, Stop, live events, and subagent progress all stay on this
 * machine. Like any session, its transcript is read from its session file.
 */
import { randomBytes } from "node:crypto";
import { activityOf, contextOf, type LiveUpdate, SUBAGENT_LIFECYCLE, SUBAGENT_PROGRESS } from "./guest";
import { type RpcChild, type RpcState, startRpc } from "./omp";
import type { AgentRow, AgentStatus, ContextUsage, HostStatus, ModelOption } from "./shared";
import { isObject } from "./transcript";

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

/** Session events after which the model, thinking level, or context size can have changed. */
const STATE_EVENTS = new Set(["turn_end", "model_changed", "thinking_level_changed", "auto_compaction_end"]);

export class DashboardSession {
	/** Same shape as a Collab instance id, so the page's hash routing treats both alike. */
	readonly instanceId = randomBytes(8).toString("hex");
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
	status: HostStatus = "idle";
	readonly #child: RpcChild;
	#agents = new Map<string, RpcAgent>();
	readonly #emit: (update: DashboardUpdate) => void;
	#refreshing = false;
	#refreshAgain = false;

	private constructor(cwd: string, child: RpcChild, state: RpcState, emit: (update: DashboardUpdate) => void) {
		this.cwd = cwd;
		this.#child = child;
		this.pid = child.pid;
		this.#emit = emit;
		this.sessionId = state.sessionId;
		this.sessionFile = state.sessionFile ?? null;
		this.#applyState(state);

		const { client } = child;
		client.onSessionEvent(event => this.#onEvent(event));
		client.onSubagentLifecycle(payload => this.#onSubagent(SUBAGENT_LIFECYCLE, payload));
		client.onSubagentProgress(payload => this.#onSubagent(SUBAGENT_PROGRESS, payload));
		void child.exited.then(() => emit({ kind: "exited" }));
	}

	/** Spawn omp in `cwd` and wait until it accepts commands. */
	static async start(cwd: string, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		const child = await startRpc(cwd);
		try {
			await child.client.setSubagentSubscription("progress");
			const session = new DashboardSession(cwd, child, await child.client.getState(), emit);
			session.thinkingLevels = await child.client.getAvailableThinkingLevels();
			return session;
		} catch (err) {
			await child.client.stop();
			throw err;
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
		}));
	}

	agentFile(agentId: string): string | null {
		return this.#agents.get(agentId)?.sessionFile ?? null;
	}

	/** A prompt sent while a turn runs waits for it to end, as omp's own queue does. */
	prompt(text: string): void {
		this.#child.client.prompt(text, undefined, "followUp").catch((err: unknown) => this.#fail("Prompt failed", err));
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

	setThinkingLevel(level: string): void {
		this.#child.client.setThinkingLevel(level).then(
			() => this.#refresh(),
			(err: unknown) => this.#fail("Thinking level switch failed", err),
		);
	}

	end(): Promise<void> {
		return this.#child.client.stop();
	}

	#fail(what: string, err: unknown): void {
		this.#emit({ kind: "note", agentId: null, level: "error", text: `${what}: ${err instanceof Error ? err.message : String(err)}` });
	}

	#onEvent(event: unknown): void {
		this.#emit({ kind: "event", event });
		if (!isObject(event)) return;
		if (event.type === "agent_start") this.#setStatus("working");
		// A non-terminal end hands over to a queued follow-up.
		else if (event.type === "agent_end" && event.isTerminal !== false) {
			this.#setStatus("idle");
			this.#refresh();
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

	#setStatus(status: HostStatus): void {
		if (this.status === status) return;
		this.status = status;
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
