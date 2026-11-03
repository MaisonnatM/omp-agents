/**
 * What omp keeps of a session outside its file: its prompts, recap, and title in `history.db`, and the marker it leaves
 * for a session file outside its sessions root. Forgetting a session removes them as `omp gc` does for an archived one.
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dirs } from "./modules";

/** Remove omp's history rows of `sessionIds` and its markers of `sessionFiles`; what is already gone stays gone. */
export async function forgetSessions(sessionIds: string[], sessionFiles: string[]): Promise<void> {
	deleteHistoryRows(dirs.getHistoryDbPath(), sessionIds);
	await Promise.all(sessionFiles.map(removeMarker));
}

/** omp's `deleteHistoryRowsForSessions` (src/cli/gc-cli.ts), which it does not export. */
function deleteHistoryRows(dbPath: string, sessionIds: string[]): void {
	if (sessionIds.length === 0 || !existsSync(dbPath)) return;
	const db = new Database(dbPath);
	try {
		db.run("PRAGMA busy_timeout = 5000");
		const hasHistory = hasTable(db, "history") && hasSessionColumn(db);
		const hasRecaps = hasTable(db, "session_recaps");
		const hasTitles = hasTable(db, "session_titles");
		const hasFts = hasHistory && hasTable(db, "history_fts");
		using history = hasHistory ? db.prepare("DELETE FROM history WHERE session_id = ?") : undefined;
		using recaps = hasRecaps ? db.prepare("DELETE FROM session_recaps WHERE session_id = ?") : undefined;
		using titles = hasTitles ? db.prepare("DELETE FROM session_titles WHERE session_id = ?") : undefined;
		db.transaction(() => {
			let deleted = 0;
			for (const id of sessionIds) {
				recaps?.run(id);
				titles?.run(id);
				deleted += history?.run(id).changes ?? 0;
			}
			// The full-text index is external content, so it keeps the deleted prompts until rebuilt.
			if (deleted > 0 && hasFts) db.run("INSERT INTO history_fts(history_fts) VALUES('rebuild')");
		})();
	} finally {
		db.close();
	}
}

function hasTable(db: Database, table: string): boolean {
	using statement = db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?");
	return statement.get(table) !== null;
}

function hasSessionColumn(db: Database): boolean {
	using statement = db.prepare("SELECT 1 FROM pragma_table_info('history') WHERE name = 'session_id'");
	return statement.get() !== null;
}

/** omp names a marker by a short hash of the file's path, which another file can share, so only a marker naming `file` goes. */
async function removeMarker(file: string): Promise<void> {
	const path = resolve(file);
	const marker = join(dirs.getCustomSessionFilesDir(), dirs.hashPath(path));
	const named = await readFile(marker, "utf8").catch(() => null);
	if (named === path) await rm(marker, { force: true });
}
