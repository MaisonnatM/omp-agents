/**
 * One server-side collab guest per terminal session. It joins the host's room
 * through omp's own relay client for what only the room offers: prompting and
 * stopping the session, messaging its subagents, the host's live subagent
 * registry, and live agent events. Transcripts never wait on it; they are read
 * from the session files, so the welcome snapshot the host sends is ignored.
 */
import { expandPrompt } from "./commands";
import { errorText, isObject, nonEmptyStr } from "./json";
import { type LiveRow, type LiveSession, type LiveUpdate, PromptRefused, turnUpdate } from "./live-session";
import { COLLAB_PROTO, type CollabSocket, type Frame, type HostSnapshot, linkErrorCode, listHosts, openRoom, type Room } from "./omp/collab";
import { selectorOf } from "./shared/models";
import type { AgentRow, ContextUsage, ControlPhase, Delivery, HostStatus, MessageQueue, PromptImage, UserAnswer, UserRequest, WithdrawnMessage } from "./shared/sessions";
import { contextOf, type HostAgent, parseAgents, parseSubagentFrame, stoppedAt, SubagentFiles } from "./subagents";
import { SerialLane } from "./serial-lane";
import { PendingRequests, parseCollabRequest } from "./user-requests";

const DISPLAY_NAME = "omp-agents";
const LINK_ATTEMPTS = 3;
/** Wait this long before rejoining a host whose room dropped us while it stays listed. */
const REJOIN_MS = 5000;

/** Model, thinking level, context, whether a turn runs, and how many messages wait on it, from the host's status-line snapshot. */
interface HostState {
	model: string | null;
	thinkingLevel: string | null;
	context: ContextUsage | null;
	streaming: boolean;
	queued: number;
}

function parseState(value: unknown): HostState | null {
	if (!isObject(value)) return null;
	const { model, thinkingLevel } = value;
	return {
		model: isObject(model) && typeof model.provider === "string" && typeof model.id === "string" ? selectorOf({ provider: model.provider, id: model.id }) : null,
		thinkingLevel: nonEmptyStr(thinkingLevel) ?? null,
		context: contextOf(value.contextUsage),
		streaming: value.isStreaming === true,
		queued: typeof value.queuedMessageCount === "number" ? value.queuedMessageCount : 0,
	};
}

const sameState = (a: HostState | null, b: HostState | null): boolean =>
	a?.model === b?.model &&
	a?.thinkingLevel === b?.thinkingLevel &&
	a?.context?.tokens === b?.context?.tokens &&
	a?.context?.window === b?.context?.window &&
	a?.streaming === b?.streaming;

/**
 * A message as the user typed it, which the queue shows, and as the host receives it once its skill or file command
 * expanded, with the images it carries to the main agent.
 */
export interface Outgoing {
	text: string;
	payload: string;
	images?: PromptImage[];
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

/** A guest in its room. `readOnly`: the room grants no control, from its link or the host's welcome. `socket` is `connecting` until the welcome. */
interface Joined {
	phase: "joined";
	room: Room;
	readOnly: boolean;
	socket: { phase: "connecting" } | { phase: "live" } | { phase: "reconnecting"; reason: string };
}

/**
 * The guest's link to the host's room. Only `joined` holds the room, so a frame can go out only between the join and the
 * end, and every frame that acts on the session takes its socket from `SessionGuest.#writer`.
 * `ended.at`: when the guest ended, for rejoin backoff; `ended.generation`: the room it left, `null` when it never joined one.
 */
type RoomLink = { phase: "connecting" } | Joined | { phase: "ended"; reason: string; at: number; generation: number | null };

/** A terminal session, joined through its Collab room. Its registry row is the guest's snapshot of it. */
export class SessionGuest implements LiveSession {
	readonly instanceId: string;
	#link: RoomLink = { phase: "connecting" };
	/** Whether the host left the registry or switched rooms: the guest leaves the roster at once, and a host still listed is joined anew. */
	#replaced = false;
	/** The host's last status-line snapshot; `null` until the welcome arrives. */
	state: HostState | null = null;

	/** The registry's latest listing of this session, replaced on every poll. */
	#host: HostSnapshot;
	#agents: HostAgent[] = [];
	/** What the host's `bus` frames and agent lists told this guest of each agent beyond the list itself. */
	#learned = new Map<string, Pick<AgentRow, "activity" | "model" | "endedAt">>();
	readonly #subagentFiles = new SubagentFiles(() => this.#emit({ kind: "roster" }));
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
	/** Prompt, promote, interrupt, and flush, so their frames follow a steer that is still being prepared. */
	readonly #turn = new SerialLane();
	/** Whether this guest steered the running turn since the host last reported its queue; the host's state lags the steer. */
	#steered = false;

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

