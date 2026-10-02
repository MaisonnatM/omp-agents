/**
 * One server-side collab guest per terminal session. It joins the host's room
 * through omp's own relay client for what only the room offers: prompting and
 * stopping the session, messaging its subagents, the host's live subagent
 * registry, and live agent events. Transcripts never wait on it; they are read
 * from the session files, so the welcome snapshot the host sends is ignored.
 */
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expandPrompt } from "./commands";
import { errorText, isObject, nonEmptyStr } from "./json";
import type { LiveSession, LiveUpdate } from "./live-session";
import { COLLAB_PROTO, type CollabSocket, type Frame, type HostSnapshot, linkErrorCode, openRoom, type Room } from "./omp/collab";
import { displayPath } from "./paths";
import type { AgentRow, AgentStatus, ContextUsage, ControlPhase, Delivery, HostStatus, LinkedPullRequest, MessageQueue, RosterHost, UserAnswer, UserRequest } from "./shared";
import { oneLine } from "./transcript";
import { PendingRequests, parseCollabRequest } from "./user-requests";

const DISPLAY_NAME = "omp-agents";
const LINK_ATTEMPTS = 3;
/** Wait this long before rejoining a host whose room dropped us while it stays listed. */
const REJOIN_MS = 5000;

const AGENT_STATUSES: Record<string, AgentStatus> = { running: "running", idle: "idle", parked: "parked", aborted: "aborted" };

interface HostAgent {
	id: string;
	type: string;
	isMain: boolean;
	parentId: string | null;
	status: AgentStatus;
	/** ms since the epoch. */
	createdAt: number;
}

function parseAgents(value: unknown): HostAgent[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(raw => {
		if (!isObject(raw)) return [];
		const { id, displayName, kind, parentId, status, createdAt } = raw;
		const parsed = typeof status === "string" ? AGENT_STATUSES[status] : undefined;
		if (typeof id !== "string" || !parsed) return [];
		return [
			{
				id,
				type: typeof displayName === "string" ? displayName : "agent",
				isMain: kind === "main",
				parentId: typeof parentId === "string" ? parentId : null,
				status: parsed,
				createdAt: typeof createdAt === "number" ? createdAt : 0,
			},
		];
	});
}

export const SUBAGENT_LIFECYCLE = "task:subagent:lifecycle";
export const SUBAGENT_PROGRESS = "task:subagent:progress";

/** One line saying what a subagent is doing, from a `task:subagent:*` payload (a Collab `bus` frame or an RPC subagent frame). */
export function activityOf(channel: unknown, payload: unknown): { id: string; activity: string } | null {
	if (!isObject(payload)) return null;
	if (channel === SUBAGENT_LIFECYCLE) {
		const description = nonEmptyStr(payload.description);
		return typeof payload.id === "string" && description ? { id: payload.id, activity: oneLine(description) } : null;
	}
	if (channel !== SUBAGENT_PROGRESS || !isObject(payload.progress)) return null;
	const progress = payload.progress;
	if (typeof progress.id !== "string") return null;
	const text =
		nonEmptyStr(progress.currentToolIntent) ??
		nonEmptyStr(progress.lastIntent) ??
		nonEmptyStr(progress.description) ??
		nonEmptyStr(payload.assignment) ??
		nonEmptyStr(progress.task);
	return text ? { id: progress.id, activity: oneLine(text) } : null;
}

/** omp's `ContextUsage` (a Collab state frame or an RPC state), as the roster's context numbers. */
export function contextOf(value: unknown): ContextUsage | null {
	if (!isObject(value)) return null;
	const { tokens, contextWindow } = value;
	return typeof tokens === "number" && typeof contextWindow === "number" && contextWindow > 0
		? { tokens, window: contextWindow }
		: null;
}

/** Model, thinking level, context, and whether a turn runs, from the host's status-line snapshot. */
interface HostState {
	model: string | null;
	thinkingLevel: string | null;
	context: ContextUsage | null;
	streaming: boolean;
}

