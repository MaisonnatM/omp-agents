/**
 * Every recurring job of the server, with its cadence: the registry poll, the watcher on omp's sessions
 * directory and the throttled re-read it asks for, the full rescan, and the `omp usage` poll.
 * The handlers do the work. The registry and usage polls schedule their next tick once the last one finished.
 */
import { mkdirSync, watch } from "node:fs";
import { join } from "node:path";

/** The registry has no change feed; listing it is one local IPC round trip per host. */
const POLL_MS = 1500;
/** Re-read the session files the watcher reported at most this often while sessions write. */
const LIST_THROTTLE_MS = 500;
/** List every session file this often, in case the watcher missed a change. */
const RESCAN_MS = 60_000;
/** `omp usage` caches provider reports itself; each run still costs a process and up to one network round trip per provider. */
const USAGE_POLL_MS = 60_000;

export interface LoopHandlers {
	/** Every {@link POLL_MS}. */
	onRegistryTick(): Promise<void>;
	/** A file under the watched directory changed; returns whether to read the session files again. */
	onFileChange(path: string): boolean;
	/** The re-read {@link onFileChange} asked for, at most every {@link LIST_THROTTLE_MS}. */
	onListRefresh(): Promise<void>;
	/** Every {@link RESCAN_MS}. */
	onRescanTick(): Promise<void>;
	/** At once, then every {@link USAGE_POLL_MS}. */
	onUsageTick(): Promise<void>;
}

/** Run `tick`, then again `ms` after each run finishes. */
async function repeat(tick: () => Promise<void>, ms: number): Promise<void> {
	await tick();
	setTimeout(() => void repeat(tick, ms), ms);
}

export class Loops {
	readonly #dir: string;
	readonly #on: LoopHandlers;
	#listTimer: NodeJS.Timeout | undefined;

	constructor(dir: string, handlers: LoopHandlers) {
		this.#dir = dir;
		this.#on = handlers;
	}

	/** One recursive watcher on the directory drives every tail and the session list. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		watch(this.#dir, { recursive: true }, (_event, name) => {
			if (name) this.fileChanged(join(this.#dir, String(name)));
		});
	}

	/** Start the registry poll, the rescans, and the usage poll. */
	start(): void {
		setTimeout(() => void repeat(this.#on.onRegistryTick, POLL_MS), POLL_MS);
		setInterval(() => void this.#on.onRescanTick(), RESCAN_MS);
		void repeat(this.#on.onUsageTick, USAGE_POLL_MS);
	}

	/** A file changed, reported by the watcher or by the session that wrote it. */
	fileChanged(path: string): void {
		if (this.#on.onFileChange(path)) this.#listTimer ??= setTimeout(() => void this.listNow(), LIST_THROTTLE_MS);
	}

	/** Read the session files again now, in place of a pending throttled re-read. */
	async listNow(): Promise<void> {
		clearTimeout(this.#listTimer);
		this.#listTimer = undefined;
		await this.#on.onListRefresh();
	}
}
