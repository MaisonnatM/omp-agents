/**
 * Every recurring job of the server, with its cadence: the registry poll, the watcher on omp's sessions
 * directory and the throttled re-read it asks for, the full rescan, the `omp usage` poll, the routine tick, the
 * update check, and the activity check. The handlers do the work. Every loop schedules its next tick once the last one
 * finished, so ticks never overlap, and one that fails is logged and tried again at the next turn.
 * The routine tick runs whether or not a page is connected, since routines start sessions on their own.
 */
import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { join } from "node:path";
import { errorText } from "../json";

/** The registry has no change feed; listing it is one local IPC round trip per host. */
const POLL_MS = 1500;
/** Re-read the session files the watcher reported at most this often while sessions write. */
const LIST_THROTTLE_MS = 500;
/** List every session file this often, in case the watcher missed a change. */
const RESCAN_MS = 60_000;
/** `omp usage` caches provider reports itself; each run still costs a process and up to one network round trip per provider. */
const USAGE_POLL_MS = 60_000;
/** Routine schedules count in minutes, and a Mac that wakes from sleep catches up at the next tick; checked todos clear on it too. */
const MINUTE_TICK_MS = 60_000;
/** omp and the model catalog release a few times a week; each check runs `omp models` and asks npm for omp's newest release. */
const NOTICE_CHECK_MS = 6 * 60 * 60_000;
/** Each activity check asks GitHub for every workspace's pull requests and searches Slack twice. */
const ACTIVITY_CHECK_MS = 2 * 60_000;

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
	/** Every {@link MINUTE_TICK_MS}, listener or not. */
	onMinuteTick(): Promise<void>;
	/** At once, then every {@link NOTICE_CHECK_MS}, listener or not. */
	onNoticeTick(): Promise<void>;
	/** Every {@link ACTIVITY_CHECK_MS}. */
	onActivityTick(): Promise<void>;
}

/**
 * Run `tick` after `firstMs`, then again `ms` after each run finishes, whether it succeeded or not: a tick that throws or
 * rejects is logged under `name` and the loop goes on. Returns the function that stops the loop.
 */
export function repeat(name: string, tick: () => Promise<void>, ms: number, firstMs = ms): () => void {
	let stopped = false;
	let timer: NodeJS.Timeout | undefined;
	const run = async (): Promise<void> => {
		try {
			await tick();
		} catch (err) {
			console.error(`omp-agents: the ${name} loop failed: ${errorText(err)}`);
		}
		if (!stopped) timer = setTimeout(() => void run(), ms);
	};
	timer = setTimeout(() => void run(), firstMs);
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

export class Loops {
	readonly #dir: string;
	readonly #on: LoopHandlers;
	#listTimer: NodeJS.Timeout | undefined;
	#watcher: FSWatcher | undefined;
	/** Stops each loop {@link start} started. */
	#stops: (() => void)[] = [];
	#stopped = false;

	constructor(dir: string, handlers: LoopHandlers) {
		this.#dir = dir;
		this.#on = handlers;
	}

	/** One recursive watcher on the directory drives every tail and the session list. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		this.#watcher = watch(this.#dir, { recursive: true }, (_event, name) => {
			if (name) this.fileChanged(join(this.#dir, String(name)));
		});
	}

	/** Start the registry poll, the rescans, the usage poll, the minute tick, the update check, and the activity check. */
	start(): void {
		this.#stops = [
			repeat("registry", this.#on.onRegistryTick, POLL_MS),
			repeat("rescan", this.#on.onRescanTick, RESCAN_MS),
			repeat("usage", this.#on.onUsageTick, USAGE_POLL_MS, 0),
			repeat("routine", this.#on.onMinuteTick, MINUTE_TICK_MS),
			repeat("update check", this.#on.onNoticeTick, NOTICE_CHECK_MS, 0),
			repeat("activity check", this.#on.onActivityTick, ACTIVITY_CHECK_MS),
		];
	}

	/** Stops every loop, the watcher, and a pending re-read, as the server stops; a tick already running finishes but schedules no other. */
	stop(): void {
		this.#stopped = true;
		for (const stop of this.#stops) stop();
		this.#stops = [];
		this.#watcher?.close();
		this.#watcher = undefined;
		clearTimeout(this.#listTimer);
		this.#listTimer = undefined;
	}

	/** A file changed, reported by the watcher or by the session that wrote it. */
	fileChanged(path: string): void {
		if (this.#stopped) return;
		if (this.#on.onFileChange(path)) {
			this.#listTimer ??= setTimeout(() => void this.listNow().catch((err: unknown) => console.error(`omp-agents: listing the session files failed: ${errorText(err)}`)), LIST_THROTTLE_MS);
		}
	}

	/** Read the session files again now, in place of a pending throttled re-read. */
	async listNow(): Promise<void> {
		clearTimeout(this.#listTimer);
		this.#listTimer = undefined;
		if (!this.#stopped) await this.#on.onListRefresh();
	}
}
