/**
 * One server-side collab guest per watched session. It joins the host's room
 * through omp's own relay client, folds frames into a {@link Transcript}, and
 * reports every change through `emit`.
 */
import { COLLAB_PROTO, type CollabSocket, type Frame, linkErrorCode, openRoom, type Room } from "./omp";
import type { GuestPhase, Item, RosterHost } from "./shared";
import { Transcript } from "./transcript";

export type GuestUpdate = { kind: "phase"; phase: GuestPhase } | { kind: "items"; reset: boolean; items: Item[] };

const DISPLAY_NAME = "omp-agents";
const LINK_ATTEMPTS = 3;

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
	readonly transcript = new Transcript();

	#socket: CollabSocket | null = null;
	#readOnly = true;
	#closed = false;
	readonly #emit: (update: GuestUpdate) => void;

	constructor(host: RosterHost, emit: (update: GuestUpdate) => void) {
		this.instanceId = host.instanceId;
		this.#emit = emit;
		void this.#start(host);
	}

	get canWrite(): boolean {
		return this.phase.phase === "live" && !this.#readOnly;
	}

	prompt(text: string): void {
		if (this.canWrite) this.#socket?.send({ t: "prompt", text });
	}

	abort(): void {
		if (this.canWrite) this.#socket?.send({ t: "abort" });
	}

	/** Terminal: the dashboard stopped watching, or the host vanished or rotated rooms. */
	end(reason: string): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#socket?.close();
		this.#socket = null;
		this.#setPhase({ phase: "ended", reason });
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
				if (frame.entryCount === 0) this.#goLive();
				return;
			case "snapshot-chunk":
				if (Array.isArray(frame.entries)) for (const entry of frame.entries) transcript.applyEntry(entry);
				if (frame.final === true) this.#goLive();
				return;
			case "event":
				if (this.phase.phase === "live") this.#emitItems(transcript.applyEvent(frame.event));
				return;
			case "ui-request": {
				const request = frame.request;
				const title = typeof request === "object" && request !== null && "title" in request ? request.title : undefined;
				this.#emitItems(transcript.note("warning", `The session is asking: ${String(title ?? "a question")}. Answer it in the omp terminal.`));
				return;
			}
			case "error":
				this.#emitItems(transcript.note("error", `Host: ${String(frame.message)}`));
				return;
			case "bye":
				this.end(`Host ended the room: ${String(frame.reason)}`);
				return;
			default:
				return;
		}
	}

	#goLive(): void {
		this.#setPhase({ phase: "live", readOnly: this.#readOnly });
		this.#emit({ kind: "items", reset: true, items: this.transcript.items() });
	}

	#emitItems(items: Item[]): void {
		if (items.length > 0) this.#emit({ kind: "items", reset: false, items });
	}

	#setPhase(phase: GuestPhase): void {
		this.phase = phase;
		this.#emit({ kind: "phase", phase });
	}
}
