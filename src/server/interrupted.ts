/** Sessions this dashboard started that stopped without **End session**: with the server, or on their own. A file keeps them across restarts. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";

interface Saved {
	/** The dashboard sessions that ran when the file was last written. */
	running: string[];
	interrupted: string[];
}

const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

function load(path: string): Saved {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
		return { running: [], interrupted: [] };
	}
	try {
		const value: unknown = JSON.parse(text);
		if (isObject(value) && isTexts(value.running) && isTexts(value.interrupted)) return { running: value.running, interrupted: value.interrupted };
	} catch {}
	console.error(`omp-agents: ignoring ${path}, which is not a list of interrupted sessions`);
	return { running: [], interrupted: [] };
}

export class InterruptedSessions {
	readonly #path: string;
	/** Session ids of the dashboard sessions that run now. The file keeps them, so the next start finds the ones the server went down with. */
	#running = new Set<string>();
	readonly #interrupted: Set<string>;

	constructor(path: string) {
		this.#path = path;
		const saved = load(path);
		// The sessions that ran when the last server stopped stopped with it.
		this.#interrupted = new Set([...saved.interrupted, ...saved.running]);
		if (saved.running.length > 0) this.#save();
	}

	has(sessionId: string): boolean {
		return this.#interrupted.has(sessionId);
	}

	/** The dashboard sessions that run now. A session that runs again, once resumed, is no longer interrupted. */
	setRunning(sessionIds: ReadonlySet<string>): void {
		let changed = this.#running.size !== sessionIds.size || [...sessionIds].some(id => !this.#running.has(id));
		for (const id of sessionIds) if (this.#interrupted.delete(id)) changed = true;
		this.#running = new Set(sessionIds);
		if (changed) this.#save();
	}

	/** Session `sessionId` stopped, but nobody ended it. */
	interrupt(sessionId: string): void {
		if (this.#interrupted.has(sessionId)) return;
		this.#interrupted.add(sessionId);
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
		const saved: Saved = { running: [...this.#running], interrupted: [...this.#interrupted] };
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
