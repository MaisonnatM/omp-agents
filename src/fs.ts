/** File writes that never leave a half-written file behind, and the JSON files the server keeps this way. */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { errorText, isObject } from "./json";

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
function atomicWriteTextSync(path: string, text: string, mode?: number): void {
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
	/** What the file holds, as the report of a file that holds something else names it: `a todo list`. */
	holds: string;
	/** A file that holds something else stays where it is (`ignore`), or moves to `<path>.invalid` (`aside`) because it holds what someone typed. */
	onInvalid: "ignore" | "aside";
	/** `JSON.stringify`'s indent for what {@link JsonFile.save} writes. */
	indent?: string;
	/** The file's permissions, `0o600` for one that holds a secret; a directory it creates is then `0o700`. */
	mode?: number;
}

/**
 * A file holding one JSON value, which the server reads when it starts and replaces whole on every change. A failure to
 * read or write is reported and never thrown: what the server keeps in memory stays right, and only the next start loses it.
 */
export class JsonFile<T> {
	readonly #path: string;
	readonly #options: JsonFileOptions<T>;

	constructor(path: string, options: JsonFileOptions<T>) {
		this.#path = path;
		this.#options = options;
	}

	/** The value the file holds, or `null` when there is no file, it cannot be read, or it holds something else. */
	load(): T | null {
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

	/** Replaces the file with `value`; a crash mid-write leaves the last complete file. */
	save(value: T): void {
		const { indent, mode } = this.#options;
		try {
			mkdirSync(dirname(this.#path), { recursive: true, mode: mode === undefined ? undefined : 0o700 });
			atomicWriteTextSync(this.#path, `${JSON.stringify(value, null, indent)}\n`, mode);
		} catch (err) {
			console.error(`omp-agents: cannot write ${this.#path}: ${errorText(err)}`);
		}
	}
}