function parseState(value: unknown): HostState | null {
	if (!isObject(value)) return null;
	const { model, thinkingLevel } = value;
	return {
		model: isObject(model) && typeof model.provider === "string" && typeof model.id === "string" ? `${model.provider}/${model.id}` : null,
		thinkingLevel: nonEmptyStr(thinkingLevel) ?? null,
		context: contextOf(value.contextUsage),
		streaming: value.isStreaming === true,
	};
}

const sameState = (a: HostState | null, b: HostState | null): boolean =>
	a?.model === b?.model &&
	a?.thinkingLevel === b?.thinkingLevel &&
	a?.context?.tokens === b?.context?.tokens &&
	a?.context?.window === b?.context?.window &&
	a?.streaming === b?.streaming;

/** A message as the user typed it, which the queue shows, and as the host receives it once its skill or file command expanded. */
export interface Outgoing {
	text: string;
	payload: string;
}

/** Resolve a link, re-listing on `stale_generation` (the host switched sessions mid-request). */
async function openFreshRoom(host: HostSnapshot): Promise<Room> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await openRoom(host.instanceId, host.access);
		} catch (err) {
			if (linkErrorCode(err) !== "stale_generation" || attempt >= LINK_ATTEMPTS) throw err;
		}
	}
}

function statusOf(host: HostSnapshot): HostStatus {
	if (host.inputRequired) return "needs-input";
	if (host.busy === null) return "unknown";
	return host.busy ? "working" : "idle";
}

/** A terminal session, joined through its Collab room. Its registry row is the guest's snapshot of it. */
export class SessionGuest implements LiveSession {
	readonly instanceId: string;
	/** Room generation this guest is joined to; `null` until the link resolves. */
	generation: number | null = null;
	control: ControlPhase = { phase: "connecting" };
	/** When the guest ended, for rejoin backoff. */
	endedAt: number | null = null;
	/** The host's last status-line snapshot; `null` until the welcome arrives. */
	state: HostState | null = null;

	/** The registry's latest listing of this session, replaced on every poll. */
	#host: HostSnapshot;
	#socket: CollabSocket | null = null;
	#readOnly = true;
	#closed = false;
	#agents: HostAgent[] = [];
	#activity = new Map<string, string>();
	/** Transcripts found away from where {@link #agentFile} expects them, and the agents already looked for. */
	#foundFiles = new Map<string, string>();
	#searched = new Set<string>();
	readonly #emit: (update: LiveUpdate) => void;
	/** The host's `ui-request`s; the host sends them to writable guests only. */
	readonly #requests = new PendingRequests(() => this.#emit({ kind: "roster" }));
	/**
	 * Follow-ups waiting for a turn to end, by agent id, `""` for the main agent. Collab has no follow-up frame and the
	 * host steers every guest message, so the guest holds them and sends one per finished turn, as omp's default
	 * `followUpMode` delivers them.
	 */
	readonly #followUps = new Map<string, Outgoing[]>();
	/**
	 * Whether the main agent's turn was interrupted, by this guest's Stop or by a reply cut off mid-stream. omp's Esc puts
	 * its queue back in the editor rather than run it after an interrupt, so held follow-ups wait for the next turn.
	 */
	#interrupted = false;

	constructor(host: HostSnapshot, emit: (update: LiveUpdate) => void) {
		this.instanceId = host.instanceId;
		this.#host = host;
		this.#emit = emit;
		void this.#start(host);
	}

	get cwd(): string {
		return this.#host.cwd;
	}

	get sessionId(): string {
		return this.#host.sessionId;
	}

	get canWrite(): boolean {
		return this.control.phase === "live" && !this.#readOnly;
	}

