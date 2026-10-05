/**
 * What every socket hears on the `roster` topic: the roster, the past-session list, plan usage, and the Todo tab's list.
 * Each push publishes only what changed since the last one. Roster and past pushes wait for a listener;
 * a socket that subscribes gets all four at once.
 */
import { errorText } from "../json";
import type { ServerMsg } from "../shared";
import { fetchPlanUsage } from "../usage";
import { type Socket, send } from "./views";

const TOPIC = "roster";
/** Coalesce bursts of subagent progress into one roster push. */
const ROSTER_PUSH_MS = 150;

type Broadcast = Extract<ServerMsg, { t: "roster" | "past" | "usage" | "user-todos" }>;

export interface BroadcastDeps {
	rosterMsg(): Extract<ServerMsg, { t: "roster" }>;
	pastMsg(): Extract<ServerMsg, { t: "past" }>;
	userTodosMsg(): Extract<ServerMsg, { t: "user-todos" }>;
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
	/** The last message of each kind published; empty for roster and past while nobody listens, empty for usage until `omp usage` first answers, and for the todos until they first change. */
	readonly #last: Record<Broadcast["t"], string> = { roster: "", past: "", usage: "", "user-todos": "" };
	#rosterPush: NodeJS.Timeout | undefined;

	constructor(deps: BroadcastDeps) {
		this.#deps = deps;
	}

	/** Whether any socket listens. Pushes, and the work to compare them with the last one, wait for the first. */
	listening(): boolean {
		return this.#deps.subscriberCount(TOPIC) > 0;
	}

	/** Subscribe `ws` and send it the current roster, past list, usage, and todos. */
	open(ws: Socket): void {
		ws.subscribe(TOPIC);
		send(ws, this.#deps.rosterMsg());
		send(ws, this.#deps.pastMsg());
		if (this.#last.usage) ws.send(this.#last.usage);
		send(ws, this.#deps.userTodosMsg());
	}

	/** A dashboard session started or exited: save which run, then push the roster and the past list. */
	syncRoster(): void {
		this.#deps.saveRunning();
		this.pushAll();
	}

	/** A turn started or ended, or a subagent progressed: saved at once, so a crash right after still knows it; pushed debounced through {@link ROSTER_PUSH_MS}. */
	rosterChanged(): void {
		this.#deps.saveRunning();
		this.#rosterPush ??= setTimeout(() => this.#pushRoster(), ROSTER_PUSH_MS);
	}

	pushAll(): void {
		this.#pushRoster();
		this.pushPast();
	}

	pushPast(): void {
		if (!this.listening()) {
			this.#last.past = "";
			return;
		}
		this.#publishChanged(this.#deps.pastMsg());
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

	/** Also stands in for a pending debounced push: a burst of roster updates costs one sync and one push. */
	#pushRoster(): void {
		clearTimeout(this.#rosterPush);
		this.#rosterPush = undefined;
		if (!this.listening()) {
			this.#last.roster = "";
			return;
		}
		this.#deps.beforeRosterPush();
		this.#publishChanged(this.#deps.rosterMsg());
	}

	#publishChanged(msg: Broadcast): void {
		const json = JSON.stringify(msg);
		if (json === this.#last[msg.t]) return;
		this.#last[msg.t] = json;
		this.#deps.publish(TOPIC, json);
	}
}
