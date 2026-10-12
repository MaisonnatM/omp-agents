/**
 * Runs each message a page tags with an `ack` once, though the page sends it again after a reconnect, and answers it on
 * whichever socket the page has open at the time.
 *
 * A page load keeps one id across its sockets. For each page the ledger keeps the replies and the `done` of every
 * request it ran until the page's `floor` passes it, the page stops waiting on it, or the page has had no socket for an
 * hour.
 */
import { errorText } from "../json";
import type { AckedFrame, ClientFrame, ClientMsg, ServerMsg } from "../shared/protocol";
import { send, type Socket, watching } from "./views";

/** How long the ledger keeps a page with no socket open. */
const KEEP_PAGE_MS = 60 * 60_000;

/** The `done` error of a request the page still waits on that this server never heard of: it restarted, or forgot the page. */
export const FORGOTTEN = "The server restarted or lost track of this page before it answered. Check whether it took effect.";

/** Where a handler answers the page that sent its message. */
export interface Peer {
	/** The socket the message came on, whose views a `watch` sets; answers go through `send` and `reply`, which follow the page to its next socket. */
	readonly socket: Socket;
	/** Send `msg` to the page. */
	send(msg: ServerMsg): void;
	/** Send `msg` to the page only while it shows a view of live session `instanceId`. */
	reply(instanceId: string, msg: ServerMsg): void;
}

/** Runs one message's handler, answering through `peer`. */
export type Run = (peer: Peer, msg: ClientMsg) => Promise<void>;

/** Reports a handler that threw for a message of type `t`. */
export type Failed = (t: ClientFrame["t"], error: unknown) => void;

type Done = Extract<ServerMsg, { t: "done" }>;

/** A reply a request sent, for a page showing live session `instanceId`, or for the page whatever it shows when `null`. */
interface Reply {
	instanceId: string | null;
	msg: ServerMsg;
}

interface Entry {
	readonly replies: Reply[];
	done: Done | null;
}

interface PageRecord {
	socket: Socket | null;
	readonly entries: Map<number, Entry>;
	expiry: Timer | undefined;
}

const deliver = (ws: Socket, { instanceId, msg }: Reply): void => {
	if (instanceId === null || watching(ws, instanceId)) send(ws, msg);
};

/** A peer that answers on `ws` alone, for a message the page does not wait on. */
const untrackedPeer = (ws: Socket): Peer => ({
	socket: ws,
	send: msg => send(ws, msg),
	reply: (instanceId, msg) => deliver(ws, { instanceId, msg }),
});

export class RequestLedger {
	readonly #pages = new Map<string, PageRecord>();
	readonly #run: Run;
	readonly #failed: Failed;

	constructor(run: Run, failed: Failed) {
		this.#run = run;
		this.#failed = failed;
	}

	/** `ws` opened: a page this server knows answers there from now on; another one becomes known at its `resume`. */
	open(ws: Socket): void {
		const page = this.#pages.get(ws.data.pageId);
		if (!page) return;
		clearTimeout(page.expiry);
		page.socket = ws;
	}

	/** `ws` closed: its page answers nowhere until it reconnects, and is forgotten if it stays away for {@link KEEP_PAGE_MS}. */
	close(ws: Socket): void {
		const id = ws.data.pageId;
		const page = this.#pages.get(id);
		if (page?.socket !== ws) return;
		page.socket = null;
		page.expiry = setTimeout(() => this.#pages.delete(id), KEEP_PAGE_MS);
		page.expiry.unref();
	}

	/** Handles one message from `ws`, settling once it is handled; a handler that throws goes to `failed`, on its one run. */
	handle(ws: Socket, frame: ClientFrame): Promise<void> {
		if (frame.t === "resume") return this.#resume(ws, frame.frames);
		if (!("ack" in frame)) return this.#run(untrackedPeer(ws), frame).catch((error: unknown) => this.#failed(frame.t, error));
		const page = this.#pages.get(ws.data.pageId);
		if (!page) {
			this.#failed(frame.t, new Error(`Page ${ws.data.pageId} sent a request before its resume.`));
			return Promise.resolve();
		}
		for (const ack of page.entries.keys()) if (ack < frame.floor) page.entries.delete(ack);
		return this.#answer(page, ws, frame);
	}

	/** A page this server does not know yet waits only on requests an earlier server got, so each is refused with {@link FORGOTTEN}. */
	async #resume(ws: Socket, frames: AckedFrame[]): Promise<void> {
		const page = this.#pages.get(ws.data.pageId);
		if (!page) {
			const forgotten = new Map(frames.map(({ ack }): [number, Entry] => [ack, { replies: [], done: { t: "done", ack, error: FORGOTTEN } }]));
			this.#pages.set(ws.data.pageId, { socket: ws, entries: forgotten, expiry: undefined });
			for (const { done } of forgotten.values()) if (done) send(ws, done);
			return;
		}
		const waiting = new Set(frames.map(frame => frame.ack));
		for (const ack of page.entries.keys()) if (!waiting.has(ack)) page.entries.delete(ack);
		await Promise.all(frames.map(frame => this.#answer(page, ws, frame)));
	}

	#answer(page: PageRecord, ws: Socket, frame: AckedFrame): Promise<void> {
		const entry = page.entries.get(frame.ack);
		if (!entry) return this.#start(page, ws, frame);
		if (!page.socket) return Promise.resolve();
		for (const reply of entry.replies) deliver(page.socket, reply);
		if (entry.done) send(page.socket, entry.done);
		return Promise.resolve();
	}

	#start(page: PageRecord, ws: Socket, frame: AckedFrame): Promise<void> {
		const entry: Entry = { replies: [], done: null };
		page.entries.set(frame.ack, entry);
		const record = (reply: Reply): void => {
			entry.replies.push(reply);
			if (page.socket) deliver(page.socket, reply);
		};
		const settle = (error: string | null): void => {
			entry.done = { t: "done", ack: frame.ack, error };
			if (page.socket) send(page.socket, entry.done);
		};
		return this.#run({ socket: ws, send: msg => record({ instanceId: null, msg }), reply: (instanceId, msg) => record({ instanceId, msg }) }, frame).then(
			() => settle(null),
			(error: unknown) => {
				settle(errorText(error));
				this.#failed(frame.t, error);
			},
		);
	}
}
