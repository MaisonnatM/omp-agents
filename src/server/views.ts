/**
 * What each socket watches: the views it shows, and for each watched view one tail that streams the view's file and one
 * media tree that collects its images and its subagents', both shared by every socket showing it. A view whose
 * Trajectory tab some socket shows also gets one trajectory tail, shared the same way.
 */
import { dirname } from "node:path";
import type { ServerWebSocket } from "bun";
import { MediaTree } from "../media";
import { FileTail } from "../tail";
import { TrajectoryTail } from "../trajectory";
import type { StartingPrompt } from "../transcript";
import type { ServerMsg } from "../shared/protocol";
import type { View } from "../shared/sessions";

export interface SocketData {
	/** The views this socket shows, by {@link viewKey}. */
	views: Map<string, View>;
	/** The views whose Trajectory this socket shows, by {@link viewKey}. */
	trajectories: Map<string, View>;
	/** The id of the page load this socket belongs to, the same across its reconnects. */
	pageId: string;
}
export type Socket = ServerWebSocket<SocketData>;

export const send = (ws: Socket, msg: ServerMsg): void => void ws.send(JSON.stringify(msg));

export const viewKey = (view: View): string =>
	view.kind === "past" ? `past:${view.sessionId}` : `live:${view.instanceId}:${view.agentId ?? ""}`;
/** Where a view's `items`, `work`, and `media` go. */
const viewTopic = (key: string): string => `view:${key}`;
/** Where a view's `turns` go. */
const turnsTopic = (key: string): string => `turns:${key}`;

/** The views some socket watches, by {@link viewKey}, with how many sockets watch each. */
type Watchers = Map<string, { view: View; sockets: number }>;

/**
 * Make `views` the socket's whole set in `field`: it follows each new view's `topic` and leaves the dropped ones', and a
 * view no socket watches any more is handed to `drop`. Returns the views it added.
 */
function rejoin(ws: Socket, field: "views" | "trajectories", views: View[], watchers: Watchers, topic: (key: string) => string, drop: (key: string) => void): [string, View][] {
	const next = new Map(views.map(view => [viewKey(view), view]));
	const prev = ws.data[field];
	ws.data[field] = next;
	for (const key of prev.keys()) {
		if (next.has(key)) continue;
		ws.unsubscribe(topic(key));
		const entry = watchers.get(key);
		if (entry && --entry.sockets === 0) {
			watchers.delete(key);
			drop(key);
		}
	}
	const added = [...next].filter(([key]) => !prev.has(key));
	for (const [key, view] of added) {
		ws.subscribe(topic(key));
		const entry = watchers.get(key);
		if (entry) entry.sockets++;
		else watchers.set(key, { view, sockets: 1 });
	}
	return added;
}

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
			{ t: "items", view, reset: true, items: [], removed: [] },
			{ t: "work", view, reset: true, files: [] },
			{ t: "media", view, reset: true, media: [], sources: [] },
		];
	}
	const { tail, media } = resources;
	return [
		...(tail.loaded
			? ([
					{ t: "items", view, reset: true, items: tail.transcript.items(), removed: [] },
					{ t: "work", view, reset: true, files: tail.files },
				] satisfies ServerMsg[])
			: []),
		...(media.loaded ? [{ t: "media", view, reset: true, media: media.media, sources: media.sources } as const] : []),
	];
}

export class Views {
	/** Views some socket shows, with how many sockets show each; each has a tail and a media tree while its file is known. */
	readonly #watched: Watchers = new Map();
	readonly #resources = new Map<string, { tail: FileTail; media: MediaTree }>();
	/** Views some socket shows the Trajectory of; each has a trajectory tail while its file is known. */
	readonly #trajectoryWatched: Watchers = new Map();
	readonly #trajectories = new Map<string, TrajectoryTail>();
	readonly #pathFor: (view: View) => string | null;
	readonly #publish: (topic: string, msg: ServerMsg) => void;
	readonly #startingFor: (instanceId: string) => StartingPrompt | null;

