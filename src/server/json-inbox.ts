/**
 * A directory of JSON files that other processes drop for the server to act on, one request per file: omp's tools leave
 * them while the dashboard is down or busy, and the server applies and deletes each.
 * Other processes delete files here too, and a second server may drain the same directory, so a file that disappears
 * between the listing and the read is skipped, never an error. A file that is not a request moves to `<name>.invalid`
 * rather than staying to fail on every drain. Nothing a handler or the watcher does throws out of the drain.
 */
import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "../json";

/** What one file holds: the request it makes, or why it is no request. */
export type InboxEntry<T> = { item: T } | { invalid: string };

export interface InboxHandler<T> {
	/** The request file `name` holds as `value`, which is whatever the file's JSON parsed to. */
	parse(name: string, value: unknown): InboxEntry<T>;
	/** Acts on `item`. `true` once it is handled, which deletes its file; `false` leaves the file for a later drain. */
	apply(item: T): boolean | Promise<boolean>;
}

export interface InboxOptions {
	/** Whether this server drains at all; a drain while it is `false` leaves every file alone. */
	active?: () => boolean;
}

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === "ENOENT";

export class JsonInboxDir<T> {
	readonly #dir: string;
	readonly #handler: InboxHandler<T>;
	readonly #active: () => boolean;
	/** Files a drain listed and has not finished with, so a drain that starts meanwhile does not apply one twice. */
	readonly #busy = new Set<string>();
	#watcher: FSWatcher | undefined;

	constructor(dir: string, handler: InboxHandler<T>, options: InboxOptions = {}) {
		this.#dir = dir;
		this.#handler = handler;
		this.#active = options.active ?? (() => true);
	}

	/** Applies every request waiting, oldest name first, and settles once each is handled. Never rejects. */
	async drain(): Promise<void> {
		if (!this.#active()) return;
		let names: string[];
		try {
			names = (await readdir(this.#dir)).filter(name => name.endsWith(".json")).sort();
		} catch {
			return;
		}
		const claimed = names.filter(name => !this.#busy.has(name));
		for (const name of claimed) this.#busy.add(name);
		const values = await Promise.all(claimed.map(name => this.#read(join(this.#dir, name))));
		// Each `handle` runs up to its first await at once, so synchronous handlers apply in name order.
		await Promise.all(claimed.map((name, i) => this.#handle(name, values[i]!).finally(() => this.#busy.delete(name))));
	}

	/** Drains now and on every change to the directory, which it creates. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		this.#watcher = watch(this.#dir, () => void this.drain());
		void this.drain();
	}

	/** Stops following the directory, as the server stops. */
	stop(): void {
		this.#watcher?.close();
		this.#watcher = undefined;
	}

	/** The JSON in the file at `path`, or `null` once it is gone or set aside. */
	async #read(path: string): Promise<{ value: unknown } | null> {
		try {
			return { value: JSON.parse(await readFile(path, "utf8")) };
		} catch (err) {
			// Whoever wrote the file deleted it, or another server took it, between the listing and the read.
			if (!isMissing(err)) await this.#setAside(path, errorText(err));
			return null;
		}
	}

	async #handle(name: string, read: { value: unknown } | null): Promise<void> {
		if (!read) return;
		const path = join(this.#dir, name);
		try {
			const entry = this.#handler.parse(name, read.value);
			if ("invalid" in entry) {
				await this.#setAside(path, entry.invalid);
				return;
			}
			try {
				if (await this.#handler.apply(entry.item)) await rm(path, { force: true });
			} catch (err) {
				await this.#setAside(path, `applying it failed: ${errorText(err)}`);
			}
		} catch (err) {
			console.error(`omp-agents: could not handle ${path}: ${errorText(err)}`);
		}
	}

	async #setAside(path: string, why: string): Promise<void> {
		console.error(`omp-agents: set aside ${path}: ${why}`);
		try {
			await rename(path, `${path}.invalid`);
		} catch (err) {
			if (!isMissing(err)) console.error(`omp-agents: could not set aside ${path}: ${errorText(err)}`);
		}
	}
}
