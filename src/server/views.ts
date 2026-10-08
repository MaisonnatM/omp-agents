/**
 * What each socket watches: the views it shows, and for each watched view one tail that streams the view's file and one
 * media tree that collects its images and its subagents', both shared by every socket showing it.
 */
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { MediaTree } from "../media";
import { FileTail } from "../tail";
import type { ServerMsg } from "../shared/protocol";
import type { View } from "../shared/sessions";

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
function snapshot(view: View, resources: { tail: FileTail; media: MediaTree } | undefined): ServerMsg[] {
	if (!resources) {
		return [
			{ t: "items", view, reset: true, items: [] },
			{ t: "work", view, reset: true, files: [] },
			{ t: "media", view, reset: true, media: [] },
		];
	}
	const { tail, media } = resources;
	return [
		...(tail.loaded
			? [
					{ t: "items", view, reset: true, items: tail.transcript.items() } as const,
					{ t: "work", view, reset: true, files: tail.files } as const,
				]
			: []),
		...(media.loaded ? [{ t: "media", view, reset: true, media: media.media } as const] : []),
	];
}

export class Views {
	/** Views some socket shows, with how many sockets show each; each has a tail and a media tree while its file is known. */
	readonly #watched = new Map<string, { view: View; sockets: number }>();
	readonly #resources = new Map<string, { tail: FileTail; media: MediaTree }>();
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
				this.#drop(key);
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
		for (const [key, view] of added) for (const msg of snapshot(view, this.#resources.get(key))) send(ws, msg);
	}

	/** Forget the tail and media tree of view `key`, and stop them publishing. */
	#drop(key: string): void {
		const resources = this.#resources.get(key);
		if (!resources) return;
		this.#resources.delete(key);
		resources.tail.close();
		resources.media.close();
	}

	/** Point every watched view's tail and media tree at its current file: the file shows up, the host switches sessions, a subagent registers. */
	sync(): void {
		for (const [key, { view }] of this.#watched) {
			const path = this.#pathFor(view);
			const previous = this.#resources.get(key);
			if (previous?.tail.path === path) continue;
			this.#drop(key);
			if (!path) {
				if (previous) for (const msg of snapshot(view, undefined)) this.#publish(viewTopic(key), msg);
				continue;
			}
			const tail = new FileTail(
				path,
				(reset, items) => this.#publish(viewTopic(key), { t: "items", view, reset, items }),
				(reset, files) => this.#publish(viewTopic(key), { t: "work", view, reset, files }),
			);
			const media = new MediaTree(path, view.kind === "live" ? view.agentId : null, (reset, list) => this.#publish(viewTopic(key), { t: "media", view, reset, media: list }));
			this.#resources.set(key, { tail, media });
			tail.poke();
			media.poke(path);
		}
	}

	/**
	 * The watcher does not report every append: on macOS a burst of writes can surface
	 * only as events for omp's `.<file>.lock` sidecar. Any change in a directory therefore
	 * re-reads every tail in it; a re-read with nothing new costs one `stat`.
	 */
	poke(changedPath: string): void {
		const dir = dirname(changedPath);
		for (const { tail, media } of this.#resources.values()) {
			if (dirname(tail.path) === dir) tail.poke();
			if (media.covers(changedPath)) media.poke(changedPath);
		}
	}

	/** A live agent event of session `instanceId`'s main agent. */
	applyEvent(instanceId: string, event: unknown): void {
		this.#resources.get(viewKey({ kind: "live", instanceId, agentId: null }))?.tail.live(t => t.applyEvent(event));
	}

	/** An out-of-band line for session `instanceId` (`agentId` null) or one of its subagents. */
	note(instanceId: string, agentId: string | null, level: "info" | "warning" | "error", text: string): void {
		this.#resources.get(viewKey({ kind: "live", instanceId, agentId }))?.tail.live(t => t.note(level, text));
	}
}
