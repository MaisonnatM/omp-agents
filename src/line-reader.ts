const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** Folds a file's lines, in order, each once. */
export interface LineFold {
	applyLine(line: string): void;
}

/** What one {@link FoldedFile.read} did. */
export interface FoldRead {
	/** `false` when the file could not be read; the next read starts from the same place. */
	readable: boolean;
	/** The file was shorter than what was already read (rewritten, truncated or deleted), so a fresh fold started over from its first line. */
	restarted: boolean;
}

/**
 * A file's lines folded as far as they have been read: each read applies only the complete lines appended since the
 * last one, and a file that shrank is folded again from a fresh fold. A file that does not exist yet reads as empty
 * until it appears.
 */
export class FoldedFile<F extends LineFold> {
	readonly #path: string;
	readonly #create: () => F;
	#fold: F;
	#offset = 0;
	/** Reads one after another, so two callers never fold the same appended lines twice. */
	#chain: Promise<unknown> = Promise.resolve();

	/** `create` makes an empty fold: the first one, and a fresh one each time the file shrinks. */
	constructor(path: string, create: () => F) {
		this.#path = path;
		this.#create = create;
		this.#fold = create();
	}

	/** The lines read so far, folded; a read that restarts replaces it. */
	get fold(): F {
		return this.#fold;
	}

	/**
	 * Fold the non-empty lines appended since the last read, once the reads asked for before it are done. Only complete
	 * lines: the writer may be halfway through the last one.
	 */
	read(): Promise<FoldRead> {
		const next = this.#chain.then(() => this.#read());
		this.#chain = next.catch(() => {});
		return next;
	}

	async #read(): Promise<FoldRead> {
		const file = Bun.file(this.#path);
		const size = await file.stat().then(
			stat => stat.size,
			() => 0,
		);
		const restarted = size < this.#offset;
		if (restarted) {
			this.#offset = 0;
			this.#fold = this.#create();
		}
		if (size === this.#offset) return { readable: true, restarted };
		const bytes = await file
			.slice(this.#offset, size)
			.bytes()
			.catch(() => null);
		if (!bytes) return { readable: false, restarted };
		const end = bytes.lastIndexOf(NEWLINE) + 1;
		this.#offset += end;
		for (const line of decoder.decode(bytes.subarray(0, end)).split("\n")) if (line) this.#fold.applyLine(line);
		return { readable: true, restarted };
	}
}

/**
 * Runs a file's reads one after another, in the order they were asked for, with the tasks queued behind them. Pokes
 * that arrive before a queued read starts share it, so a burst of watcher events costs one read.
 */
export class ReadQueue {
	readonly #read: () => Promise<void>;
	#chain: Promise<void> = Promise.resolve();
	#readQueued = false;

	/** A read that fails is dropped; the next poke reads again. */
	constructor(read: () => Promise<void>) {
		this.#read = read;
	}

	poke(): void {
		if (this.#readQueued) return;
		this.#readQueued = true;
		this.#chain = this.#chain.then(() => {
			this.#readQueued = false;
			return this.#read().catch(() => {});
		});
	}

	/** Run `task` once every read asked for so far is done. */
	after(task: () => void): void {
		this.#chain = this.#chain.then(task);
	}
}
