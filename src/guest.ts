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
import { COLLAB_PROTO, type CollabSocket, type Frame, type HostSnapshot, linkErrorCode, openRoom, type Room } from "./omp";
import type { AgentRow, AgentStatus, ContextUsage, ControlPhase } from "./shared";
import { isObject, oneLine } from "./transcript";

export type LiveUpdate =
	/** Its roster row changed: control phase, subagents, or what a subagent is doing. */
	| { kind: "roster" }
	/** A live agent event of the session; it streams what the session file does not hold yet. */
	| { kind: "event"; event: unknown }
	/** An out-of-band line for the session (`agentId` null) or one of its subagents. */
	| { kind: "note"; agentId: string | null; level: "warning" | "error"; text: string };

const DISPLAY_NAME = "omp-agents";
const LINK_ATTEMPTS = 3;

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

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

export const SUBAGENT_LIFECYCLE = "task:subagent:lifecycle";
export const SUBAGENT_PROGRESS = "task:subagent:progress";

/** One line saying what a subagent is doing, from a `task:subagent:*` payload (a Collab `bus` frame or an RPC subagent frame). */
export function activityOf(channel: unknown, payload: unknown): { id: string; activity: string } | null {
	if (!isObject(payload)) return null;
	if (channel === SUBAGENT_LIFECYCLE) {
		const description = nonEmpty(payload.description);
		return typeof payload.id === "string" && description ? { id: payload.id, activity: oneLine(description) } : null;
	}
	if (channel !== SUBAGENT_PROGRESS || !isObject(payload.progress)) return null;
	const progress = payload.progress;
	if (typeof progress.id !== "string") return null;
	const text =
		nonEmpty(progress.currentToolIntent) ??
		nonEmpty(progress.lastIntent) ??
		nonEmpty(progress.description) ??
		nonEmpty(payload.assignment) ??
		nonEmpty(progress.task);
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

/** Model, thinking level, and context from the host's status-line snapshot. */
interface HostState {
	model: string | null;
	thinkingLevel: string | null;
	context: ContextUsage | null;
}

function parseState(value: unknown): HostState | null {
	if (!isObject(value)) return null;
	const { model, thinkingLevel } = value;
	return {
		model: isObject(model) && typeof model.provider === "string" && typeof model.id === "string" ? `${model.provider}/${model.id}` : null,
		thinkingLevel: nonEmpty(thinkingLevel) ?? null,
		context: contextOf(value.contextUsage),
	};
}

const sameState = (a: HostState | null, b: HostState | null): boolean =>
	a?.model === b?.model &&
	a?.thinkingLevel === b?.thinkingLevel &&
	a?.context?.tokens === b?.context?.tokens &&
	a?.context?.window === b?.context?.window;

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

export class SessionGuest {
	readonly instanceId: string;
	/** Room generation this guest is joined to; `null` until the link resolves. */
	generation: number | null = null;
	control: ControlPhase = { phase: "connecting" };
	/** When the guest ended, for rejoin backoff. */
	endedAt: number | null = null;
	/** The host's last status-line snapshot; `null` until the welcome arrives. */
	state: HostState | null = null;

	#socket: CollabSocket | null = null;
	#readOnly = true;
	#closed = false;
	#agents: HostAgent[] = [];
	#activity = new Map<string, string>();
	/** Transcripts found away from where {@link agentFile} expects them, and the agents already looked for. */
	#foundFiles = new Map<string, string>();
	#searched = new Set<string>();
	readonly #emit: (update: LiveUpdate) => void;

	constructor(host: HostSnapshot, emit: (update: LiveUpdate) => void) {
		this.instanceId = host.instanceId;
		this.#emit = emit;
		void this.#start(host);
	}

	get canWrite(): boolean {
		return this.control.phase === "live" && !this.#readOnly;
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
		}));
	}

	/**
	 * Where omp writes a subagent's transcript: `<id>.jsonl` in its parent's artifacts
	 * directory, which is the parent's transcript path without `.jsonl`. A subagent that
	 * outlived a `/new` or `/resume` stays registered but wrote beside the session it
	 * started in; when the expected file is missing, the guest looks for it among the
	 * project's sessions and reports a roster change once found.
	 */
	agentFile(sessionFile: string, agentId: string): string | null {
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

	prompt(text: string): void {
		if (this.canWrite) this.#socket?.send({ t: "prompt", text });
	}

	abort(): void {
		if (this.canWrite) this.#socket?.send({ t: "abort" });
	}

	/** Steer a running subagent, prompt an idle one, or revive a parked one; the host picks. */
	chat(agentId: string, text: string): void {
		const agent = this.#agents.find(a => a.id === agentId && !a.isMain);
		if (this.canWrite && agent && agent.status !== "aborted") {
			this.#socket?.send({ t: "agent-cmd", cmd: "chat", agentId, text });
		}
	}

	/** Terminal: the host vanished or rotated rooms, the relay gave up, or the dashboard shut down. */
	end(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.endedAt = Date.now();
		this.#socket?.close();
		this.#socket = null;
		this.#setControl({ phase: "ended", reason });
	}

	async #start(host: HostSnapshot): Promise<void> {
		let room: Room;
		try {
			room = await openFreshRoom(host);
		} catch (err) {
			this.end(err instanceof Error ? err.message : String(err));
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
			else this.end(reason);
		};
		socket.connect();
	}

	#onFrame(frame: Frame): void {
		if (this.#closed) return;
		switch (frame.t) {
			case "welcome":
				this.#readOnly = this.#readOnly || frame.readOnly === true;
				this.#agents = parseAgents(frame.agents);
				this.state = parseState(frame.state);
				// Rows carry `canMessage`, which depends on the welcome's read-only verdict.
				this.#setControl({ phase: "live", readOnly: this.#readOnly });
				return;
			case "event":
				this.#emit({ kind: "event", event: frame.event });
				return;
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
				const request = frame.request;
				const title = isObject(request) ? request.title : undefined;
				this.#emit({
					kind: "note",
					agentId: null,
					level: "warning",
					text: `The session is asking: ${String(title ?? "a question")}. Answer it in the omp terminal.`,
				});
				return;
			}
			case "error": {
				const message = String(frame.message);
				// Agent-command failures name their agent ("agent <id>: …"); show them where the user sent the message.
				const agent = this.#agents.find(a => !a.isMain && message.startsWith(`agent ${a.id}:`));
				this.#emit({ kind: "note", agentId: agent?.id ?? null, level: "error", text: agent ? message : `Host: ${message}` });
				return;
			}
			case "bye":
				this.end(`Host ended the room: ${String(frame.reason)}`);
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
