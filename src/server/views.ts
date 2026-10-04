/** What each socket watches: the views it shows, and one tail per watched view that streams the view's file to every socket showing it. */
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { FileTail } from "../tail";
import { EMPTY_WORK, type ServerMsg, type View } from "../shared";

export interface SocketData {
	/** The views this socket shows, by {@link viewKey}. */
	views: Map<string, View>;
}
export type Socket = ServerWebSocket<SocketData>;

export const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));

export const viewKey = (view: View): string =>
	view.kind === "past" ? `past:${view.sessionId}` : `live:${view.instanceId}:${view.agentId ?? ""}`;
/** Where a view's `items` and `work` go. */
const viewTopic = (key: string): string => `view:${key}`;

/** Whether the socket shows a view of live session `instanceId`, or of one of its subagents. */
export const watching = (ws: Socket, instanceId: string): boolean =>
	[...ws.data.views.values()].some(view => view.kind === "live" && view.instanceId === instanceId);

/**
 * The messages that show `view` from scratch: `tail`'s items and work once read, empty without a tail.
 * A tail still loading gives none: its first read publishes to every subscriber.
 */
function snapshot(view: View, tail: FileTail | undefined): ServerMsg[] {
	if (!tail) {
		return [
			{ t: "items", view, reset: true, items: [] },
			{ t: "work", view, work: EMPTY_WORK },
		];
	}
	if (!tail.loaded) return [];
	return [
		{ t: "items", view, reset: true, items: tail.transcript.items() },
		{ t: "work", view, work: tail.work.snapshot() },
	];
}

export class Views {
	/** Views some socket shows, with how many sockets show each; each has a tail while its file is known. */
	readonly #watched = new Map<string, { view: View; sockets: number }>();
	readonly #tails = new Map<string, FileTail>();
	readonly #pathFor: (view: View) => string | null;
	readonly #publish: (topic: string, msg: ServerMsg) => void;

	/** `pathFor` names the file a view reads, or `null` while it is not known (not listed yet, or no such session). */
	constructor(pathFor: (view: View) => string | null, publish: (topic: string, msg: ServerMsg) => void) {
		this.#pathFor = pathFor;
		this.#publish = publish;
	}

	/** Make `views` the socket's whole watch set. Views it already shows keep streaming without a fresh transcript. */
	watch(ws: Socket, views: View[]): void {
		const next = new Map(views.map(view => [viewKey(view), view]));
		const prev = ws.data.views;
		ws.data.views = next;
		for (const key of prev.keys()) {
			if (next.has(key)) continue;
			ws.unsubscribe(viewTopic(key));
			const entry = this.#watched.get(key);
			if (entry && --entry.sockets === 0) {
				this.#watched.delete(key);
				this.#tails.delete(key);
			}
		}
		const added = [...next].filter(([key]) => !prev.has(key));
		for (const [key, view] of added) {
			ws.subscribe(viewTopic(key));
			const entry = this.#watched.get(key);
			if (entry) entry.sockets++;
			else this.#watched.set(key, { view, sockets: 1 });
		}
		this.sync();
		for (const [key, view] of added) for (const msg of snapshot(view, this.#tails.get(key))) send(ws, msg);
	}

	/** Point every watched view's tail at its current file: the file shows up, the host switches sessions, a subagent registers. */
	sync(): void {
		for (const [key, { view }] of this.#watched) {
			const path = this.#pathFor(view);
			const tail = this.#tails.get(key);
			if (tail?.path === path) continue;
			this.#tails.delete(key);
			if (!path) {
				if (tail) for (const msg of snapshot(view, undefined)) this.#publish(viewTopic(key), msg);
				continue;
			}
			const next = new FileTail(
				path,
				(reset, items) => {
					if (this.#tails.get(key) === next) this.#publish(viewTopic(key), { t: "items", view, reset, items });
				},
				work => {
					if (this.#tails.get(key) === next) this.#publish(viewTopic(key), { t: "work", view, work });
				},
			);
			this.#tails.set(key, next);
			next.poke();
		}
	}

	/**
	 * The watcher does not report every append: on macOS a burst of writes can surface
	 * only as events for omp's `.<file>.lock` sidecar. Any change in a directory therefore
	 * re-reads every tail in it; a re-read with nothing new costs one `stat`.
	 */
	poke(changedPath: string): void {
		const dir = dirname(changedPath);
		for (const tail of this.#tails.values()) if (dirname(tail.path) === dir) tail.poke();
	}

	/** A live agent event of session `instanceId`'s main agent. */
	applyEvent(instanceId: string, event: unknown): void {
		this.#tails.get(viewKey({ kind: "live", instanceId, agentId: null }))?.live(t => t.applyEvent(event));
	}

	/** An out-of-band line for session `instanceId` (`agentId` null) or one of its subagents. */
	note(instanceId: string, agentId: string | null, level: "info" | "warning" | "error", text: string): void {
		this.#tails.get(viewKey({ kind: "live", instanceId, agentId }))?.live(t => t.note(level, text));
	}
}