	row(pullRequests: LinkedPullRequest[]): RosterHost {
		const host = this.#host;
		return {
			source: "terminal",
			instanceId: host.instanceId,
			pid: host.pid,
			sessionId: host.sessionId,
			sessionName: host.sessionName,
			cwd: host.cwd,
			cwdDisplay: displayPath(host.cwd),
			// The room's status-line snapshot, else the registry row until the guest is welcomed.
			model: this.state?.model ?? (host.model ? `${host.model.provider}/${host.model.id}` : null),
			thinkingLevel: this.state?.thinkingLevel ?? null,
			context: this.state?.context ?? null,
			startedAt: host.startedAt,
			participants: host.participants,
			relayConnected: host.relayConnected,
			status: statusOf(host),
			control: this.control,
			agents: this.agents(),
			pullRequests,
			requests: this.requests(),
			queue: this.queue(null),
		};
	}

	transcriptPath(agentId: string | null, savedFile: (sessionId: string) => string | null): string | null {
		const sessionFile = savedFile(this.#host.sessionId);
		if (!sessionFile || !agentId) return sessionFile;
		return this.#agentFile(sessionFile, agentId);
	}

	follow(listed: ReadonlyMap<string, HostSnapshot>): boolean {
		const host = listed.get(this.instanceId);
		if (!host) {
			this.disconnect("This session is no longer running.");
			return false;
		}
		if (this.generation !== null && this.generation !== host.generation) {
			this.disconnect("The session switched rooms; rejoining.");
			return false;
		}
		this.#host = host;
		return this.endedAt === null || Date.now() - this.endedAt <= REJOIN_MS;
	}

	agents(): AgentRow[] {
		const subagents = this.#agents.filter(agent => !agent.isMain);
		const ids = new Set(subagents.map(agent => agent.id));
		return subagents.map(agent => ({
			id: agent.id,
			kind: agent.type,
			parentId: agent.parentId && ids.has(agent.parentId) ? agent.parentId : null,
			status: agent.status,
			activity: this.#activity.get(agent.id) ?? null,
			canMessage: !this.#readOnly && agent.status !== "aborted",
			queue: this.queue(agent.id),
		}));
	}

	/** What waits on the turn of the main agent (`null`) or a subagent. The host shows no guest its own queue. */
	queue(agentId: string | null): MessageQueue {
		return { steering: [], followUp: (this.#followUps.get(agentId ?? "") ?? []).map(message => message.text) };
	}

	requests(): UserRequest[] {
		return this.#requests.list();
	}

	/**
	 * Where omp writes a subagent's transcript: `<id>.jsonl` in its parent's artifacts
	 * directory, which is the parent's transcript path without `.jsonl`. A subagent that
	 * outlived a `/new` or `/resume` stays registered but wrote beside the session it
	 * started in; when the expected file is missing, the guest looks for it among the
	 * project's sessions and reports a roster change once found.
	 */
	#agentFile(sessionFile: string, agentId: string): string | null {
		const found = this.#foundFiles.get(agentId);
		if (found) return found;
		const byId = new Map(this.#agents.filter(agent => !agent.isMain).map(agent => [agent.id, agent]));
		const agent = byId.get(agentId);
		if (!agent) return null;
		const ancestors: string[] = [];
		for (let parent = agent.parentId ? byId.get(agent.parentId) : undefined; parent; parent = parent.parentId ? byId.get(parent.parentId) : undefined) {
			ancestors.unshift(parent.id);
		}
		const expected = join(sessionFile.replace(/\.jsonl$/, ""), ...ancestors, `${agentId}.jsonl`);
		if (!existsSync(expected) && !this.#searched.has(agentId)) {
			this.#searched.add(agentId);
			void this.#findAgentFile(dirname(sessionFile), agent);
		}
		return expected;
	}

	/** The newest `<id>.jsonl` under the project's sessions written since the subagent registered. */
	async #findAgentFile(projectDir: string, agent: HostAgent): Promise<void> {
		let newest: { path: string; mtimeMs: number } | null = null;
		for await (const rel of new Bun.Glob(`*/**/${agent.id}.jsonl`).scan({ cwd: projectDir })) {
			const path = join(projectDir, rel);
			const { mtimeMs } = await stat(path);
			if (mtimeMs >= agent.createdAt && (!newest || mtimeMs > newest.mtimeMs)) newest = { path, mtimeMs };
		}
		if (!newest || this.#closed) return;
		this.#foundFiles.set(agent.id, newest.path);
		this.#emit({ kind: "roster" });
	}

	/** Prepare `text` as the terminal would, expanding a skill or file command, then {@link send} it. */
	async prompt(agentId: string | null, text: string, delivery: Delivery): Promise<void> {
		const payload = await expandPrompt(this.instanceId, this.#host.cwd, text, agentId ? "subagent" : "session");
		this.send(agentId, { text, payload }, delivery);
	}

	/**
	 * Prompt the main agent (`agentId` null) or chat to a subagent. The host steers a running agent, prompts an idle
	 * one, and revives a parked subagent. A follow-up waits here while the agent's turn runs.
	 */
	send(agentId: string | null, message: Outgoing, delivery: Delivery): void {
		if (!this.canWrite) return;
		const key = agentId ?? "";
		if (delivery === "followUp" && this.#running(key)) {
			this.#followUps.set(key, [...(this.#followUps.get(key) ?? []), message]);
			this.#emit({ kind: "roster" });
			return;
		}
		if (!key) this.#socket?.send({ t: "prompt", text: message.payload });
		else if (this.#agents.some(a => a.id === key && !a.isMain && a.status !== "aborted")) {
			this.#socket?.send({ t: "agent-cmd", cmd: "chat", agentId: key, text: message.payload });
		}
	}

	/**
	 * Take a held follow-up back. False when it is no longer held: its turn ended and the guest sent it. Collab shows no
	 * guest the host's queue, so a terminal session's queue holds only this guest's own follow-ups.
	 */
	async dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<boolean> {
		if (queue !== "followUp") return false;
		const key = agentId ?? "";
		const held = this.#followUps.get(key) ?? [];
		const index = held.findIndex(message => message.text === text);
		if (index < 0) return false;
		this.#followUps.set(key, held.toSpliced(index, 1));
		this.#emit({ kind: "roster" });
		return true;
	}

	abort(): void {
		if (!this.canWrite) return;
		this.#interrupted = true;
		this.#socket?.send({ t: "abort" });
	}

	/** Whether the agent's turn runs, as the host last reported it: its `state` frames for the main agent, its registry for subagents. */
	#running(key: string): boolean {
		return key ? this.#agents.some(a => a.id === key && !a.isMain && a.status === "running") : this.state?.streaming === true;
	}

	/** Send the next follow-up of each agent in `running` whose turn has ended since. A subagent that stopped takes none. */
	#release(running: string[]): void {
		if (!this.canWrite) return;
		for (const key of running) {
			if (this.#running(key) || (!key && this.#interrupted)) continue;
			const [next, ...rest] = this.#followUps.get(key) ?? [];
			if (!next) continue;
			if (key && !this.#agents.some(a => a.id === key && !a.isMain && a.status !== "aborted")) {
				this.#followUps.delete(key);
				const texts = [next, ...rest].map(message => message.text).join("\n");
				this.#emit({ kind: "note", agentId: key, level: "warning", text: `Not sent, the subagent stopped before its turn ended:\n${texts}` });
			} else {
				this.#followUps.set(key, rest);
				this.send(key || null, next, "steer");
			}
			this.#emit({ kind: "roster" });
		}
	}

	/** Reply to a host `ui-request`. The host takes the first answer from any writer or its own terminal. */
	answer(requestId: string, answer: UserAnswer): void {
		if (!this.canWrite || !this.#requests.take(requestId, answer)) return;
		// A missing value is the host's cancel.
		this.#socket?.send({ t: "ui-response", reqId: Number(requestId), value: answer.kind === "value" ? answer.value : undefined });
	}

	/**
	 * Stop the terminal session's omp as closing its terminal would; it leaves the registry on exit, and its file stays
	 * resumable. A room shared read-only grants no control, ending it included.
	 */
	async end(): Promise<void> {
		const { pid } = this.#host;
		// `kill` with 0, 1, or a negative pid signals process groups or every process; only one omp process is meant.
		if (!this.canWrite || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// The process already exited; the next registry poll drops it.
		}
	}

	async dispose(): Promise<void> {
		this.disconnect("Dashboard shut down.");
	}

	/** Terminal: the host vanished or rotated rooms, the relay gave up, or the dashboard shut down. */
	disconnect(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.endedAt = Date.now();
		this.#socket?.close();
		this.#socket = null;
		this.#requests.clear();
		for (const [key, held] of this.#followUps) {
			if (held.length === 0) continue;
			const texts = held.map(message => message.text).join("\n");
			this.#emit({ kind: "note", agentId: key || null, level: "warning", text: `Not sent, the room closed before the turn ended:\n${texts}` });
		}
		this.#followUps.clear();
		this.#setControl({ phase: "ended", reason });
	}

	async #start(host: HostSnapshot): Promise<void> {
		let room: Room;
		try {
			room = await openFreshRoom(host);
		} catch (err) {
			this.disconnect(errorText(err));
			return;
		}
		if (this.#closed) return;
		this.generation = room.generation;
		this.#readOnly = room.writeToken === undefined;
		const socket = room.socket;
		this.#socket = socket;
		socket.onOpen = () => {
			socket.send({ t: "hello", proto: COLLAB_PROTO, name: DISPLAY_NAME, writeToken: room.writeToken });
		};
		socket.onFrame = frame => this.#onFrame(frame);
		socket.onClose = (reason, willReconnect) => {
			if (willReconnect) this.#setControl({ phase: "reconnecting", reason });
			else this.disconnect(reason);
		};
		socket.connect();
	}

	#onFrame(frame: Frame): void {
		if (this.#closed) return;
		const running = [...this.#followUps.keys()].filter(key => this.#running(key));
		this.#apply(frame);
		this.#release(running);
	}

	#apply(frame: Frame): void {
		switch (frame.t) {
			case "welcome":
				this.#readOnly = this.#readOnly || frame.readOnly === true;
				this.#agents = parseAgents(frame.agents);
				this.state = parseState(frame.state);
				// The host replays its pending questions after every welcome.
				this.#requests.clear();
				// Rows carry `canMessage`, which depends on the welcome's read-only verdict.
				this.#setControl({ phase: "live", readOnly: this.#readOnly });
				return;
			case "event": {
				const event = frame.event;
				if (isObject(event) && event.type === "agent_start") this.#interrupted = false;
				else if (isObject(event) && event.type === "message_end" && isObject(event.message) && event.message.stopReason === "aborted") {
					this.#interrupted = true;
				}
				this.#emit({ kind: "event", event });
				return;
			}
			case "state": {
				const state = parseState(frame.state);
				if (sameState(state, this.state)) return;
				this.state = state;
				this.#emit({ kind: "roster" });
				return;
			}
			case "agents":
				this.#agents = parseAgents(frame.agents);
				this.#emit({ kind: "roster" });
				return;
			case "bus": {
				const update = activityOf(frame.channel, frame.data);
				if (update && this.#activity.get(update.id) !== update.activity) {
					this.#activity.set(update.id, update.activity);
					this.#emit({ kind: "roster" });
				}
				return;
			}
			case "ui-request": {
				const request = parseCollabRequest(frame.request);
				if (request) this.#requests.add(request);
				return;
			}
			case "ui-request-end":
				this.#requests.remove(String(frame.reqId));
				return;
			case "error": {
				const message = String(frame.message);
				// Agent-command failures name their agent ("agent <id>: …"); show them where the user sent the message.
				const agent = this.#agents.find(a => !a.isMain && message.startsWith(`agent ${a.id}:`));
				this.#emit({ kind: "note", agentId: agent?.id ?? null, level: "error", text: agent ? message : `Host: ${message}` });
				return;
			}
			case "bye":
				this.disconnect(`Host ended the room: ${String(frame.reason)}`);
				return;
			default:
				return;
		}
	}

	#setControl(control: ControlPhase): void {
		this.control = control;
		this.#emit({ kind: "roster" });
	}
}