	/** Room generation this guest is joined to, or left; `null` until the link resolves. */
	get generation(): number | null {
		const link = this.#link;
		if (link.phase === "joined") return link.room.generation;
		return link.phase === "ended" ? link.generation : null;
	}

	get control(): ControlPhase {
		const link = this.#link;
		if (link.phase === "ended") return { phase: "ended", reason: link.reason };
		if (link.phase === "connecting") return link;
		return link.socket.phase === "live" ? { phase: "live", readOnly: link.readOnly } : link.socket;
	}

	get canWrite(): boolean {
		return this.#writer() !== null;
	}

	/** The room's socket while the room is live and grants this guest control. */
	#writer(): CollabSocket | null {
		const link = this.#link;
		return link.phase === "joined" && link.socket.phase === "live" && !link.readOnly ? link.room.socket : null;
	}

	row(): LiveRow {
		const host = this.#host;
		return {
			source: "terminal",
			instanceId: host.instanceId,
			pid: host.pid,
			sessionId: host.sessionId,
			sessionName: host.sessionName,
			cwd: host.cwd,
			// The room's status-line snapshot, else the registry row until the guest is welcomed.
			model: this.state?.model ?? (host.model ? selectorOf(host.model) : null),
			thinkingLevel: this.state?.thinkingLevel ?? null,
			context: this.state?.context ?? null,
			startedAt: host.startedAt,
			participants: host.participants,
			relayConnected: host.relayConnected,
			status: statusOf(host),
			control: this.control,
			agents: this.agents(),
			requests: this.requests(),
			queue: this.queue(null),
		};
	}

	transcriptPath(agentId: string | null, savedFile: (sessionId: string) => string | null): string | null {
		const sessionFile = savedFile(this.#host.sessionId);
		if (!sessionFile || !agentId) return sessionFile;
		return this.#subagentFiles.pathOf(sessionFile, agentId, this.#agents);
	}

	follow(listed: ReadonlyMap<string, HostSnapshot>): void {
		const host = listed.get(this.instanceId);
		if (!host) {
			this.#replaced = true;
			this.disconnect("This session is no longer running.");
			return;
		}
		if (this.generation !== null && this.generation !== host.generation) {
			this.#replaced = true;
			this.disconnect("The session switched rooms; rejoining.");
			return;
		}
		this.#host = host;
	}

	/** Gone, or ended for longer than {@link REJOIN_MS} while its host stays listed; the server then joins that host with a new guest. */
	finished(now: number): boolean {
		return this.#replaced || (this.#link.phase === "ended" && now - this.#link.at > REJOIN_MS);
	}

	agents(): AgentRow[] {
		const subagents = this.#agents.filter(agent => !agent.isMain);
		const ids = new Set(subagents.map(agent => agent.id));
		return subagents.map(agent => ({
			id: agent.id,
			kind: agent.type,
			parentId: agent.parentId && ids.has(agent.parentId) ? agent.parentId : null,
			status: agent.status,
			...this.#learnedOf(agent.id),
			// A host that sends no creation time sends 0.
			startedAt: agent.createdAt || null,
			canMessage: this.canWrite && agent.status !== "aborted",
			queue: this.queue(agent.id),
		}));
	}

	#learnedOf(id: string): Pick<AgentRow, "activity" | "model" | "endedAt"> {
		return this.#learned.get(id) ?? { activity: null, model: null, endedAt: null };
	}

