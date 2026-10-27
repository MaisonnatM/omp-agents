/** The page's activity events, in `activity.db`, which only the server holding `server.lock` writes. */
import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEvent, ActivityLastUse, ActivityRow } from "../shared/activity";

/** How long the store keeps a row: past a year, so the report can still say when a feature was last used a year ago. */
export const ACTIVITY_KEPT_DAYS = 400;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS activity (
	client TEXT NOT NULL,
	seq INTEGER NOT NULL,
	at INTEGER NOT NULL,
	kind TEXT NOT NULL,
	key TEXT NOT NULL,
	via TEXT,
	PRIMARY KEY (client, seq)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS activity_at ON activity (at);
CREATE INDEX IF NOT EXISTS activity_feature ON activity (kind, key, at);
`;

/**
 * Renames the Inbox page's views and commands to the Email page's, once: `PRAGMA user_version` 1 marks it done, so a
 * later Inbox feature's `inbox` rows keep their key. It holds the write lock, so a server opening the store meanwhile waits.
 */
function renameInboxToEmail(db: Database): void {
	db.transaction(() => {
		const { user_version: version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
		if (version >= 1) return;
		db.run("UPDATE activity SET key = 'email' || substr(key, 6) WHERE kind = 'view' AND (key = 'inbox' OR key GLOB 'inbox/*')");
		db.run("UPDATE activity SET key = 'email' || substr(key, 6) WHERE kind = 'command' AND (key = 'inbox' OR key GLOB 'inbox-*')");
		db.run("PRAGMA user_version = 1");
	}).immediate();
}

export class ActivityStore {
	readonly #db: Database;
	readonly #insert: Statement<never, [string, number, number, string, string, string | null]>;

	/** Opens or creates the store at `path`. */
	constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true });
		this.#db = new Database(path, { create: true });
		this.#db.run("PRAGMA journal_mode = WAL");
		this.#db.run("PRAGMA busy_timeout = 5000");
		this.#db.run(SCHEMA);
		renameInboxToEmail(this.#db);
		this.#insert = this.#db.query<never, [string, number, number, string, string, string | null]>("INSERT OR IGNORE INTO activity (client, seq, at, kind, key, via) VALUES (?, ?, ?, ?, ?, ?)");
	}

	/** Stores page load `client`'s `events`, numbered from `first`, in one transaction; a batch sent again changes nothing. */
	append(client: string, first: number, events: readonly ActivityEvent[]): void {
		this.#db.transaction(() => {
			events.forEach((event, index) => this.#insert.run(client, first + index, event.at, event.kind, event.key, event.via));
		})();
	}

	/** The rows at or after `cutoff`, by page load and sequence. */
	rows(cutoff: number): ActivityRow[] {
		return this.#db.query<ActivityRow, [number]>("SELECT client, seq, at, kind, key, via FROM activity WHERE at >= ? ORDER BY client, seq").all(cutoff);
	}

	/** Every feature's last use, whatever the range. */
	lastUsed(): ActivityLastUse[] {
		return this.#db.query<ActivityLastUse, []>("SELECT kind, key, MAX(at) AS at FROM activity WHERE kind != 'presence' GROUP BY kind, key").all();
	}

	/** Deletes the rows before `before`; one at `before` stays. */
	prune(before: number): void {
		this.#db.run("DELETE FROM activity WHERE at < ?", [before]);
	}

	close(): void {
		this.#db.close();
	}
}
