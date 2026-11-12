/** omp's session files: listing them, renaming one, and reading whether a process left one mid-turn. */
import { basename, dirname, isAbsolute, join } from "node:path";
import { oneLine } from "../session-entries";
import type { SessionSource } from "../shared/sessions";
import { promptAuthor } from "../shared/transcript";
import { dirs, exitDiagnostics, listing, loader, sessionEntries, sessionManager, storage } from "./modules";
import type { FileEntry, SessionInfo } from "./module-types/session";

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
	/** omp's only: the id of the session whose conversation this file goes on with, in a new file (header `continuationOf`). */
	continuationOf?: string;
}

/** The title a session's first prompt gives it: the user's or another Bot's as one line, a routine's name, none for the dashboard's. */
function firstTitle(firstMessage: string): string | null {
	// omp writes this placeholder when the prefix it scans holds no user text.
	if (!firstMessage || firstMessage === "(no messages)") return null;
	const author = promptAuthor(firstMessage);
	switch (author.kind) {
		case "user":
			return oneLine(firstMessage);
		case "routine":
			return author.message.routine.name;
		case "bot-message":
			return oneLine(author.message.text);
		case "dashboard":
			return null;
		default: {
			const unhandled: never = author;
			return unhandled;
		}
	}
}

function saved(session: SessionInfo): SavedSession {
	return {
		id: session.id,
		path: session.path,
		source: "omp",
		cwd: session.cwd,
		title: session.title || firstTitle(session.firstMessage),
		modifiedAt: session.modified.getTime(),
		empty: listing.isEmptySession(session),
		continuationOf: session.continuationOf,
	};
}

/** Every session file under omp's sessions directory (or `root`, one directory per working directory), newest first. */
export async function listSessionFiles(root: string = sessionsDir): Promise<SavedSession[]> {
	return (await listing.listAllSessions(new storage.FileSessionStorage(), root)).map(saved);
}

/**
 * The copy of `sessionFile`'s conversation that `omp --resume` opens, `null` when it is the file itself. omp goes on in a
 * sibling file with a new id when it cannot keep writing a session's file, such as while another omp process holds it.
 */
export async function continuationOf(sessionFile: string): Promise<SavedSession | null> {
	const continuation = await listing.findSessionContinuation(sessionFile);
	return continuation ? saved(continuation.session) : null;
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
 * The current native header of the session file at `path`, without the listing cache, bounded as omp's own header reader
 * is: its session id, and its cwd when absolute. `null` while the file has no header yet.
 */
export async function readSessionHeader(path: string): Promise<{ id: string; cwd: string | null; parentSession: string | null } | null> {
	let header: { id: string; cwd: string | null; parentSession: string | null } | null = null;
	await loader.visitEntriesFromFileStream(path, entry => {
		if (entry.type === "session" && typeof entry.id === "string") header = {
			id: entry.id,
			cwd: typeof entry.cwd === "string" && isAbsolute(entry.cwd) ? entry.cwd : null,
			parentSession: typeof entry.parentSession === "string" ? entry.parentSession : null,
		};
		return false;
	}, { maxRecords: 1, maxBytes: 1024 * 1024 });
	return header;
}

/**
 * Give the saved session at `path` `title` as the user's own, as omp's session picker does: under omp's lease on the
 * session, so it never writes beneath an omp process that holds the file, and refused while one does.
 */
export async function renameSessionFile(path: string, title: string, cwd: string): Promise<void> {
	// omp reads control characters as spaces and answers a blank title as it answers a held session, so it is refused first.
	if (!title.replace(/\p{Cc}/gu, "").trim()) throw new Error("omp kept the old title: a title needs a character other than spaces.");
	if ((await sessionManager.SessionManager.renameSessionTitle(path, title, { cwd })) === null) {
		throw new Error("This session is open in another omp window. Rename it there with /rename.");
	}
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
	const leaf = leafId === null ? undefined : byId.get(leafId);
	const branch: FileEntry[] = [];
	const seen = new Set<string>();
	for (let entry = leaf; entry && !seen.has(entry.id); entry = entry.parentId ? byId.get(entry.parentId) : undefined) {
		seen.add(entry.id);
		branch.push(entry);
	}
	// omp passes the session's model as the fallback; any model makes this answer cover every case omp repairs.
	const anyModel = { api: "", provider: "", model: "" };
	return exitDiagnostics.createInterruptedTurnAbortMessage(branch.reverse(), anyModel) !== undefined;
}
