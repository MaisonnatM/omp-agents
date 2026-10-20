/** omp's session files: listing them and reading whether a process left one mid-turn. */
import { basename, dirname, join } from "node:path";
import { oneLine } from "../session-entries";
import type { SessionSource } from "../shared/sessions";
import { isDashboardPrompt } from "../shared/transcript";
import { dirs, exitDiagnostics, type FileEntry, listing, loader, type SessionInfo, sessionEntries, storage } from "./modules";

/** omp's sessions root: one directory per working directory, each holding `<time>_<id>.jsonl` files. */
export const sessionsDir: string = dirs.getSessionsDir();

/** A session file on disk, newest first in {@link listSessionFiles}. Claude Code's and Codex's readers list theirs in this shape too. */
export interface SavedSession {
	id: string;
	path: string;
	source: SessionSource;
	cwd: string;
	/** The session's title, else its first prompt as one line. */
	title: string | null;
	modifiedAt: number;
	/** A 0-turn stub, which omp's own picker hides. */
	empty: boolean;
}

function saved(session: SessionInfo): SavedSession {
	return {
		id: session.id,
		path: session.path,
		source: "omp",
		cwd: session.cwd,
		// omp writes this placeholder when the prefix it scans holds no user text.
		title:
			session.title ||
			(session.firstMessage && session.firstMessage !== "(no messages)" && !isDashboardPrompt(session.firstMessage) ? oneLine(session.firstMessage) : null),
		modifiedAt: session.modified.getTime(),
		empty: listing.isEmptySession(session),
	};
}

/** Every session file under omp's sessions directory (or `root`, one directory per working directory), newest first. */
export async function listSessionFiles(root: string = sessionsDir): Promise<SavedSession[]> {
	return (await listing.listAllSessions(new storage.FileSessionStorage(), root)).map(saved);
}

/** omp's `.<file>.jsonl.lock` sidecars: on macOS a burst of writes to a session file can surface only as events for these. */
const SIDECAR = /^\.(.+\.jsonl)\.lock(?:\.os)?$/;

/**
 * The session file a watcher event at `changedPath` is about, or `null` for anything else.
 * Session files sit one directory below `root`; deeper files belong to subagents.
 */
export function sessionFileOf(changedPath: string, root: string): string | null {
	if (dirname(dirname(changedPath)) !== root) return null;
	const name = basename(changedPath);
	const file = name.startsWith(".") ? SIDECAR.exec(name)?.[1] : name;
	return file?.endsWith(".jsonl") ? join(dirname(changedPath), file) : null;
}

/** omp's file storage that sees one file in a directory, so that omp's own scan (and its cache) reads just that file. */
class OneFileStorage extends storage.FileSessionStorage {
	readonly #path: string;

	constructor(path: string) {
		super();
		this.#path = path;
	}

	override listFilesSync(): string[] {
		return [this.#path];
	}
}

/** One session file as {@link listSessionFiles} would list it; `null` when it is gone or no longer holds a session. */
export async function readSessionFile(path: string): Promise<SavedSession | null> {
	const [session] = await listing.listSessionsReadOnly(dirname(path), new OneFileStorage(path));
	return session ? saved(session) : null;
}

/**
 * Whether omp, opening `sessionFile`, would append an abort record because the process that
 * last held it exited mid-turn (omp's `switchSession`). Read-only.
 */
export async function endsMidTurn(sessionFile: string): Promise<boolean> {
	const entries = (await loader.loadEntriesFromFile(sessionFile)).filter(entry => entry.type !== "session");
	const byId = new Map(entries.map(entry => [entry.id, entry]));
	// omp checks the branch from the leaf it replays to, which a late usage entry can move off the last entry.
	const leafId = sessionEntries.resolveSessionLeafId(entries);
	const branch: FileEntry[] = [];
	const seen = new Set<string>();
	for (let entry = leafId ? byId.get(leafId) : undefined; entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
		seen.add(entry.id);
		branch.push(entry);
	}
	// omp passes the session's model as the fallback; any model makes this answer cover every case omp repairs.
	const anyModel = { api: "", provider: "", model: "" };
	return exitDiagnostics.createInterruptedTurnAbortMessage(branch.reverse(), anyModel) !== undefined;
}
