/**
 * Removes secrets from everything omp keeps of one session on disk: its entries, which omp's own session manager
 * rewrites, the files in its sidecar folder, and its rows in `history.db`.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { eachString, Redactor, redactValue } from "./redact";

/** One session entry as omp's session manager holds it; the scrub replaces whole fields, never the objects inside them. */
export interface SessionEntry {
	type: string;
	[key: string]: unknown;
}

/**
 * The part of omp's `SessionManager` the scrub uses.
 * An extension's `ctx.sessionManager` is that manager, typed read-only; `rewriteEntries` is the way omp itself writes
 * entries it changed in place back to the file, atomically and under its cross-process lock.
 */
export interface SessionStore {
	getSessionId(): string;
	getEntries(): SessionEntry[];
	getArtifactsDir(): string | null;
	isSessionOnDisk(): boolean;
	rewriteEntries(): Promise<void>;
}

export interface ScrubOptions {
	/** omp's `history.db`. */
	historyDb: string;
	/** omp's `isSessionLeaseHeld`: a subagent session another process may still write is left for a later turn. */
	leaseHeld?: (sessionId: string) => boolean | null;
}

/** How many entries, sidecar files, and `history.db` rows one run changed. */
export interface ScrubReport {
	entries: number;
	files: number;
	historyRows: number;
}

/** Fields every entry has that never hold a secret and that the session's tree depends on. */
const STRUCTURAL: Record<string, true> = { type: true, id: true, parentId: true, timestamp: true };

/** The `role` of a message, or undefined for anything else. */
function roleOf(value: unknown): unknown {
	return value && typeof value === "object" && "role" in value ? value.role : undefined;
}

/** Whether `entry` holds what the user wrote, where password pairs count as secrets. */
function isUserEntry(entry: Record<string, unknown>): boolean {
	return (entry.type === "message" && roleOf(entry.message) === "user") || (entry.type === "custom_message" && entry.attribution === "user");
}

/**
 * Scrubs one session, remembering what it found clean so each later run looks only at what is new.
 * Keep one per session for the life of the process: the values it learned in one turn are still replaced in the next.
 */
export class SessionScrub {
	readonly redactor = new Redactor();
	/** Entry objects already redacted, with the redactor version they were checked at. */
	readonly #checked = new WeakMap<object, number>();
	/** Sidecar files already clean, by path, with their size, modification time, and the redactor version. */
	readonly #files = new Map<string, string>();
	readonly #options: ScrubOptions;

	constructor(options: ScrubOptions) {
		this.#options = options;
	}

