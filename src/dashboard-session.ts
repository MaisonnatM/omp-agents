/**
 * A session this dashboard started: omp in RPC mode, a child process driven over
 * its stdio. Prompts, Stop, live events, and subagent progress all stay on this
 * machine. Like any session, its transcript is read from its session file.
 */
import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import { activityOf, type LiveUpdate, SUBAGENT_LIFECYCLE, SUBAGENT_PROGRESS } from "./guest";
import { endsMidTurn, type RpcChild, type RpcClient, type RpcState, startRpc } from "./omp";
import type { AgentRow, AgentStatus, HostStatus, ModelOption } from "./shared";
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

export class DashboardSession {
	/** Same shape as a Collab instance id, so the page's hash routing treats both alike. */
	readonly instanceId = randomBytes(8).toString("hex");
	readonly startedAt = Date.now();
	readonly cwd: string;
	readonly pid: number;
	sessionId: string;
	sessionFile: string | null;
	sessionName: string | null;
	model: string | null;
	status: HostStatus = "idle";
	readonly #child: RpcChild;
	#agents = new Map<string, RpcAgent>();
	readonly #emit: (update: DashboardUpdate) => void;

	private constructor(cwd: string, child: RpcChild, state: RpcState, emit: (update: DashboardUpdate) => void) {
		this.cwd = cwd;
		this.#child = child;
		this.pid = child.pid;
		this.#emit = emit;
		this.sessionId = state.sessionId;
		this.sessionFile = state.sessionFile ?? null;
		this.sessionName = state.sessionName ?? null;
		this.model = state.model ? `${state.model.provider}/${state.model.id}` : null;

		const { client } = child;
		client.onSessionEvent(event => this.#onEvent(event));
		client.onSubagentLifecycle(payload => this.#onSubagent(SUBAGENT_LIFECYCLE, payload));
		client.onSubagentProgress(payload => this.#onSubagent(SUBAGENT_PROGRESS, payload));
		void child.exited.then(() => emit({ kind: "exited" }));
	}

	/** Spawn omp in `cwd` and wait until it accepts commands. */
	static start(cwd: string, emit: (update: DashboardUpdate) => void): Promise<DashboardSession> {
		return DashboardSession.#spawn(cwd, emit, async () => {});
	}

	/**
	 * Spawn omp holding the history of `sourceFile` before its user prompt `entryId`, as omp's
	 * `/branch` does. omp writes the fork to a new file; `sourceFile` is only read.
	 */
	static async fork(sourceFile: string, entryId: string, emit: (update: DashboardUpdate) => void): Promise<ForkedSession> {
		// omp would repair such a file in place on open.
		if (await endsMidTurn(sourceFile)) throw new Error("this session ended mid-turn. Resume it in omp once, then fork.");
		let prompt = "";
		const session = await DashboardSession.#spawn(await recordedCwd(sourceFile), emit, async client => {
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

	/** Listens only once `prepare` is done, so the session reports the state `prepare` left it in. */
	static async #spawn(
		cwd: string,
		emit: (update: DashboardUpdate) => void,
		prepare: (client: RpcClient) => Promise<void>,
	): Promise<DashboardSession> {
		const child = await startRpc(cwd);
		try {
			await child.client.setSubagentSubscription("progress");
			await prepare(child.client);
			return new DashboardSession(cwd, child, await child.client.getState(), emit);
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
			model => {
				this.model = `${model.provider}/${model.id}`;
				this.#emit({ kind: "roster" });
			},
			(err: unknown) => this.#fail("Model switch failed", err),
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
			void this.#child.client.getState().then(
				state => {
					this.sessionName = state.sessionName ?? this.sessionName;
					this.model = state.model ? `${state.model.provider}/${state.model.id}` : this.model;
					this.#emit({ kind: "roster" });
				},
				() => {},
			);
		}
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
