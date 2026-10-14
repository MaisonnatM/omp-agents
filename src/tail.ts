/**
 * Incremental reader of one omp JSONL transcript (a session or a subagent): it
 * folds each appended line into a {@link Transcript} and a {@link Work}. The
 * server pokes it when its file changes.
 */
import { FoldedFile, ReadQueue } from "./line-reader";
import { formatOf } from "./session-formats";
import type { ChangedFile, Item } from "./shared/transcript";
import { Transcript } from "./transcript";
import { Work } from "./work";

/** Streamed text arrives as one update per token; its updates are published at most this often. */
const PUBLISH_WINDOW_MS = 50;

/** Whether a message is still being written, so that another update of it is likely to follow within the window. */
const inFlux = (item: Item): boolean =>
	((item.kind === "assistant" || item.kind === "thinking") && item.streaming) || (item.kind === "tool" && item.status === "running");

/** A transcript's entries folded into its display items and its changed files, each line decoded once for both. */
class TailFold {
	readonly transcript = new Transcript();
	readonly work = new Work();
	/** The items the lines applied since the last {@link takeChanged} touched. */
	#changed: Item[] = [];
	readonly #decode: (line: string) => unknown[];

	/** `decode`: the file's format's, which skips an omp line that does not parse. */
	constructor(decode: (line: string) => unknown[]) {
		this.#decode = decode;
	}

	applyLine(line: string): void {
		for (const entry of this.#decode(line)) {
			this.#changed.push(...this.transcript.applyEntry(entry));
			this.work.applyEntry(entry);
		}
	}

	takeChanged(): Item[] {
		const changed = this.#changed;
		this.#changed = [];
		return changed;
	}
}

/** Publishes the changes of a transcript's {@link TailFold}, which a {@link FoldedFile} keeps up to date. */
export class FileTail {
	readonly path: string;
	readonly #file: FoldedFile<TailFold>;
	#loaded = false;
	readonly #reads = new ReadQueue(() => this.#read());
	/** Changes held back for the window, by item id; a later version of an item replaces the earlier one in place. */
	#pending = new Map<string, Item>();
	#pendingReset = false;
	#window: Timer | undefined;
	#closed = false;
	readonly #emit: (reset: boolean, items: Item[], removed: string[]) => void;
	readonly #emitWork: (reset: boolean, files: ChangedFile[]) => void;

	/** `emit` gets the items each change touched and the ids of those it removed. `emitWork` gets every changed file once the first read finishes, then the files each later read changed. */
	constructor(path: string, emit: (reset: boolean, items: Item[], removed: string[]) => void, emitWork: (reset: boolean, files: ChangedFile[]) => void) {
		this.path = path;
		const { decode } = formatOf(path);
		this.#file = new FoldedFile(path, () => new TailFold(decode));
		this.#emit = emit;
		this.#emitWork = emitWork;
	}

	get transcript(): Transcript {
		return this.#file.fold.transcript;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** The changed files, as of the last read. */
	get files(): ChangedFile[] {
		return this.#file.fold.work.files();
	}

	/** Read what was appended since the last read. Calls that arrive before a queued read starts share it. */
	poke(): void {
		if (!this.#closed) this.#reads.poke();
	}

	/** Stops publishing: drops what the window held back, and ignores a read still in flight and every later poke or live update. */
	close(): void {
		this.#closed = true;
		this.#discardPending();
	}

	/**
	 * Apply live state (an agent event, a note) once the file is read up to now, so a
	 * message the file already settled is never overwritten by its stale live copy.
	 */
	live(apply: (transcript: Transcript) => Item[]): void {
		if (this.#closed) return;
		this.poke();
		this.#reads.after(() => this.#publish(apply(this.transcript)));
	}

	/**
	 * Publish what `changed`, and whatever it held back before, unless only items still in flux changed: those wait out
	 * the window. A message that finishes, a tool that ends, a prompt, a notice, or an item that leaves publishes at once
	 * with them, so the final state is never delayed.
	 */
	#publish(changed: Item[]): void {
		if (this.#closed) return;
		if (this.transcript.takeReordered()) this.#pendingReset = true;
		const removed = this.transcript.takeRemoved();
		for (const id of removed) this.#pending.delete(id);
		for (const item of changed) this.#pending.set(item.id, item);
		if (!this.#pendingReset && this.#pending.size === 0 && removed.length === 0) return;
		if (!this.#pendingReset && removed.length === 0 && changed.every(inFlux)) this.#window ??= setTimeout(() => this.#flush([]), PUBLISH_WINDOW_MS);
		else this.#flush(removed);
	}

	#flush(removed: string[]): void {
		const reset = this.#pendingReset;
		const items = reset ? this.transcript.items() : [...this.#pending.values()];
		this.#discardPending();
		this.#emit(reset, items, reset ? [] : removed);
	}

	#discardPending(): void {
		clearTimeout(this.#window);
		this.#window = undefined;
		this.#pending.clear();
		this.#pendingReset = false;
	}

	async #read(): Promise<void> {
		const { readable, restarted } = await this.#file.read();
		// Rewritten in place (omp rewrites a file on some migrations): the fold started over, and so does what was published.
		if (restarted) {
			this.#discardPending();
			this.#loaded = false;
		}
		// Unreadable for now: the next poke retries from the same offset.
		if (!readable || this.#closed) return;
		const fold = this.#file.fold;
		const changed = fold.takeChanged();
		const changedFiles = fold.work.takeChanged();
		if (!this.#loaded) {
			this.#loaded = true;
			this.#discardPending();
			this.transcript.takeReordered();
			this.transcript.takeRemoved();
			this.#emit(true, this.transcript.items(), []);
			this.#emitWork(true, this.files);
		} else {
			this.#publish(changed);
			if (changedFiles.length > 0) this.#emitWork(false, changedFiles);
		}
	}
}
