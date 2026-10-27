/** File writes that never leave a half-written file behind, and the JSON files the server keeps this way. */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { errorText, isObject } from "./json";
import { OwnerLock } from "../templates/omp/agent/extensions/github/owner-lock";

/** Where a replacement of `path` is staged: beside it, so the rename that publishes it stays on one file system. */
const stagingFor = (path: string): string => join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);

/**
 * Replaces `path` with `text` through a temporary file beside it, so a reader sees the old file or the new one, never
 * part of either. The temporary file is created with `mode`, and removed when the write fails.
 */
export async function atomicWriteText(path: string, text: string, mode?: number): Promise<void> {
	const temp = stagingFor(path);
	const handle = await open(temp, "wx", mode);
	try {
		try {
			await handle.writeFile(text);
		} finally {
			await handle.close();
		}
		await rename(temp, path);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
}

/** {@link atomicWriteText} for a caller that has no way to wait: the file is replaced when this returns. */
export function atomicWriteTextSync(path: string, text: string, mode?: number): void {
	const temp = stagingFor(path);
	try {
		writeFileSync(temp, text, { flag: "wx", mode });
		renameSync(temp, path);
	} catch (err) {
		rmSync(temp, { force: true });
		throw err;
	}
}

interface JsonFileOptions<T> {
	/** The value `json` holds, or `null` when it is not one. */
	parse: (json: unknown) => T | null;
	/** What the file holds for `value`, when that is not `value` itself: `{ sessions }` around a list of session ids. */
	toJson?: (value: T) => unknown;
	/** What the file holds, as the report of a file that holds something else names it: `a todo list`. */
	holds: string;
	/** A file that holds something else stays where it is (`ignore`), or moves to `<path>.invalid` (`aside`) because it holds what someone typed. */
	onInvalid: "ignore" | "aside";
	/** `JSON.stringify`'s indent for what {@link JsonFile.save} writes. */
	indent?: string;
	/** The file's permissions, `0o600` for one that holds a secret; a directory it creates is then `0o700`. */
	mode?: number;
	/** Releases ownership only after the saved value reaches disk. */
	written?: () => void;
}

/** Files with a value {@link JsonFile.save} has not written yet, by path. */
const pending = new Map<string, { flush(): boolean }>();

/** Writes every value saved and not yet written, as the server stops: a value saved in its last tick still reaches its file. */
export function flushJsonFiles(): void {
	for (const file of pending.values()) file.flush();
}

/**
 * A file holding one JSON value, which the server reads when it starts and replaces whole on every change. Read and write
 * failures are reported, not thrown. A failed write stays dirty for a later flush rather than being mistaken for persistence.
 * Saves within one tick write once, at the end of it, with the last value; {@link flushJsonFiles} writes them sooner.
 */
export class JsonFile<T> {
	readonly #path: string;
	readonly #options: JsonFileOptions<T>;
	/** The value saved and not yet written, in a box so that a saved `null` is one. */
	#unwritten: { value: T } | null = null;

	constructor(path: string, options: JsonFileOptions<T>) {
		this.#path = path;
		this.#options = options;
	}

	/**
	 * The value the file holds, or `null` when there is no file, it cannot be read, or it holds something else. A value any
	 * `JsonFile` of this path saved and has not written yet is written first.
	 */
	load(): T | null {
		if (pending.get(this.#path)?.flush() === false) return this.#unwritten?.value ?? null;
		const path = this.#path;
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch (err) {
			if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
			return null;
		}
		try {
			const value = this.#options.parse(JSON.parse(text));
			if (value !== null) return value;
		} catch {}
		const { holds, onInvalid } = this.#options;
		if (onInvalid === "ignore") {
			console.error(`omp-agents: ignoring ${path}, which is not ${holds}`);
			return null;
		}
		const aside = `${path}.invalid`;
		try {
			renameSync(path, aside);
			console.error(`omp-agents: ${path} is not ${holds}; moved it to ${aside}`);
		} catch (err) {
			console.error(`omp-agents: ${path} is not ${holds}, and cannot move it aside: ${errorText(err)}`);
		}
		return null;
	}

	/** Replaces the file with `value` at the end of this tick, unless a later save replaces it first; a crash mid-write leaves the last complete file. */
	save(value: T): void {
		if (!this.#unwritten) {
			// A second store of this path writes what the first saved before its own.
			pending.get(this.#path)?.flush();
			pending.set(this.#path, this);
			setImmediate(() => this.flush());
		}
		this.#unwritten = { value };
	}

	/** Whether the dirty value reached disk; a failed write stays pending for a later flush. */
	flush(): boolean {
		const unwritten = this.#unwritten;
		if (!unwritten) return true;
		const { indent, mode, toJson } = this.#options;
		try {
			mkdirSync(dirname(this.#path), { recursive: true, mode: mode === undefined ? undefined : 0o700 });
			atomicWriteTextSync(this.#path, `${JSON.stringify(toJson ? toJson(unwritten.value) : unwritten.value, null, indent)}\n`, mode);
		} catch (err) {
			console.error(`omp-agents: cannot write ${this.#path}: ${errorText(err)}`);
			return false;
		}
		this.#unwritten = null;
		if (pending.get(this.#path) === this) pending.delete(this.#path);
		this.#options.written?.();
		return true;
	}
}

interface ReducerFileOptions<S, A extends unknown[]> extends Pick<JsonFileOptions<S>, "parse" | "toJson" | "holds"> {
	/** The value while there is no file to read. */
	empty: S;
	/** `value` after a change, or `value` itself when the change changes nothing. */
	reduce: (value: S, ...change: A) => S;
	/** Holds interprocess ownership through reload, reduction, and an immediate successful write. */
	shared?: boolean;
}

/**
 * A {@link JsonFile} kept in memory as one value that changes through `reduce`, or {@link ReducerFile.update} for a change
 * a subclass makes itself; a change that changes nothing saves nothing. What each file holds was typed or chosen by
 * someone, so it is written tab-indented, and a file that holds something else moves aside rather than being written over.
 */
export class ReducerFile<S, A extends unknown[]> {
	readonly #file: JsonFile<S>;
	readonly #reduce: (value: S, ...change: A) => S;
	readonly #parse: (json: unknown) => S | null;
	readonly #toJson: ((value: S) => unknown) | undefined;
	readonly #lock: OwnerLock | null;
	readonly #path: string;
	#value: S;

	constructor(path: string, { parse, toJson, holds, empty, reduce, shared = false }: ReducerFileOptions<S, A>) {
		this.#path = path;
		this.#lock = shared ? new OwnerLock(`${path}.lock`, 0) : null;
		this.#file = new JsonFile(path, { parse, toJson, holds, onInvalid: "aside", indent: "\t", written: () => this.#lock?.release() });
		this.#reduce = reduce;
		this.#parse = parse;
		this.#toJson = toJson;
		this.#value = this.#file.load() ?? empty;
	}

	get value(): S {
		return this.#value;
	}

	/** `value`, the one it holds unless given, as its file holds it. */
	json(value: S = this.#value): unknown {
		return this.#toJson ? this.#toJson(value) : value;
	}

	/** The value a file holding `json` holds, or `null` when that is something else. */
	parse(json: unknown): S | null {
		return this.#parse(json);
	}

	/** Replaces the value with `value` and saves; whether it changed. */
	replace(value: S): boolean {
		return this.update(() => value);
	}

	/** Applies `change` through `reduce` and saves; whether it changed anything. */
	apply(...change: A): boolean {
		return this.update(value => this.#reduce(value, ...change));
	}

	/** Passes the value through `next` and saves; a shared change holds ownership until its write succeeds. */
	update(next: (value: S) => S): boolean {
		if (!this.#lock) {
			const changed = next(this.#value);
			if (changed === this.#value) return false;
			this.#value = changed;
			this.#file.save(changed);
			return true;
		}
		if (pending.get(this.#path)?.flush() === false) throw new Error("Cannot persist the previous shared-file change.");
		this.#lock.wait();
		try {
			this.#value = this.#file.load() ?? this.#value;
			const changed = next(this.#value);
			if (changed === this.#value) {
				this.#lock.release();
				return false;
			}
			this.#value = changed;
			this.#file.save(changed);
		} catch (error) {
			this.#lock.release();
			throw error;
		}
		if (!this.#file.flush()) throw new Error("Cannot persist the shared-file change.");
		return true;
	}

	/** Reads the file again, for what another server saved; a file it cannot read keeps the value it has. */
	reload(): void {
		this.#value = this.#file.load() ?? this.#value;
	}

	/** Writes what {@link update} saved now, for a reader of the file that cannot wait for the end of this tick. */
	flush(): boolean {
		return this.#file.flush();
	}
}