	/** What waits on the turn of the main agent (`null`) or a subagent. The host shows no guest its own queue. */
	queue(agentId: string | null): MessageQueue {
		return { steering: [], followUp: (this.#followUps.get(agentId ?? "") ?? []).map(message => message.text) };
	}

	requests(): UserRequest[] {
		return this.#requests.list();
	}

	/**
	 * Prepare `text` as the terminal would, expanding a skill or file command, then {@link send} it with `images`.
	 * Rejects with {@link PromptRefused} while the room takes no messages from this guest, where {@link send} drops one.
	 */
	async prompt(agentId: string | null, text: string, images: PromptImage[], delivery: Delivery): Promise<void> {
		if (!this.canWrite) throw new PromptRefused("this terminal session takes no messages from the dashboard");
		await this.#turn.run(async () => {
			if (agentId && images.length > 0) throw new Error("omp sends a subagent text only.");
			const payload = await expandPrompt(this.instanceId, this.#host.cwd, text, agentId ? "subagent" : "session");
			this.send(agentId, { text, payload, images }, delivery);
		});
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
		if (!key) {
			if (this.#running("")) this.#steered = true;
			const images = message.images?.map(image => ({ type: "image", ...image }));
			this.#writer()?.send({ t: "prompt", text: message.payload, images: images?.length ? images : undefined });
		} else if (this.#agents.some(a => a.id === key && !a.isMain && a.status !== "aborted")) {
			this.#writer()?.send({ t: "agent-cmd", cmd: "chat", agentId: key, text: message.payload });
		}
	}

	/** Collab shows no guest the host's queue, so a terminal session's queue holds only this guest's own follow-ups. */
	async dequeue(agentId: string | null, queue: keyof MessageQueue, text: string): Promise<WithdrawnMessage | null> {
		if (queue !== "followUp") return null;
		const message = this.#withdraw(agentId ?? "", text);
		return message && { text: message.text, images: message.images ?? [] };
	}

	promote(agentId: string | null, text: string): Promise<boolean> {
		return this.#turn.run(() => {
			const message = this.#withdraw(agentId ?? "", text);
			if (message) this.send(agentId, message, "steer");
			return message !== null;
		});
	}

