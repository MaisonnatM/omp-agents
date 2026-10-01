/**
 * One server-side collab guest per listed session. It joins the host's room
 * through omp's own relay client, folds frames into the session transcript,
 * keeps the host's subagent registry, tails subagent transcripts on demand,
 * and reports every change through `emit`.
 */
import { COLLAB_PROTO, type CollabSocket, type Frame, linkErrorCode, openRoom, type Room } from "./omp";
import type { AgentRow, AgentStatus, GuestPhase, Item, RosterHost } from "./shared";
import { isObject, oneLine, Transcript } from "./transcript";

export type GuestUpdate =
	| { kind: "phase"; phase: GuestPhase }
	/** `agentId` is `null` for the session transcript. */
	| { kind: "items"; agentId: string | null; reset: boolean; items: Item[] }
	| { kind: "agents" };

const DISPLAY_NAME = "omp-agents";
const LINK_ATTEMPTS = 3;
/** How long a caught-up subagent transcript waits before asking the host for new bytes. */
const TAIL_POLL_MS = 1000;

const AGENT_STATUSES: Record<string, AgentStatus> = { running: "running", idle: "idle", parked: "parked", aborted: "aborted" };

interface HostAgent {
	id: string;
	type: string;
	isMain: boolean;
	parentId: string | null;
	status: AgentStatus;
}

