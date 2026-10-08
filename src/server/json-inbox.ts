/**
 * A directory of JSON files that other processes drop for the server to act on, one request per file: omp's tools leave
 * them while the dashboard is down or busy, and the server applies and deletes each.
 * Other processes delete files here too, and a second server may drain the same directory, so a file that disappears
 * between the listing and the read is skipped, never an error. A file that is not a request moves to `<name>.invalid`
 * rather than staying to fail on every drain. Nothing a handler or the watcher does throws out of the drain.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch } from "node:fs";
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
	/** Files whose request is being applied, so a drain that starts meanwhile does not apply it twice. */
	readonly #busy = new Set<string>();

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
			names = readdirSync(this.#dir).filter(name => name.endsWith(".json")).sort();
		} catch {
			return;
		}
		// Each `handle` runs up to its first await at once, so synchronous handlers apply in name order.
		await Promise.all(names.map(name => this.#handle(name)));
	}

	/** Drains now and on every change to the directory, which it creates. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		watch(this.#dir, () => void this.drain());
		void this.drain();
	}

	async #handle(name: string): Promise<void> {
		if (this.#busy.has(name)) return;
		const path = join(this.#dir, name);
		try {
			let value: unknown;
			try {
				value = JSON.parse(readFileSync(path, "utf8"));
			} catch (err) {
				// Whoever wrote the file deleted it, or another server took it, between the listing and the read.
				if (!isMissing(err)) this.#setAside(path, errorText(err));
				return;
			}
			const entry = this.#handler.parse(name, value);
			if ("invalid" in entry) {
				this.#setAside(path, entry.invalid);
				return;
			}
			this.#busy.add(name);
			try {
				if (await this.#handler.apply(entry.item)) rmSync(path, { force: true });
			} catch (err) {
				this.#setAside(path, `applying it failed: ${errorText(err)}`);
			} finally {
				this.#busy.delete(name);
			}
		} catch (err) {
			console.error(`omp-agents: could not handle ${path}: ${errorText(err)}`);
		}
	}

	#setAside(path: string, why: string): void {
		console.error(`omp-agents: set aside ${path}: ${why}`);
		try {
			renameSync(path, `${path}.invalid`);
		} catch (err) {
			if (!isMissing(err)) console.error(`omp-agents: could not set aside ${path}: ${errorText(err)}`);
		}
	}
}