	#withdraw(key: string, text: string): Outgoing | null {
		const held = this.#followUps.get(key) ?? [];
		const index = held.findIndex(message => message.text === text);
		if (index < 0) return null;
		this.#followUps.set(key, held.toSpliced(index, 1));
		this.#emit({ kind: "roster" });
		return held[index];
	}

	interrupt(): Promise<WithdrawnMessage[]> {
		if (!this.canWrite) return Promise.resolve([]);
		this.#interrupted = true;
		return this.#turn.run(() => {
			const held = this.#followUps.get("") ?? [];
			if (held.length > 0) {
				this.#followUps.delete("");
				this.#emit({ kind: "roster" });
			}
			this.#writer()?.send({ t: "abort" });
			return held.map(({ text, images = [] }) => ({ text, images }));
		});
	}

	/** The host's last state counts a waiting steer, or this guest steered since that state left the host. */
	flush(): void {
		if (!this.canWrite) return;
		void this.#turn.run(() => {
			if (!this.#steered && !this.state?.queued) return;
			this.#interrupted = true;
			this.#writer()?.send({ t: "abort" });
		});
	}

	/** omp's Agent Hub kill over Collab: settles once sent to the host, which aborts a running subagent and tombstones it. */
	async cancelAgent(agentId: string): Promise<void> {
		if (!this.#running(agentId)) return;
		this.#writer()?.send({ t: "agent-cmd", cmd: "kill", agentId });
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
		const writer = this.#writer();
		if (!writer || !this.#requests.take(requestId, answer)) return;
		// A missing value is the host's cancel.
		writer.send({ t: "ui-response", reqId: Number(requestId), value: answer.kind === "value" ? answer.value : undefined });
	}

	/**
	 * Stop the terminal session's omp as closing its terminal would; it leaves the registry on exit, and its file stays
	 * resumable. A room shared read-only grants no control, ending it included. Collab has no frame that ends a host, so
	 * this signals its process, once a fresh registry listing still shows the same omp process (its random `instanceId` at
	 * this pid) hosting this session: the guest's snapshot can be a poll old, and its pid reused by another process since.
	 */
	async end(): Promise<void> {
		const { instanceId, pid, sessionId } = this.#host;
		// `kill` with 0, 1, or a negative pid signals process groups or every process; only one omp process is meant.
		if (!this.canWrite || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return;
		const listed = (await listHosts()).find(host => host.instanceId === instanceId);
		if (listed?.pid !== pid || listed.sessionId !== sessionId) return;
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// The process exited since the listing; the next registry poll drops it.
		}
	}

	async dispose(): Promise<void> {
		this.disconnect("Dashboard shut down.");
	}

	/** Terminal: the host vanished or rotated rooms, the relay gave up, or the dashboard shut down. */
	disconnect(reason: string): void {
		const link = this.#link;
		if (link.phase === "ended") return;
		this.#link = { phase: "ended", reason, at: Date.now(), generation: link.phase === "joined" ? link.room.generation : null };
		if (link.phase === "joined") link.room.socket.close();
		this.#requests.clear();
		this.#subagentFiles.close();
		for (const [key, held] of this.#followUps) {
			if (held.length === 0) continue;
			const texts = held.map(message => message.text).join("\n");
			this.#emit({ kind: "note", agentId: key || null, level: "warning", text: `Not sent, the room closed before the turn ended:\n${texts}` });
		}
		this.#followUps.clear();
		this.#emit({ kind: "roster" });
	}

	async #start(host: HostSnapshot): Promise<void> {
		let room: Room;
		try {
			room = await openFreshRoom(host);
		} catch (err) {
			this.disconnect(errorText(err));
			return;
		}
		if (this.#link.phase === "ended") return;
		this.#link = { phase: "joined", room, readOnly: room.writeToken === undefined, socket: { phase: "connecting" } };
		const { socket } = room;
		socket.onOpen = () => {
			socket.send({ t: "hello", proto: COLLAB_PROTO, name: DISPLAY_NAME, writeToken: room.writeToken });
		};
		socket.onFrame = frame => this.#onFrame(frame);
		socket.onClose = (reason, willReconnect) => {
			const link = this.#link;
			if (!willReconnect) this.disconnect(reason);
			else if (link.phase === "joined") {
				this.#link = { ...link, socket: { phase: "reconnecting", reason } };
				this.#emit({ kind: "roster" });
			}
		};
		socket.connect();
	}

	#onFrame(frame: Frame): void {
		const link = this.#link;
		if (link.phase !== "joined") return;
		// Only the host's state and its agents end a turn; a turn streams as `event` frames, which leave nothing to release.
		if (frame.t === "event" || this.#followUps.size === 0) {
			this.#apply(link, frame);
			return;
		}
		const running = [...this.#followUps.keys()].filter(key => this.#running(key));
		this.#apply(link, frame);
		this.#release(running);
	}

	#apply(link: Joined, frame: Frame): void {
		switch (frame.t) {
			case "welcome":
				this.#link = { ...link, readOnly: link.readOnly || frame.readOnly === true, socket: { phase: "live" } };
				this.#setAgents(parseAgents(frame.agents));
				this.state = parseState(frame.state);
				// The host replays its pending questions after every welcome.
				this.#requests.clear();
				// Rows carry `canMessage`, which depends on the welcome's read-only verdict.
				this.#emit({ kind: "roster" });
				return;
			case "event": {
				const event = frame.event;
				if (isObject(event) && event.type === "agent_start") this.#interrupted = false;
				else if (isObject(event) && event.type === "message_end" && isObject(event.message) && event.message.stopReason === "aborted") {
					this.#interrupted = true;
				}
				this.#emit({ kind: "event", event });
				const turn = turnUpdate(event);
				if (turn) this.#emit(turn);
				return;
			}
			case "state": {
				const previous = this.state;
				this.state = parseState(frame.state);
				// The host now counts the steer this guest sent, or the turn it steered has ended.
				if (!this.state?.streaming || this.state.queued > 0) this.#steered = false;
				if (sameState(this.state, previous)) return;
				this.#emit({ kind: "roster" });
				return;
			}
			case "agents":
				this.#setAgents(parseAgents(frame.agents));
				this.#emit({ kind: "roster" });
				return;
			case "bus": {
				const update = parseSubagentFrame(frame.channel, frame.data);
				if (!update) return;
				const known = this.#learnedOf(update.id);
				const next = { ...known, activity: update.activity ?? known.activity, model: update.model ?? known.model };
				if (next.activity !== known.activity || next.model !== known.model) {
					this.#learned.set(update.id, next);
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

	/** Replace the host's agent list, noting when each subagent stops running; what the guest learned of an agent that left goes with it. */
	#setAgents(agents: HostAgent[]): void {
		const now = Date.now();
		for (const { id } of this.#agents) if (!agents.some(agent => agent.id === id)) this.#learned.delete(id);
		for (const agent of agents) {
			const known = this.#learnedOf(agent.id);
			const wasRunning = this.#agents.some(prev => prev.id === agent.id && prev.status === "running");
			const endedAt = stoppedAt(agent.status, known.endedAt, wasRunning ? now : null);
			if (endedAt !== known.endedAt) this.#learned.set(agent.id, { ...known, endedAt });
		}
		this.#subagentFiles.update(this.#agents, agents);
		this.#agents = agents;
	}
}
