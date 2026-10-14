/**
 * The context-source index, `context-sources.db` beside omp-stats' `stats.db`: each request of each session file split by
 * source, keyed by session file and entry id as omp-stats keys its requests. A sync re-reads only the files whose size or
 * modification time changed; rows of a file no longer on disk stay, as omp-stats keeps their usage.
 */
import { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { attributeTurns, type ContextFileRow, type ContextSourceRow, type SessionReading, type TokenCounter, type Turn } from "../context-sources";
import { errorText, isObject, str } from "../json";
import { dirs, type FileEntry, loader, modelTokenizer, sessionContext, tokenizer } from "./modules";

/** Raise when attribution changes: an index of another version is read again from the session files. */
const INDEX_VERSION = 1;

/** The least time between syncs that a report starts. */
const SYNC_GAP_MS = 15_000;

/**
 * Files and sources by integer id, so the per-request rows stay small: a source's cost is the request's input cost split
 * by its share of the request's input, computed when read.
 */
const SCHEMA = `
	CREATE TABLE IF NOT EXISTS files (
		id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL, mtime REAL NOT NULL, cwd TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
	CREATE TABLE IF NOT EXISTS turns (
		id INTEGER PRIMARY KEY, file INTEGER NOT NULL, entry_id TEXT NOT NULL, at INTEGER NOT NULL, input REAL NOT NULL, cost REAL NOT NULL);
	CREATE INDEX IF NOT EXISTS turns_file ON turns (file);
	CREATE INDEX IF NOT EXISTS turns_at ON turns (at);
	CREATE TABLE IF NOT EXISTS turn_sources (
		turn INTEGER NOT NULL, source INTEGER NOT NULL, tokens REAL NOT NULL, PRIMARY KEY (turn, source)) WITHOUT ROWID;`;

const FILE_ROWS = `
	SELECT f.path AS sessionFile, f.cwd AS cwd, COUNT(*) AS turns, SUM(t.input) AS input, SUM(t.cost) AS cost
	FROM turns t JOIN files f ON f.id = t.file WHERE t.at >= ? GROUP BY t.file`;

const SOURCE_ROWS = `
	SELECT f.path AS sessionFile, s.name AS source, COUNT(*) AS turns, SUM(ts.tokens) AS tokens, SUM(ts.tokens * t.cost / t.input) AS cost
	FROM turns t JOIN turn_sources ts ON ts.turn = t.id JOIN files f ON f.id = t.file JOIN sources s ON s.id = ts.source
	WHERE t.at >= ? GROUP BY t.file, ts.source`;

/** A counter per `provider/model`, over omp's tokenizer for the family pi-catalog knows the model by. */
function countersByModel(): (model: { provider: string; model: string; api: string }) => TokenCounter {
	const counters = new Map<string, TokenCounter>();
	return ({ provider, model, api }) => {
		const key = `${provider}/${model}`;
		let counter = counters.get(key);
		if (!counter) {
			const counting = new tokenizer.Tokenizer({ tokenizer: modelTokenizer.resolveModelTokenizer(model, provider), api, provider, id: model });
			counter = {
				// omp's messages are objects; anything else counts nothing.
				message: message => (isObject(message) ? counting.countMessage(message) : 0),
				text: text => counting.countTokens(text, "approximate"),
			};
			counters.set(key, counter);
		}
		return counter;
	};
}

/** One session file's requests by source, and the working directory its header names. */
async function readFile(path: string, counterFor: SessionReading["counter"]): Promise<{ cwd: string; turns: Turn[] }> {
	const entries = await loader.loadEntriesFromFile(path);
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	const header: FileEntry | undefined = entries.find(entry => entry.type === "session");
	const cwd = (isObject(header) && str(header.cwd)) || "";
	return { cwd, turns: attributeTurns({ entries, context: leaf => sessionContext.buildSessionContext(entries, leaf, byId).messages, counter: counterFor }) };
}

export interface ContextRows {
	files: ContextFileRow[];
	sources: ContextSourceRow[];
}

export class ContextIndex {
	readonly #db: Database;
	readonly #root: string;
	#sync: Promise<void> | null = null;
	#syncedAt = 0;
	#progress: { current: number; total: number } | null = null;

	/** Opens or creates the index at `dbPath` over the session files under `root`. */
	constructor(dbPath: string, root: string) {
		this.#db = new Database(dbPath, { create: true });
		this.#root = root;
		this.#db.run("PRAGMA journal_mode = WAL");
		const { user_version: version } = this.#db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
		if (version !== INDEX_VERSION) {
			this.#db.run("DROP TABLE IF EXISTS turn_sources; DROP TABLE IF EXISTS turns; DROP TABLE IF EXISTS sources; DROP TABLE IF EXISTS files");
			this.#db.run(`PRAGMA user_version = ${INDEX_VERSION}`);
		}
		this.#db.run(SCHEMA);
	}

	/** How far the sync in progress has read, `null` when none runs. */
	get progress(): { current: number; total: number } | null {
		return this.#progress;
	}

	/** Reads every session file that changed since it was indexed; a sync already running is the one returned. */
	sync(): Promise<void> {
		if (this.#sync) return this.#sync;
		this.#progress = { current: 0, total: 0 };
		this.#sync = this.#run().finally(() => {
			this.#sync = null;
			this.#progress = null;
			this.#syncedAt = Date.now();
		});
		return this.#sync;
	}

	/** Starts a sync in the background unless one runs or one finished in the last {@link SYNC_GAP_MS}. */
	refresh(): void {
		if (this.#sync || Date.now() - this.#syncedAt < SYNC_GAP_MS) return;
		this.sync().catch(err => console.error(`context index: ${errorText(err)}`));
	}

	/** Each file's requests and each file's sources since `cutoff`, `null` for all time. */
	read(cutoff: number | null): ContextRows {
		return {
			files: this.#db.query<ContextFileRow, [number]>(FILE_ROWS).all(cutoff ?? 0),
			sources: this.#db.query<ContextSourceRow, [number]>(SOURCE_ROWS).all(cutoff ?? 0),
		};
	}

	close(): void {
		this.#db.close();
	}

	async #run(): Promise<void> {
		const known = new Map(this.#db.query<{ path: string; size: number; mtime: number }, []>("SELECT path, size, mtime FROM files").all().map(row => [row.path, row]));
		const changed: { path: string; size: number; mtime: number }[] = [];
		for await (const path of new Bun.Glob("**/*.jsonl").scan({ cwd: this.#root, absolute: true })) {
			const info = await stat(path).catch(() => null);
			if (!info?.isFile()) continue;
			const was = known.get(path);
			if (was?.size !== info.size || was.mtime !== info.mtimeMs) changed.push({ path, size: info.size, mtime: info.mtimeMs });
		}
		this.#progress = { current: 0, total: changed.length };
		const counterFor = countersByModel();
		const sourceIds = new Map(this.#db.query<{ id: number; name: string }, []>("SELECT id, name FROM sources").all().map(row => [row.name, row.id]));
		const addSource = this.#db.query<{ id: number }, [string]>("INSERT INTO sources (name) VALUES (?) RETURNING id");
		const addTurn = this.#db.query<{ id: number }, [number, string, number, number, number]>("INSERT INTO turns (file, entry_id, at, input, cost) VALUES (?, ?, ?, ?, ?) RETURNING id");
		const addPart = this.#db.query("INSERT OR REPLACE INTO turn_sources VALUES (?, ?, ?)");
		const write = this.#db.transaction((file: { path: string; size: number; mtime: number }, cwd: string, turns: readonly Turn[]) => {
			const { id: fileId } = this.#db
				.query<{ id: number }, [string, number, number, string]>(
					"INSERT INTO files (path, size, mtime, cwd) VALUES (?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, cwd = excluded.cwd RETURNING id",
				)
				.get(file.path, file.size, file.mtime, cwd)!;
			this.#db.run("DELETE FROM turn_sources WHERE turn IN (SELECT id FROM turns WHERE file = ?)", [fileId]);
			this.#db.run("DELETE FROM turns WHERE file = ?", [fileId]);
			for (const { entryId, at, input, cost, tokens } of turns) {
				const { id: turnId } = addTurn.get(fileId, entryId, at, input, cost)!;
				for (const [name, n] of tokens) {
					let sourceId = sourceIds.get(name);
					if (sourceId === undefined) sourceIds.set(name, (sourceId = addSource.get(name)!.id));
					addPart.run(turnId, sourceId, n);
				}
			}
		});
		for (const [index, file] of changed.entries()) {
			try {
				const { cwd, turns } = await readFile(file.path, counterFor);
				write(file, cwd, turns);
			} catch (err) {
				// Recorded with no requests, so a file omp cannot read is not read again until it changes.
				console.error(`context index: cannot read ${file.path}: ${errorText(err)}`);
				write(file, "", []);
			}
			this.#progress = { current: index + 1, total: changed.length };
			// Each file is read in one go; yield between files so requests keep being served during a long sync.
			await Bun.sleep(0);
		}
	}
}

let shared: ContextIndex | null = null;

/** The server's index beside omp-stats' database, over omp's sessions directory, opened on first use. */
export function contextIndex(): ContextIndex {
	shared ??= new ContextIndex(join(dirname(dirs.getStatsDbPath()), "context-sources.db"), dirs.getSessionsDir());
	return shared;
}
