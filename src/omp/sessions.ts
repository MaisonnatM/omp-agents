/** omp's session files: listing them and reading whether a process left one mid-turn. */
import { oneLine } from "../transcript";
import { dirs, exitDiagnostics, type FileEntry, listing, loader } from "./modules";

/** omp's sessions root: one directory per working directory, each holding `<time>_<id>.jsonl` files. */
export const sessionsDir: string = dirs.getSessionsDir();

/** A session file on disk, newest first in {@link listSessionFiles}. */
export interface SavedSession {
	id: string;
	path: string;
	cwd: string;
	/** The session's title, else its first prompt as one line. */
	title: string | null;
	modifiedAt: number;
	/** A 0-turn stub, which omp's own picker hides. */
	empty: boolean;
}

/** Every session file under omp's sessions directory, newest first. */
export async function listSessionFiles(): Promise<SavedSession[]> {
	const sessions = await listing.listAllSessions();
	return sessions.map(session => ({
		id: session.id,
		path: session.path,
		cwd: session.cwd,
		// omp writes this placeholder when the prefix it scans holds no user text.
		title:
			session.title ||
			(session.firstMessage && session.firstMessage !== "(no messages)" ? oneLine(session.firstMessage) : null),
		modifiedAt: session.modified.getTime(),
		empty: listing.isEmptySession(session),
	}));
}

/**
 * Whether omp, opening `sessionFile`, would append an abort record because the process that
 * last held it exited mid-turn (omp's `switchSession`). Read-only.
 */
export async function endsMidTurn(sessionFile: string): Promise<boolean> {
	const entries = (await loader.loadEntriesFromFile(sessionFile)).filter(entry => entry.type !== "session");
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	// omp checks the branch from the leaf, which on load is the last entry.
	const branch: FileEntry[] = [];
	const seen = new Set<string>();
	for (let entry = entries.at(-1); entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
		seen.add(entry.id);
		branch.push(entry);
	}
	// omp passes the session's model as the fallback; any model makes this answer cover every case omp repairs.
	const anyModel = { api: "", provider: "", model: "" };
	return exitDiagnostics.createInterruptedTurnAbortMessage(branch.reverse(), anyModel) !== undefined;
}
