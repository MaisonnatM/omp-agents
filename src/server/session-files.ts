/** Every session file on disk, newest first, with the pull requests each session worked on. */
import { basename, dirname, join } from "node:path";
import { searchConversations } from "../conversation-search";
import { headHistory, worktreeAt } from "../git";
import { repoOf } from "../github";
import { listSessionFiles, readSessionFile, type SavedSession, sessionsDir } from "../omp/sessions";
import { displayPath } from "../paths";
import { SessionFactsIndex } from "../session-facts";
import type { ConversationHit, PastSession, SessionFacts } from "../shared/sessions";

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

const sameSession = (a: SavedSession, b: SavedSession): boolean =>
	a.id === b.id && a.cwd === b.cwd && a.title === b.title && a.modifiedAt === b.modifiedAt && a.empty === b.empty;

/** Whether two answers of `factsOf` are the same facts: each field keeps its identity until it changes. */
const sameFacts = (a: SessionFacts, b: SessionFacts): boolean =>
	a.pullRequests === b.pullRequests && a.tickets === b.tickets && a.ship === b.ship && a.worktree === b.worktree;

/** A past-list row and what it was built from. */
interface PastRow {
	saved: SavedSession;
	facts: SessionFacts;
	interrupted: boolean;
	row: PastSession;
}

export class SessionFiles {
	#byPath = new Map<string, SavedSession>();
	/** Newest first; rebuilt from {@link #byPath} when a refresh changed it. */
	#files: SavedSession[] = [];
	#byId = new Map<string, SavedSession>();
	/** Session files the watcher reported since the last refresh. */
	#touched = new Set<string>();
	/** Scans and refreshes run one after another, so a slow full scan never overwrites a newer single-file read. */
	#chain: Promise<unknown> = Promise.resolve();
	readonly facts = new SessionFactsIndex(repoOf, worktreeAt, headHistory);
	/** The last past-list row of each listed file, rebuilt only when what it shows changed. */
	readonly #rows = new Map<string, PastRow>();
	readonly #root: string;

	/** `root`: omp's sessions directory, one directory per working directory. */
	constructor(root: string = sessionsDir) {
		this.#root = root;
	}

	/** The file of session `sessionId`, or `null` while it is not listed. */
	readonly pathOf = (sessionId: string): string | null => this.#byId.get(sessionId)?.path ?? null;

	/** Session `sessionId`'s listed file, or `null` while it is not listed. */
	readonly savedOf = (sessionId: string): SavedSession | null => this.#byId.get(sessionId) ?? null;

	/** What the index knows of session `sessionId`: its pull requests, Linear issues, /ship stage, and worktree. */
	readonly factsOf = (sessionId: string): SessionFacts => {
		const path = this.pathOf(sessionId);
		return path ? this.facts.factsOf(path) : { pullRequests: [], tickets: [], ship: null, worktree: null };
	};

	/** Directories sessions ran in, newest first. Sessions from old omp versions recorded none. */
	cwds(): string[] {
		return this.#files.map(session => session.cwd).filter(Boolean);
	}

	/** Session-file activity for the worktree inventory, including a session whose directory sits inside a checkout. */
	activity(): { id: string; cwd: string; modifiedAt: number }[] {
		return this.#files.map(({ id, cwd, modifiedAt }) => ({ id, cwd, modifiedAt }));
	}

	/** Note that the watcher reported a change at `changedPath`; whether it concerns a session file. {@link refresh} reads it. */
	touch(changedPath: string): boolean {
		const file = sessionFileOf(changedPath, this.#root);
		if (file) this.#touched.add(file);
		return file !== null;
	}

	/** List every file again; whether the list changed. The safety net for changes the watcher missed. */
	scan(): Promise<boolean> {
		return this.#queue(async () => {
			this.#touched.clear();
			const listed = await listSessionFiles(this.#root);
			const next = new Map(listed.map(session => [session.path, session]));
			const changed = next.size !== this.#byPath.size || listed.some(session => !this.#same(session));
			if (changed) this.#adopt(next);
			return changed;
		});
	}

	/** Read again just the files touched since the last call: one that is new joins the list, one that is gone or no longer holds a session leaves it. Whether the list changed. */
	refresh(): Promise<boolean> {
		return this.#queue(async () => {
			const paths = [...this.#touched];
			this.#touched.clear();
			const next = new Map(this.#byPath);
			let changed = false;
			for (const path of paths) {
				const session = await readSessionFile(path);
				const known = next.get(path);
				if (!session) {
					if (next.delete(path)) changed = true;
				} else if (!known || !sameSession(known, session)) {
					next.set(path, session);
					changed = true;
				}
			}
			if (changed) this.#adopt(next);
			return changed;
		});
	}

	#queue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.#chain.then(task);
		this.#chain = run.catch(() => {});
		return run;
	}

	#same(session: SavedSession): boolean {
		const known = this.#byPath.get(session.path);
		return known !== undefined && sameSession(known, session);
	}

	#adopt(byPath: Map<string, SavedSession>): void {
		this.#byPath = byPath;
		this.#files = [...byPath.values()].sort((a, b) => b.modifiedAt - a.modifiedAt || b.path.localeCompare(a.path));
		this.#byId = new Map(this.#files.map(file => [file.id, file]));
		for (const path of this.#rows.keys()) if (!byPath.has(path)) this.#rows.delete(path);
	}

	/** Read the transcripts for what they link to; whether any session's pull requests, Linear issues, or /ship stage changed. The first read covers every transcript. */
	refreshFacts(): Promise<boolean> {
		return this.facts.refresh(this.#files);
	}

	/** The listed conversations whose prompts or replies hold every word of `query`, the file changed last first, once the transcripts asked for are read. */
	async searchConversations(query: string): Promise<ConversationHit[]> {
		await this.facts.settled();
		return searchConversations(this.#files, path => this.facts.conversationOf(path), query);
	}

	/**
	 * The saved sessions that no live session continues, newest first. `interrupted` names those that stopped without End session.
	 * A row whose file, facts, and interruption did not change since the last call is the same object, so a caller can skip it by identity.
	 */
	past(liveSessionIds: ReadonlySet<string>, interrupted: (sessionId: string) => boolean): PastSession[] {
		return this.#files
			.filter(session => !session.empty && !liveSessionIds.has(session.id))
			.map(session => {
				const facts = this.facts.factsOf(session.path);
				const stopped = interrupted(session.id);
				const kept = this.#rows.get(session.path);
				if (kept && kept.saved === session && kept.interrupted === stopped && sameFacts(kept.facts, facts)) return kept.row;
				const row: PastSession = {
					sessionId: session.id,
					title: session.title,
					cwd: session.cwd,
					cwdDisplay: displayPath(session.cwd),
					modifiedAt: session.modifiedAt,
					...facts,
					interrupted: stopped,
				};
				this.#rows.set(session.path, { saved: session, facts, interrupted: stopped, row });
				return row;
			});
	}
}