	/**
	 * `pathFor` names the file a view reads, or `null` while it is not known (not listed yet, or no such session).
	 * `startingFor` names a session's starting prompt, which its main view shows last.
	 */
	constructor(pathFor: (view: View) => string | null, publish: (topic: string, msg: ServerMsg) => void, startingFor: (instanceId: string) => StartingPrompt | null) {
		this.#pathFor = pathFor;
		this.#publish = publish;
		this.#startingFor = startingFor;
	}

	/**
	 * Make `views` the socket's whole watch set, and `trajectories` the views whose turns it shows. Views it already shows
	 * keep streaming without a fresh transcript or fresh turns.
	 */
	watch(ws: Socket, views: View[], trajectories: View[]): void {
		const added = rejoin(ws, "views", views, this.#watched, viewTopic, key => this.#drop(key));
		const addedTrajectories = rejoin(ws, "trajectories", trajectories, this.#trajectoryWatched, turnsTopic, key => {
			this.#trajectories.get(key)?.close();
			this.#trajectories.delete(key);
		});
		this.sync();
		for (const [key, view] of added) for (const msg of snapshot(view, this.#resources.get(key))) send(ws, msg);
		for (const [key, view] of addedTrajectories) {
			const tail = this.#trajectories.get(key);
			// A tail still loading gives none: its first read publishes to every subscriber.
			if (!tail || tail.loaded) send(ws, { t: "turns", view, reset: true, turns: tail?.turns() ?? [] });
		}
	}

	/** Forget the tail and media tree of view `key`, and stop them publishing. */
	#drop(key: string): void {
		const resources = this.#resources.get(key);
		if (!resources) return;
		this.#resources.delete(key);
		resources.tail.close();
		resources.media.close();
	}

	/** Point every watched view's tail, media tree, and trajectory tail at its current file: the file shows up, the host switches sessions, a subagent registers. */
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
				(reset, items, removed) => this.#publish(viewTopic(key), { t: "items", view, reset, items, removed }),
				(reset, files) => this.#publish(viewTopic(key), { t: "work", view, reset, files }),
			);
			const media = new MediaTree(path, view.kind === "live" ? view.agentId : null, (reset, list, sources) => this.#publish(viewTopic(key), { t: "media", view, reset, media: list, sources }));
			this.#resources.set(key, { tail, media });
			tail.poke();
			media.poke(path);
			if (view.kind === "live" && view.agentId === null) this.starting(view.instanceId);
		}
		for (const [key, { view }] of this.#trajectoryWatched) {
			const path = this.#pathFor(view);
			const previous = this.#trajectories.get(key);
			if (previous?.path === path) continue;
			previous?.close();
			this.#trajectories.delete(key);
			if (!path) {
				if (previous) this.#publish(turnsTopic(key), { t: "turns", view, reset: true, turns: [] });
				continue;
			}
			const tail = new TrajectoryTail(path, (reset, turns) => this.#publish(turnsTopic(key), { t: "turns", view, reset, turns }));
			this.#trajectories.set(key, tail);
			tail.poke();
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
		for (const tail of this.#trajectories.values()) if (dirname(tail.path) === dir) tail.poke();
	}

	/** A live agent event of session `instanceId`'s main agent. */
	applyEvent(instanceId: string, event: unknown): void {
		this.#resources.get(viewKey({ kind: "live", instanceId, agentId: null }))?.tail.live(t => [...t.applyEvent(event), ...t.setStarting(this.#startingFor(instanceId))]);
	}

	/** Session `instanceId`'s starting prompt changed. */
	starting(instanceId: string): void {
		this.#resources.get(viewKey({ kind: "live", instanceId, agentId: null }))?.tail.live(t => t.setStarting(this.#startingFor(instanceId)));
	}

	/** An out-of-band line for session `instanceId` (`agentId` null) or one of its subagents. */
	note(instanceId: string, agentId: string | null, level: "info" | "warning" | "error", text: string): void {
		this.#resources.get(viewKey({ kind: "live", instanceId, agentId }))?.tail.live(t => t.note(level, text));
	}
}
