/**
 * What each socket watches: the views it shows, and for each watched view one tail that streams the view's file and one
 * media tree that collects its images and its subagents', both shared by every socket showing it.
 */
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { MediaTree } from "../media";
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
/** Where a view's `items`, `work`, and `media` go. */
const viewTopic = (key: string): string => `view:${key}`;

/** Whether the socket shows a view of live session `instanceId`, or of one of its subagents. */
export const watching = (ws: Socket, instanceId: string): boolean =>
	[...ws.data.views.values()].some(view => view.kind === "live" && view.instanceId === instanceId);

/**
 * The messages that show `view` from scratch: `tail`'s items and work and `media`'s images once read, empty without a
 * file. A tail or tree still loading gives none: its first read publishes to every subscriber.
 */
function snapshot(view: View, tail: FileTail | undefined, media: MediaTree | undefined): ServerMsg[] {
	if (!tail || !media) {
		return [
			{ t: "items", view, reset: true, items: [] },
			{ t: "work", view, work: EMPTY_WORK },
			{ t: "media", view, media: [] },
		];
	}
	return [
		...(tail.loaded
			? [
					{ t: "items", view, reset: true, items: tail.transcript.items() } as const,
					{ t: "work", view, work: tail.work } as const,
				]
			: []),
		...(media.loaded ? [{ t: "media", view, media: media.media } as const] : []),
	];
}

export class Views {
	/** Views some socket shows, with how many sockets show each; each has a tail and a media tree while its file is known. */
	readonly #watched = new Map<string, { view: View; sockets: number }>();
	readonly #tails = new Map<string, FileTail>();
	readonly #media = new Map<string, MediaTree>();
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
				this.#media.delete(key);
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
		for (const [key, view] of added) for (const msg of snapshot(view, this.#tails.get(key), this.#media.get(key))) send(ws, msg);
	}

	/** Point every watched view's tail and media tree at its current file: the file shows up, the host switches sessions, a subagent registers. */
	sync(): void {
		for (const [key, { view }] of this.#watched) {
			const path = this.#pathFor(view);
			const tail = this.#tails.get(key);
			if (tail?.path === path) continue;
			this.#tails.delete(key);
			this.#media.delete(key);
			if (!path) {
				if (tail) for (const msg of snapshot(view, undefined, undefined)) this.#publish(viewTopic(key), msg);
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
			const media = new MediaTree(path, view.kind === "live" ? view.agentId : null, list => {
				if (this.#media.get(key) === media) this.#publish(viewTopic(key), { t: "media", view, media: list });
			});
			this.#tails.set(key, next);
			this.#media.set(key, media);
			next.poke();
			media.poke();
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
		for (const media of this.#media.values()) if (media.covers(changedPath)) media.poke();
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
