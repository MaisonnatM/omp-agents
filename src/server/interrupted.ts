/**
 * Sessions this dashboard started that stopped without **End session**: on their own, or with the computer while no server
 * watched them. A file keeps them across restarts. A session survives a server's exit, and the next server attaches to it.
 */
import { JsonFile } from "../fs";
import { isObject, isTexts } from "../json";

interface SessionState {
	/** Stopped without **End session**; otherwise it runs now. */
	interrupted: boolean;
	/** Its turn runs now, or ran when it stopped. */
	working: boolean;
}

interface Saved {
	sessions: Array<{ id: string } & SessionState>;
}

const isSaved = (value: unknown): value is Saved =>
	isObject(value) &&
	Array.isArray(value.sessions) &&
	value.sessions.every(
		(entry: unknown) =>
			isObject(entry) && typeof entry.id === "string" && typeof entry.interrupted === "boolean" && typeof entry.working === "boolean",
	);

/** Files written before one entry per session held three lists: `running`, `interrupted`, and, once turns were tracked, `working`. */
function fromLists(value: unknown): Saved | null {
	if (!isObject(value)) return null;
	const working = value.working ?? [];
	if (!(isTexts(value.running) && isTexts(value.interrupted) && isTexts(working))) return null;
	const busy = new Set(working);
	const entry = (interrupted: boolean) => (id: string) => ({ id, interrupted, working: busy.has(id) });
	return { sessions: [...value.interrupted.map(entry(true)), ...value.running.map(entry(false))] };
}

export class InterruptedSessions {
	readonly #file: JsonFile<Saved>;
	/**
	 * The dashboard sessions that run now, and those that stopped without **End session**. The file keeps them, so the
	 * next start finds the ones that ran when the last server stopped, and learns which of them survived it.
	 */
	readonly #sessions: Map<string, SessionState>;
	/**
	 * The sessions that ran when the last server stopped, until {@link recover} learned which of them survived it. A
	 * session this server starts before then reports without them, so {@link setRunning} leaves them alone until then.
	 */
	#lastServer: ReadonlySet<string>;
	/** The sessions that ran when the last server stopped and did not survive it. */
	#stoppedWithServer: ReadonlySet<string> = new Set();

	constructor(path: string) {
		this.#file = new JsonFile(path, {
			parse: value => (isSaved(value) ? value : fromLists(value)),
			holds: "a list of interrupted sessions",
			onInvalid: "ignore",
		});
		const saved = this.#file.load()?.sessions ?? [];
		this.#sessions = new Map(saved.map(({ id, interrupted, working }) => [id, { interrupted, working }]));
		this.#lastServer = new Set(saved.flatMap(({ id, interrupted }) => (interrupted ? [] : [id])));
	}

	/**
	 * The server started and attached to the sessions `survived` names, which run on. The others that ran when the last
	 * server stopped are interrupted, with the turn state they last had: their omp exited while no server watched.
	 */
	recover(survived: ReadonlySet<string>): void {
		const stopped = new Set<string>();
		for (const id of this.#lastServer) {
			const state = this.#sessions.get(id);
			if (!state || state.interrupted || survived.has(id)) continue;
			this.#sessions.set(id, { interrupted: true, working: state.working });
			stopped.add(id);
		}
		this.#lastServer = new Set();
		this.#stoppedWithServer = stopped;
		if (stopped.size > 0) this.#save();
	}

	/** Whether session `sessionId` ran when the last server stopped, and did not survive it. */
	stoppedWithServer(sessionId: string): boolean {
		return this.#stoppedWithServer.has(sessionId);
	}

	has(sessionId: string): boolean {
		return this.#sessions.get(sessionId)?.interrupted === true;
	}

	/** Whether interrupted session `sessionId` stopped while its turn ran. */
	stoppedMidTurn(sessionId: string): boolean {
		const state = this.#sessions.get(sessionId);
		return state?.interrupted === true && state.working;
	}

	/** The dashboard sessions that run now, each with whether its turn runs. A session that runs again, once resumed, is no longer interrupted. */
	setRunning(sessions: ReadonlyMap<string, boolean>): void {
		let changed = false;
		for (const [id, state] of this.#sessions) {
			if (state.interrupted || sessions.has(id) || this.#lastServer.has(id)) continue;
			this.#sessions.delete(id);
			changed = true;
		}
		for (const [id, working] of sessions) {
			const state = this.#sessions.get(id);
			if (state && !state.interrupted && state.working === working) continue;
			this.#sessions.set(id, { interrupted: false, working });
			changed = true;
		}
		if (changed) this.#save();
	}

	/** Session `sessionId` stopped, but nobody ended it. Its turn ran if it last ran in {@link setRunning} with one. */
	interrupt(sessionId: string): void {
		const state = this.#sessions.get(sessionId);
		if (state?.interrupted) return;
		this.#sessions.set(sessionId, { interrupted: true, working: state?.working === true });
		this.#save();
	}

	/** Session `sessionId` moves to the past sessions; whether it was interrupted. */
	dismiss(sessionId: string): boolean {
		if (!this.has(sessionId)) return false;
		this.#sessions.delete(sessionId);
		this.#save();
		return true;
	}

	#save(): void {
		this.#file.save({ sessions: [...this.#sessions].map(([id, state]) => ({ id, ...state })) });
	}
}
