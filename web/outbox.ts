/**
 * The messages the page waits on the server to answer, each tagged with an `ack` the server answers with its `done`.
 * They outlive the socket: each one a closed socket carried is asked for again on the next, and a write made while no
 * socket was open goes out on the next one.
 */
import type { AckedFrame, ClientMsg, ResumeFrame } from "../src/shared/protocol";

/** The part of a WebSocket the outbox uses. */
export type OutboxSocket = Pick<WebSocket, "readyState" | "send">;

interface Waiting {
	frame: AckedFrame;
	/** Whether a socket carried the frame, so the server may have run it; one that waited for a socket goes out after the resume. */
	sent: boolean;
	resolve: () => void;
	reject: (error: Error) => void;
}

export class Outbox {
	#next = 0;
	readonly #waiting = new Map<number, Waiting>();
	readonly #socket: () => OutboxSocket | null;
	readonly #record: (msg: ClientMsg) => void;

	/** `socket`: the page's socket now, if any; `record`: told of each message the outbox takes. */
	constructor(socket: () => OutboxSocket | null, record: (msg: ClientMsg) => void) {
		this.#socket = socket;
		this.#record = record;
	}

	/** Sends `msg` and settles once the server has handled it: rejects with the server's error, or at once while disconnected. */
	request(msg: ClientMsg): Promise<void> {
		if (this.#open() === null) return Promise.reject(new Error("Not connected to the server."));
		return this.write(msg);
	}

	/** Sends `msg` now, or on the next socket while none is open, and settles once the server has handled it. */
	write(msg: ClientMsg): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const ack = this.#next++;
		const frame: AckedFrame = { ...msg, ack, floor: Math.min(ack, ...this.#waiting.keys()) };
		const ws = this.#open();
		this.#waiting.set(ack, { frame, sent: ws !== null, resolve, reject });
		ws?.send(JSON.stringify(frame));
		this.#record(msg);
		return promise;
	}

	/** `ws` opened: asks again for every frame an earlier socket carried, then sends those that waited for a socket, oldest first. */
	resume(ws: OutboxSocket): void {
		const waiting = [...this.#waiting.values()];
		ws.send(JSON.stringify({ t: "resume", frames: waiting.filter(entry => entry.sent).map(entry => entry.frame) } satisfies ResumeFrame));
		for (const entry of waiting) {
			if (entry.sent) continue;
			entry.sent = true;
			ws.send(JSON.stringify(entry.frame));
		}
	}

	/** The server's `done` for `ack`: `error` is `null` when the message took effect. */
	settle(ack: number, error: string | null): void {
		const waiting = this.#waiting.get(ack);
		this.#waiting.delete(ack);
		if (error === null) waiting?.resolve();
		else waiting?.reject(new Error(error));
	}

	#open(): OutboxSocket | null {
		const ws = this.#socket();
		return ws?.readyState === WebSocket.OPEN ? ws : null;
	}
}
