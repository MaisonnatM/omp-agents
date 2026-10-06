/**
 * Incremental reader of one omp JSONL transcript (a session or a subagent): it
 * folds each appended line into a {@link Transcript} and a {@link Work}. The
 * server pokes it when its file changes.
 */
import { LineReader, ReadQueue } from "./line-reader";
import type { ChangedFile, Item } from "./shared/transcript";
import { Transcript } from "./transcript";
import { Work } from "./work";

/** Streamed text arrives as one update per token; its updates are published at most this often. */
const PUBLISH_WINDOW_MS = 50;

/** Whether a message is still being written, so that another update of it is likely to follow within the window. */
const inFlux = (item: Item): boolean => (item.kind === "assistant" && item.streaming) || (item.kind === "tool" && item.status === "running");

/** Folds a transcript's appended entries into a {@link Transcript} and a {@link Work} and publishes their changes; {@link LineReader} reads the file. */
export class FileTail {
	transcript = new Transcript();
	#work = new Work();
	readonly path: string;
	readonly #lines: LineReader;
	#loaded = false;
	readonly #reads = new ReadQueue(() => this.#read());
	/** Changes held back for the window, by item id; a later version of an item replaces the earlier one in place. */
	#pending = new Map<string, Item>();
	#pendingReset = false;
	#window: Timer | undefined;
	readonly #emit: (reset: boolean, items: Item[]) => void;
	readonly #emitWork: (reset: boolean, files: ChangedFile[]) => void;

	/** `emitWork` gets every changed file once the first read finishes, then the files each later read changed. */
	constructor(path: string, emit: (reset: boolean, items: Item[]) => void, emitWork: (reset: boolean, files: ChangedFile[]) => void) {
		this.path = path;
		this.#lines = new LineReader(path, () => this.#restart());
		this.#emit = emit;
		this.#emitWork = emitWork;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** The changed files, as of the last read. */
	get files(): ChangedFile[] {
		return this.#work.files();
	}

	/** Read what was appended since the last read. Calls that arrive before a queued read starts share it. */
	poke(): void {
		this.#reads.poke();
	}

	/**
	 * Apply live state (an agent event, a note) once the file is read up to now, so a
	 * message the file already settled is never overwritten by its stale live copy.
	 */
	live(apply: (transcript: Transcript) => Item[]): void {
		this.poke();
		this.#reads.after(() => this.#publish(apply(this.transcript)));
	}

	/**
	 * Publish what `changed`, and whatever it held back before, unless only items still in flux changed: those wait out
	 * the window. A message that finishes, a tool that ends, a prompt or a notice publishes at once with them, so the
	 * final state is never delayed.
	 */
	#publish(changed: Item[]): void {
		if (this.transcript.takeReordered()) this.#pendingReset = true;
		for (const item of changed) this.#pending.set(item.id, item);
		if (!this.#pendingReset && this.#pending.size === 0) return;
		if (!this.#pendingReset && changed.every(inFlux)) this.#window ??= setTimeout(() => this.#flush(), PUBLISH_WINDOW_MS);
		else this.#flush();
	}

	#flush(): void {
		const reset = this.#pendingReset;
		const items = reset ? this.transcript.items() : [...this.#pending.values()];
		this.#discardPending();
		this.#emit(reset, items);
	}

	#discardPending(): void {
		clearTimeout(this.#window);
		this.#window = undefined;
		this.#pending.clear();
		this.#pendingReset = false;
	}

	/** Rewritten in place (omp rewrites a file on some migrations): start over. */
	#restart(): void {
		this.#discardPending();
		this.transcript = new Transcript();
		this.#work = new Work();
		this.#loaded = false;
	}

	async #read(): Promise<void> {
		const entries: unknown[] = [];
		const complete = await this.#lines.read(line => {
			try {
				entries.push(JSON.parse(line));
			} catch {
				// A line that does not parse is skipped.
			}
		});
		// Unreadable for now: the next poke retries from the same offset.
		if (!complete) return;
		const changed = entries.flatMap(entry => this.transcript.applyEntry(entry));
		for (const entry of entries) this.#work.applyEntry(entry);
		const changedFiles = this.#work.takeChanged();
		if (!this.#loaded) {
			this.#loaded = true;
			this.#discardPending();
			this.transcript.takeReordered();
			this.#emit(true, this.transcript.items());
			this.#emitWork(true, this.files);
		} else {
			this.#publish(changed);
			if (changedFiles.length > 0) this.#emitWork(false, changedFiles);
		}
	}
}