	async run(store: SessionStore): Promise<ScrubReport> {
		const report: ScrubReport = { entries: 0, files: 0, historyRows: 0 };
		const entries = store.getEntries();
		for (const entry of entries) {
			if (this.#checked.get(entry) === this.redactor.version) continue;
			const user = isUserEntry(entry);
			eachString(entry, text => this.redactor.learn(text, user));
		}
		const version = this.redactor.version;
		for (const entry of entries) {
			if (this.#checked.get(entry) === version) continue;
			if (this.#redactEntry(entry)) report.entries++;
			this.#checked.set(entry, version);
		}
		// A session not yet on disk is written whole from these entries when it is.
		if (report.entries > 0 && store.isSessionOnDisk()) await store.rewriteEntries();
		const sidecar = store.getArtifactsDir();
		if (sidecar) report.files = await this.#scrubDir(sidecar);
		report.historyRows = this.#scrubHistory(store.getSessionId());
		return report;
	}

	/** Swaps each field of `entry` holding a secret for a redacted copy, so the objects the live agent shares stay whole. */
	#redactEntry(entry: SessionEntry): boolean {
		const user = isUserEntry(entry);
		let changed = false;
		for (const [key, value] of Object.entries(entry)) {
			if (Object.hasOwn(STRUCTURAL, key)) continue;
			const next = redactValue(value, text => this.redactor.redact(text, user));
			if (next === value) continue;
			entry[key] = next;
			changed = true;
		}
		return changed;
	}

	async #scrubDir(dir: string): Promise<number> {
		const children = await readdir(dir, { withFileTypes: true }).catch(() => []);
		let changed = 0;
		for (const child of children) {
			// Dot files are omp's lock files and this scrub's own temporary copies.
			if (child.name.startsWith(".")) continue;
			const path = join(dir, child.name);
			if (child.isDirectory()) changed += await this.#scrubDir(path);
			else if (child.isFile() && (await this.#scrubFile(path))) changed++;
		}
		return changed;
	}

	/**
	 * Rewrites one sidecar file through a temporary copy renamed over it, unless it changed while being read,
	 * which leaves it for the next run.
	 */
	async #scrubFile(path: string): Promise<boolean> {
		const before = await stat(path).catch(() => null);
		if (!before) return false;
		const stamp = `${before.size}:${before.mtimeMs}:${this.redactor.version}`;
		if (this.#files.get(path) === stamp) return false;
		const bytes = await readFile(path);
		// Binary files, such as screenshots, hold no pasted text.
		if (bytes.subarray(0, 8000).includes(0)) {
			this.#files.set(path, stamp);
			return false;
		}
		const text = bytes.toString("utf8");
		const next = path.endsWith(".jsonl") ? this.#redactJsonl(text) : this.redactor.redact(text, false);
		if (next === null) return false;
		if (next === text) {
			this.#files.set(path, stamp);
			return false;
		}
		const temp = join(dirname(path), `.${basename(path)}.${process.pid}.redact`);
		await writeFile(temp, next, { mode: before.mode & 0o777 });
		const now = await stat(path).catch(() => null);
		if (!now || now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
			await rm(temp, { force: true });
			return false;
		}
		await rename(temp, path);
		return true;
	}

	/**
	 * A subagent's session file with each line holding a secret written again, and every other line, the fixed-width
	 * title slot and the header included, kept byte for byte; null while another process may still be writing it.
	 */
	#redactJsonl(text: string): string | null {
		const lines = text.split("\n");
		const parsed = lines.map(line => {
			if (!line.trim()) return null;
			try {
				return JSON.parse(line) as Record<string, unknown>;
			} catch {
				return null;
			}
		});
		const header = parsed.find(entry => entry?.type === "session");
		if (header && typeof header.id === "string" && this.#options.leaseHeld && this.#options.leaseHeld(header.id) !== false) return null;
		for (const entry of parsed) {
			if (!entry) continue;
			const user = isUserEntry(entry);
			eachString(entry, part => this.redactor.learn(part, user));
		}
		let changed = false;
		const out = lines.map((line, index) => {
			const entry = parsed[index];
			if (!entry || entry.type === "title" || entry.type === "session") return line;
			const user = isUserEntry(entry);
			const next = redactValue(entry, part => this.redactor.redact(part, user));
			if (next === entry) return line;
			changed = true;
			return JSON.stringify(next);
		});
		return changed ? out.join("\n") : text;
	}

	/**
	 * Redacts the session's prompts, recap, and title in `history.db`, then rebuilds the prompt search index, which
	 * keeps its own copy of each word, and checkpoints the log so the old pages leave the disk.
	 */
	#scrubHistory(sessionId: string): number {
		if (!existsSync(this.#options.historyDb)) return 0;
		const db = new Database(this.#options.historyDb);
		try {
			db.run("PRAGMA busy_timeout = 5000");
			// Pages the old text sat on are overwritten with zeros rather than left in the file's free list.
			db.run("PRAGMA secure_delete = ON");
			const tables = new Set(db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
			let changed = 0;
			db.transaction(() => {
				let prompts = 0;
				if (tables.has("history")) {
					for (const row of db.query<{ id: number; prompt: string }, [string]>("SELECT id, prompt FROM history WHERE session_id = ?").all(sessionId)) {
						const prompt = this.redactor.redact(row.prompt, true);
						if (prompt === row.prompt) continue;
						// `prompt` is unique: when the redacted text is already a row, this one goes.
						const clash = db.query<{ id: number }, [string, number]>("SELECT id FROM history WHERE prompt = ? AND id != ?").get(prompt, row.id);
						if (clash) db.run("DELETE FROM history WHERE id = ?", [row.id]);
						else db.run("UPDATE history SET prompt = ? WHERE id = ?", [prompt, row.id]);
						prompts++;
					}
				}
				if (tables.has("session_recaps")) {
					for (const row of db.query<{ id: number; recap: string }, [string]>("SELECT id, recap FROM session_recaps WHERE session_id = ?").all(sessionId)) {
						const recap = this.redactor.redact(row.recap, false);
						if (recap === row.recap) continue;
						db.run("UPDATE session_recaps SET recap = ? WHERE id = ?", [recap, row.id]);
						changed++;
					}
				}
				if (tables.has("session_titles")) {
					const row = db.query<{ title: string }, [string]>("SELECT title FROM session_titles WHERE session_id = ?").get(sessionId);
					const title = row && this.redactor.redact(row.title, false);
					if (row && title !== row.title) {
						db.run("UPDATE session_titles SET title = ? WHERE session_id = ?", [title, sessionId]);
						changed++;
					}
				}
				// The index is external content: it keeps the old words until rebuilt, as omp's own `gc` does.
				if (prompts > 0 && tables.has("history_fts")) db.run("INSERT INTO history_fts(history_fts) VALUES('rebuild')");
				changed += prompts;
			})();
			if (changed > 0) {
				try {
					db.run("PRAGMA wal_checkpoint(TRUNCATE)");
				} catch {
					// A reader holding the log open leaves the checkpoint for a later run.
				}
			}
			return changed;
		} finally {
			db.close();
		}
	}
}
