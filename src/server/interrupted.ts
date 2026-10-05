/** Sessions this dashboard started that stopped without **End session**: with the server, or on their own. A file keeps them across restarts. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";

interface SessionState {
	/** Stopped without **End session**; otherwise it runs now. */
	interrupted: boolean;
	/** Its turn runs now, or ran when it stopped. */
	working: boolean;
}

interface Saved {
	sessions: Array<{ id: string } & SessionState>;
}

const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

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

function load(path: string): Saved {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
		return { sessions: [] };
	}
	try {
		const value: unknown = JSON.parse(text);
		const saved = isSaved(value) ? value : fromLists(value);
		if (saved) return saved;
	} catch {}
	console.error(`omp-agents: ignoring ${path}, which is not a list of interrupted sessions`);
	return { sessions: [] };
}

export class InterruptedSessions {
	readonly #path: string;
	/**
	 * The dashboard sessions that run now, and those that stopped without **End session**. The file keeps
	 * them, so the next start finds the ones the server went down with.
	 */
	readonly #sessions: Map<string, SessionState>;

	constructor(path: string) {
		this.#path = path;
		const saved = load(path).sessions;
		// The sessions that ran when the last server stopped stopped with it.
		this.#sessions = new Map(saved.map(({ id, working }) => [id, { interrupted: true, working }]));
		if (saved.some(session => !session.interrupted)) this.#save();
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
			if (state.interrupted || sessions.has(id)) continue;
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

	/** Written beside and renamed over the file, so a crash mid-write leaves the last complete list. */
	#save(): void {
		const saved: Saved = { sessions: [...this.#sessions].map(([id, state]) => ({ id, ...state })) };
		const temp = `${this.#path}.tmp`;
		try {
			mkdirSync(dirname(this.#path), { recursive: true });
			writeFileSync(temp, `${JSON.stringify(saved)}\n`);
			renameSync(temp, this.#path);
		} catch (err) {
			console.error(`omp-agents: cannot write ${this.#path}: ${errorText(err)}`);
		}
	}
}
