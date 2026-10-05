/**
 * Incremental reader of one omp JSONL transcript (a session or a subagent): it
 * folds each appended line into a {@link Transcript} and a {@link Work}. The
 * server pokes it when its file changes.
 */
import type { Item, SessionWork } from "./shared";
import { Transcript } from "./transcript";
import { Work } from "./work";

const NEWLINE = 0x0a;
/** Streamed text arrives as one update per token; its updates are published at most this often. */
const PUBLISH_WINDOW_MS = 50;
const decoder = new TextDecoder();

/** Whether a message is still being written, so that another update of it is likely to follow within the window. */
const inFlux = (item: Item): boolean => (item.kind === "assistant" && item.streaming) || (item.kind === "tool" && item.status === "running");

/** The entries of complete JSONL lines; a line that does not parse is skipped. */
function entriesOf(text: string): unknown[] {
	return text.split("\n").flatMap(line => {
		try {
			return line ? [JSON.parse(line)] : [];
		} catch {
			return [];
		}
	});
}

/** Incremental reader of one JSONL transcript. A file that does not exist yet reads as empty until it appears. */
export class FileTail {
	transcript = new Transcript();
	#work = new Work();
	/** The {@link Work.planVersion} that {@link #planText} was read at. */
	#planVersion = 0;
	#planText: string | null = null;
	readonly path: string;
	#offset = 0;
	#loaded = false;
	/** Reads and live updates run one after another, in the order they were asked for. */
	#chain: Promise<void> = Promise.resolve();
	#readQueued = false;
	/** Changes held back for the window, by item id; a later version of an item replaces the earlier one in place. */
	#pending = new Map<string, Item>();
	#pendingReset = false;
	#window: Timer | undefined;
	readonly #emit: (reset: boolean, items: Item[]) => void;
	readonly #emitWork: (work: SessionWork) => void;

	/** `emitWork` gets the whole {@link Work} once the first read finishes, then again each time a read changes it. */
	constructor(path: string, emit: (reset: boolean, items: Item[]) => void, emitWork: (work: SessionWork) => void) {
		this.path = path;
		this.#emit = emit;
		this.#emitWork = emitWork;
	}

	get loaded(): boolean {
		return this.#loaded;
	}

	/** The plan, its file's text included, and the changed files, as of the last read. */
	get work(): SessionWork {
		return this.#work.snapshot(this.#planText);
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

	/** Reads the plan file again when the transcript changed one since the last read; omp writes the file before the tool result. */
	async #readPlan(): Promise<void> {
		const version = this.#work.planVersion;
		if (version === this.#planVersion) return;
		this.#planVersion = version;
		const path = this.#work.planFile;
		this.#planText = path === null ? null : await Bun.file(path).text().catch(() => null);
	}

	async #read(): Promise<void> {
		const file = Bun.file(this.path);
		const size = await file.stat().then(
			stat => stat.size,
			() => 0,
		);
		if (size < this.#offset) {
			// Rewritten in place (omp rewrites a file on some migrations): start over.
			this.#discardPending();
			this.transcript = new Transcript();
			this.#work = new Work();
			this.#planVersion = 0;
			this.#planText = null;
			this.#offset = 0;
			this.#loaded = false;
		}
		const bytes = size > this.#offset ? await file.slice(this.#offset, size).bytes() : new Uint8Array();
		// Only complete lines: omp may be halfway through writing the last one.
		const end = bytes.lastIndexOf(NEWLINE) + 1;
		this.#offset += end;
		const entries = end > 0 ? entriesOf(decoder.decode(bytes.subarray(0, end))) : [];
		const changed = entries.flatMap(entry => this.transcript.applyEntry(entry));
		// Every entry goes through both folds, so `some` would skip the rest.
		const worked = entries.reduce<boolean>((any, entry) => this.#work.applyEntry(entry) || any, false);
		// Before either emit, so the plan's text goes out with the read that changed it.
		await this.#readPlan();
		if (!this.#loaded) {
			this.#loaded = true;
			this.#discardPending();
			this.transcript.takeReordered();
			this.#emit(true, this.transcript.items());
			this.#emitWork(this.work);
		} else {
			this.#publish(changed);
			if (worked) this.#emitWork(this.work);
		}
	}
}
