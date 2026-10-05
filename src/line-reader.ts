const NEWLINE = 0x0a;
const decoder = new TextDecoder();

/** Reads a file's lines in order, each once. A file that does not exist yet reads as empty until it appears. */
export class LineReader {
	readonly #path: string;
	readonly #onRewrite: () => void;
	#offset = 0;

	/** `onRewrite` runs when the file is shorter than what was already read (rewritten, truncated or deleted); reading then starts over from its first line. */
	constructor(path: string, onRewrite: () => void) {
		this.#path = path;
		this.#onRewrite = onRewrite;
	}

	/**
	 * Hand each non-empty line appended since the last read to `onLine`. Only complete lines: the writer may be halfway
	 * through the last one. Resolves `false` when the file could not be read; the next call reads from the same place.
	 */
	async read(onLine: (line: string) => void): Promise<boolean> {
		const file = Bun.file(this.#path);
		const size = await file.stat().then(
			stat => stat.size,
			() => 0,
		);
		if (size < this.#offset) {
			this.#offset = 0;
			this.#onRewrite();
		}
		if (size === this.#offset) return true;
		const bytes = await file
			.slice(this.#offset, size)
			.bytes()
			.catch(() => null);
		if (!bytes) return false;
		const end = bytes.lastIndexOf(NEWLINE) + 1;
		this.#offset += end;
		for (const line of decoder.decode(bytes.subarray(0, end)).split("\n")) if (line) onLine(line);
		return true;
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