function parseAgents(value: unknown): HostAgent[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap(raw => {
		if (!isObject(raw)) return [];
		const { id, displayName, kind, parentId, status } = raw;
		const parsed = typeof status === "string" ? AGENT_STATUSES[status] : undefined;
		if (typeof id !== "string" || !parsed) return [];
		return [
			{
				id,
				type: typeof displayName === "string" ? displayName : "agent",
				isMain: kind === "main",
				parentId: typeof parentId === "string" ? parentId : null,
				status: parsed,
			},
		];
	});
}

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** One line saying what a subagent is doing, from a `task:subagent:*` bus payload. */
function activityOf(channel: unknown, payload: unknown): { id: string; activity: string } | null {
	if (!isObject(payload)) return null;
	if (channel === "task:subagent:lifecycle") {
		const description = nonEmpty(payload.description);
		return typeof payload.id === "string" && description ? { id: payload.id, activity: oneLine(description) } : null;
	}
	if (channel !== "task:subagent:progress" || !isObject(payload.progress)) return null;
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

/** Incremental reader of one subagent's JSONL transcript over `fetch-transcript`. */
export class AgentTail {
	readonly transcript = new Transcript();
	#offset = 0;
	/** Bytes after the last newline: a line the host was still writing. */
	#partial = "";
	#loaded = false;
	#stopped = false;
	#timer: NodeJS.Timeout | undefined;
	readonly #request: (fromByte: number) => void;
	readonly #emit: (reset: boolean, items: Item[]) => void;

	constructor(request: (fromByte: number) => void, emit: (reset: boolean, items: Item[]) => void) {
		this.#request = request;
		this.#emit = emit;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Read from the start: on open, and after the guest rejoins (pending requests died with the old connection). */
	restart(): void {
		clearTimeout(this.#timer);
		this.transcript.reset();
		this.#offset = 0;
		this.#partial = "";
		this.#loaded = false;
		this.#request(0);
	}

	onReply(text: string, newSize: number, error: string | undefined): void {
		if (this.#stopped) return;
		if (error) {
			this.#emit(!this.#loaded, this.transcript.note("error", `Transcript unavailable: ${error}`));
			this.#loaded = true;
			return;
		}
		const lines = (this.#partial + text).split("\n");
		this.#partial = lines.pop() ?? "";
		const changed = lines.flatMap(line => {
			try {
				return line ? this.transcript.applyEntry(JSON.parse(line)) : [];
			} catch {
				return [];
			}
		});
		this.#offset = newSize;
		if (!this.#loaded) {
			this.#loaded = true;
			this.#emit(true, this.transcript.items());
		} else if (changed.length > 0) {
			this.#emit(false, changed);
		}
		// A non-empty reply may be one 4 MiB slice of a longer file: keep reading until caught up.
		if (text) this.#request(this.#offset);
		else this.#timer = setTimeout(() => this.#request(this.#offset), TAIL_POLL_MS);
	}

	stop(): void {
		this.#stopped = true;
		clearTimeout(this.#timer);
	}
}

/** Resolve a link, re-listing on `stale_generation` (the host switched sessions mid-request). */
async function openFreshRoom(host: RosterHost): Promise<Room> {
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
	phase: GuestPhase = { phase: "connecting" };
	/** When the guest ended, for rejoin backoff. */
	endedAt: number | null = null;
	readonly transcript = new Transcript();

	#socket: CollabSocket | null = null;
	#readOnly = true;
	#closed = false;
	#agents: HostAgent[] = [];
	#activity = new Map<string, string>();
	#tails = new Map<string, AgentTail>();
	#pendingReads = new Map<number, AgentTail>();
	#reqSeq = 0;
	readonly #emit: (update: GuestUpdate) => void;

	constructor(host: RosterHost, emit: (update: GuestUpdate) => void) {
		this.instanceId = host.instanceId;
		this.#emit = emit;
		void this.#start(host);
	}

	get canWrite(): boolean {
		return this.phase.phase === "live" && !this.#readOnly;
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

	/** Start tailing a subagent's transcript, or return the tail already running. */
	openAgent(agentId: string): AgentTail {
		const existing = this.#tails.get(agentId);
		if (existing) return existing;
		const tail: AgentTail = new AgentTail(
			fromByte => this.#fetchTranscript(tail, agentId, fromByte),
			(reset, items) => this.#emit({ kind: "items", agentId, reset, items }),
		);
		this.#tails.set(agentId, tail);
		tail.restart();
		return tail;
	}

	closeAgent(agentId: string): void {
		this.#tails.get(agentId)?.stop();
		this.#tails.delete(agentId);
	}

	/** Terminal: the host vanished or rotated rooms, the relay gave up, or the dashboard shut down. */
	end(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.endedAt = Date.now();
		this.#socket?.close();
		this.#socket = null;
		for (const tail of this.#tails.values()) tail.stop();
		this.#setPhase({ phase: "ended", reason });
	}

	#fetchTranscript(tail: AgentTail, agentId: string, fromByte: number): void {
		if (this.phase.phase !== "live" || !this.#socket) return;
		const reqId = ++this.#reqSeq;
		this.#pendingReads.set(reqId, tail);
		this.#socket.send({ t: "fetch-transcript", reqId, agentId, fromByte });
	}

	async #start(host: RosterHost): Promise<void> {
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
			this.#pendingReads.clear();
			this.#setPhase({ phase: "syncing" });
			socket.send({ t: "hello", proto: COLLAB_PROTO, name: DISPLAY_NAME, writeToken: room.writeToken });
		};
		socket.onFrame = frame => this.#onFrame(frame);
		socket.onClose = (reason, willReconnect) => {
			if (willReconnect) this.#setPhase({ phase: "reconnecting", reason });
			else this.end(reason);
		};
		socket.connect();
	}

	#onFrame(frame: Frame): void {
		if (this.#closed) return;
		const transcript = this.transcript;
		switch (frame.t) {
			case "welcome":
				transcript.reset();
				this.#readOnly = this.#readOnly || frame.readOnly === true;
				this.#setAgents(parseAgents(frame.agents));
				if (frame.entryCount === 0) this.#goLive();
				return;
			case "snapshot-chunk":
				if (Array.isArray(frame.entries)) for (const entry of frame.entries) transcript.applyEntry(entry);
				if (frame.final === true) this.#goLive();
				return;
			case "event":
				if (this.phase.phase === "live") this.#emitItems(null, transcript.applyEvent(frame.event));
				return;
			case "agents":
				this.#setAgents(parseAgents(frame.agents));
				return;
			case "bus": {
				const update = activityOf(frame.channel, frame.data);
				if (update && this.#activity.get(update.id) !== update.activity) {
					this.#activity.set(update.id, update.activity);
					this.#emit({ kind: "agents" });
				}
				return;
			}
			case "transcript": {
				const reqId = typeof frame.reqId === "number" ? frame.reqId : -1;
				const tail = this.#pendingReads.get(reqId);
				this.#pendingReads.delete(reqId);
				const text = typeof frame.text === "string" ? frame.text : "";
				const newSize = typeof frame.newSize === "number" ? frame.newSize : 0;
				tail?.onReply(text, newSize, typeof frame.error === "string" ? frame.error : undefined);
				return;
			}
			case "ui-request": {
				const request = frame.request;
				const title = typeof request === "object" && request !== null && "title" in request ? request.title : undefined;
				this.#emitItems(null, transcript.note("warning", `The session is asking: ${String(title ?? "a question")}. Answer it in the omp terminal.`));
				return;
			}
			case "error": {
				const message = String(frame.message);
				// Agent-command failures name their agent ("agent <id>: …"); show them where the user sent the message.
				const agentId = [...this.#tails.keys()].find(id => message.startsWith(`agent ${id}:`));
				const tail = agentId === undefined ? undefined : this.#tails.get(agentId);
				if (agentId !== undefined && tail) this.#emitItems(agentId, tail.transcript.note("error", message));
				else this.#emitItems(null, transcript.note("error", `Host: ${message}`));
				return;
			}
			case "bye":
				this.end(`Host ended the room: ${String(frame.reason)}`);
				return;
			default:
				return;
		}
	}

	#setAgents(agents: HostAgent[]): void {
		this.#agents = agents;
		this.#emit({ kind: "agents" });
	}

	#goLive(): void {
		this.#setPhase({ phase: "live", readOnly: this.#readOnly });
		this.#emit({ kind: "items", agentId: null, reset: true, items: this.transcript.items() });
		for (const tail of this.#tails.values()) tail.restart();
		// Agent rows carry `canMessage`, which depends on the welcome's read-only verdict.
		this.#emit({ kind: "agents" });
	}

	#emitItems(agentId: string | null, items: Item[]): void {
		if (items.length > 0) this.#emit({ kind: "items", agentId, reset: false, items });
	}

	#setPhase(phase: GuestPhase): void {
		this.phase = phase;
		this.#emit({ kind: "phase", phase });
	}
}
