/** Sessions this dashboard started that stopped without **End session**: with the server, or on their own. A file keeps them across restarts. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";

interface Saved {
	/** The dashboard sessions that ran when the file was last written. */
	running: string[];
	interrupted: string[];
	/** Those of both lists whose turn ran when they were last seen. */
	working: string[];
}

const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

function load(path: string): Saved {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
		return { running: [], interrupted: [], working: [] };
	}
	try {
		const value: unknown = JSON.parse(text);
		// Files written before `working` existed read as sessions that were all idle.
		const working = isObject(value) ? (value.working ?? []) : undefined;
		if (isObject(value) && isTexts(value.running) && isTexts(value.interrupted) && isTexts(working)) {
			return { running: value.running, interrupted: value.interrupted, working };
		}
	} catch {}
	console.error(`omp-agents: ignoring ${path}, which is not a list of interrupted sessions`);
	return { running: [], interrupted: [], working: [] };
}

export class InterruptedSessions {
	readonly #path: string;
	/** The dashboard sessions that run now, each with whether its turn runs. The file keeps them, so the next start finds the ones the server went down with. */
	#running = new Map<string, boolean>();
	/** Each with whether its turn ran when it stopped. */
	readonly #interrupted: Map<string, boolean>;

	constructor(path: string) {
		this.#path = path;
		const saved = load(path);
		const working = new Set(saved.working);
		// The sessions that ran when the last server stopped stopped with it.
		this.#interrupted = new Map([...saved.interrupted, ...saved.running].map(id => [id, working.has(id)]));
		if (saved.running.length > 0) this.#save();
	}

	has(sessionId: string): boolean {
		return this.#interrupted.has(sessionId);
	}

	/** Whether interrupted session `sessionId` stopped while its turn ran. */
	stoppedMidTurn(sessionId: string): boolean {
		return this.#interrupted.get(sessionId) === true;
	}

	/** The dashboard sessions that run now, each with whether its turn runs. A session that runs again, once resumed, is no longer interrupted. */
	setRunning(sessions: ReadonlyMap<string, boolean>): void {
		let changed = this.#running.size !== sessions.size || [...sessions].some(([id, working]) => this.#running.get(id) !== working);
		for (const id of sessions.keys()) if (this.#interrupted.delete(id)) changed = true;
		this.#running = new Map(sessions);
		if (changed) this.#save();
	}

	/** Session `sessionId` stopped, but nobody ended it. Its turn ran if it last ran in {@link setRunning} with one. */
	interrupt(sessionId: string): void {
		if (this.#interrupted.has(sessionId)) return;
		this.#interrupted.set(sessionId, this.#running.get(sessionId) === true);
		this.#save();
	}

	/** Session `sessionId` moves to the past sessions; whether it was interrupted. */
	dismiss(sessionId: string): boolean {
		if (!this.#interrupted.delete(sessionId)) return false;
		this.#save();
		return true;
	}

	/** Written beside and renamed over the file, so a crash mid-write leaves the last complete list. */
	#save(): void {
		const saved: Saved = {
			running: [...this.#running.keys()],
			interrupted: [...this.#interrupted.keys()],
			working: [...this.#running, ...this.#interrupted].flatMap(([id, working]) => (working ? [id] : [])),
		};
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
