/**
 * What every socket hears on the `roster` topic: the roster, the past-session list, plan usage, the Todo page's list,
 * the routines, the projects, and the notices. Each push publishes only what changed since the last one: the roster and
 * the past list as the rows that changed, joined, or left, the rest whole. Roster and past pushes wait for a listener; a
 * socket that subscribes gets all seven at once, the two lists whole.
 */
import { errorText } from "../json";
import type { ServerMsg } from "../shared/protocol";
import type { PastSession, RosterHost } from "../shared/sessions";
import { fetchPlanUsage } from "../usage";
import { type Socket, send } from "./views";

const TOPIC = "roster";
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;

type Broadcast = Extract<ServerMsg, { t: "usage" | "user-todos" | "routines" | "projects" | "notices" }>;

export interface BroadcastDeps {
	/** The rows of the live sessions, and why the registry could not be listed, if it could not. */
	roster(): { hosts: RosterHost[]; error: string | null };
	past(): PastSession[];
	userTodosMsg(): Extract<ServerMsg, { t: "user-todos" }>;
	routinesMsg(): Extract<ServerMsg, { t: "routines" }>;
	projectsMsg(): Extract<ServerMsg, { t: "projects" }>;
	noticesMsg(): Extract<ServerMsg, { t: "notices" }>;
	/** Publishes `json` on the `roster` topic. */
	publish(topic: string, json: string): void;
	subscriberCount(topic: string): number;
	/** Runs before each roster push: a subagent may have registered for a view that waits on its file. */
	beforeRosterPush(): void;
	/** Saves which dashboard sessions run now, and whether each one's turn runs. */
	saveRunning(): void;
}

export class Broadcasts {
	readonly #deps: BroadcastDeps;
	/** The last message of each kind published, empty for usage until `omp usage` first answers, and for the todos, routines, projects, and notices until they first change. */
	readonly #last: Record<Broadcast["t"], string> = { usage: "", "user-todos": "", routines: "", projects: "", notices: "" };
	/** The roster as the listeners last heard it, and its registry error. */
	readonly #roster = new HeardList<RosterHost>(host => host.instanceId);
	#rosterError: string | null = null;
	/** The past list as the listeners last heard it. */
	readonly #past = new HeardList<PastSession>(session => session.sessionId);
	#rosterPush: NodeJS.Timeout | undefined;

	constructor(deps: BroadcastDeps) {
		this.#deps = deps;
	}

	/** Whether any socket listens. Pushes, and the work to compare them with the last one, wait for the first. */
	listening(): boolean {
		return this.#deps.subscriberCount(TOPIC) > 0;
	}

	/** Subscribe `ws` and send it the current roster, past list, usage, todos, routines, projects, and notices. */
	open(ws: Socket): void {
		// The sockets that listen already hear what changed first, so the lists `ws` starts from are theirs too.
		const roster = this.#syncRoster();
		const past = this.#syncPast();
		ws.subscribe(TOPIC);
		send(ws, roster);
		send(ws, { t: "past", reset: true, sessions: past, removed: [] });
		if (this.#last.usage) ws.send(this.#last.usage);
		send(ws, this.#deps.userTodosMsg());
		send(ws, this.#deps.routinesMsg());
		send(ws, this.#deps.projectsMsg());
		send(ws, this.#deps.noticesMsg());
	}

	/** A dashboard session started or exited: save which run, then push the roster and the past list. */
	syncRoster(): void {
		this.#deps.saveRunning();
		this.pushAll();
	}

	/** A turn started or ended, or a subagent progressed: saved at once, so a crash right after still knows it; pushed debounced through {@link ROSTER_PUSH_MS}. */
	rosterChanged(): void {
		this.#deps.saveRunning();
		this.#rosterPush ??= setTimeout(() => this.pushRoster(), ROSTER_PUSH_MS);
	}

	/** Something both lists show changed, such as a session's pull requests. */
	pushAll(): void {
		this.pushRoster();
		this.pushPast();
	}

	/** Publish the sessions of the past list that changed, joined, or left since the listeners last heard it. */
	pushPast(): void {
		if (this.listening()) this.#syncPast();
	}

	/** Run `omp usage` and publish its report, or why it failed. */
	async refreshUsage(): Promise<void> {
		try {
			this.#publishChanged({ t: "usage", plans: await fetchPlanUsage(), error: null });
		} catch (err) {
			this.#publishChanged({ t: "usage", plans: [], error: errorText(err) });
		}
	}

	pushUserTodos(): void {
		this.#publishChanged(this.#deps.userTodosMsg());
	}

	pushRoutines(): void {
		this.#publishChanged(this.#deps.routinesMsg());
	}

	pushProjects(): void {
		this.#publishChanged(this.#deps.projectsMsg());
	}

	pushNotices(): void {
		this.#publishChanged(this.#deps.noticesMsg());
	}

	/** Also stands in for a pending debounced push: a burst of roster updates costs one sync and one push. */
	pushRoster(): void {
		clearTimeout(this.#rosterPush);
		this.#rosterPush = undefined;
		if (!this.listening()) return;
		this.#deps.beforeRosterPush();
		this.#syncRoster();
	}

	/** The roster now; the listeners hear the rows that changed, joined, or left since they last heard it, or the registry error if that changed. */
	#syncRoster(): Extract<ServerMsg, { t: "roster" }> {
		const { hosts, error } = this.#deps.roster();
		const { changed, removed } = this.#roster.sync(hosts);
		const errorChanged = error !== this.#rosterError;
		this.#rosterError = error;
		if (this.listening() && (changed.length > 0 || removed.length > 0 || errorChanged)) {
			this.#deps.publish(TOPIC, JSON.stringify({ t: "roster", reset: false, hosts: changed, removed, error } satisfies ServerMsg));
		}
		return { t: "roster", reset: true, hosts, removed: [], error };
	}

	/** The past list now; the listeners hear what changed since they last heard it. */
	#syncPast(): PastSession[] {
		const sessions = this.#deps.past();
		const { changed, removed } = this.#past.sync(sessions);
		if (this.listening() && (changed.length > 0 || removed.length > 0)) {
			this.#deps.publish(TOPIC, JSON.stringify({ t: "past", reset: false, sessions: changed, removed } satisfies ServerMsg));
		}
		return sessions;
	}

	#publishChanged(msg: Broadcast): void {
		const json = JSON.stringify(msg);
		if (json === this.#last[msg.t]) return;
		this.#last[msg.t] = json;
		this.#deps.publish(TOPIC, json);
	}
}

/** A keyed list as the listeners last heard it: each entry's JSON, by key. */
class HeardList<T> {
	readonly #keyOf: (entry: T) => string;
	#heard = new Map<string, string>();

	constructor(keyOf: (entry: T) => string) {
		this.#keyOf = keyOf;
	}

	/** The entries of `entries` that changed or joined since the last sync, and the keys that left; `entries` is what the listeners have heard from now on. */
	sync(entries: readonly T[]): { changed: T[]; removed: string[] } {
		const next = new Map(entries.map(entry => [this.#keyOf(entry), JSON.stringify(entry)]));
		const changed = entries.filter(entry => {
			const key = this.#keyOf(entry);
			return this.#heard.get(key) !== next.get(key);
		});
		const removed = [...this.#heard.keys()].filter(key => !next.has(key));
		this.#heard = next;
		return { changed, removed };
	}
}
