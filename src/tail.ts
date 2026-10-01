/**
 * Incremental reader of one omp JSONL transcript (a session or a subagent): it
 * folds each appended line into a {@link Transcript}. The server pokes it when
 * its file changes.
 */
import type { Item } from "./shared";
import { Transcript } from "./transcript";

const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** Incremental reader of one JSONL transcript. A file that does not exist yet reads as empty until it appears. */
export class FileTail {
	transcript = new Transcript();
	readonly path: string;
	#offset = 0;
	#loaded = false;
	/** Reads and live updates run one after another, in the order they were asked for. */
	#chain: Promise<void> = Promise.resolve();
	#readQueued = false;
	readonly #emit: (reset: boolean, items: Item[]) => void;

	constructor(path: string, emit: (reset: boolean, items: Item[]) => void) {
		this.path = path;
		this.#emit = emit;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** Read what was appended since the last read. Calls that arrive before a queued read starts share it. */
	poke(): void {
		if (this.#readQueued) return;
		this.#readQueued = true;
		this.#chain = this.#chain.then(() => {
			this.#readQueued = false;
			return this.#read().catch(() => {});
		});
	}

	/**
	 * Apply live state (an agent event, a note) once the file is read up to now, so a
	 * message the file already settled is never overwritten by its stale live copy.
	 */
	live(apply: (transcript: Transcript) => Item[]): void {
		this.poke();
		this.#chain = this.#chain.then(() => this.#publish(apply(this.transcript)));
	}

	#publish(changed: Item[]): void {
		if (this.transcript.takeReordered()) this.#emit(true, this.transcript.items());
		else if (changed.length > 0) this.#emit(false, changed);
	}

	async #read(): Promise<void> {
		const file = Bun.file(this.path);
		const size = await file.stat().then(
			stat => stat.size,
			() => 0,
		);
		if (size < this.#offset) {
			// Rewritten in place (omp rewrites a file on some migrations): start over.
			this.transcript = new Transcript();
			this.#offset = 0;
			this.#loaded = false;
		}
		const bytes = size > this.#offset ? await file.slice(this.#offset, size).bytes() : new Uint8Array();
		// Only complete lines: omp may be halfway through writing the last one.
		const end = bytes.lastIndexOf(NEWLINE) + 1;
		this.#offset += end;
		const changed = end > 0 ? this.transcript.applyLines(decoder.decode(bytes.subarray(0, end)).split("\n")) : [];
		if (!this.#loaded) {
			this.#loaded = true;
			this.transcript.takeReordered();
			this.#emit(true, this.transcript.items());
		} else {
			this.#publish(changed);
		}
	}
}
