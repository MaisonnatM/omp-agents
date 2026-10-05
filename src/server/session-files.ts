/** Every session file on disk, newest first, with the pull requests each session worked on. */
import { basename, dirname, join } from "node:path";
import { repoOf } from "../github";
import { listSessionFiles, readSessionFile, type SavedSession, sessionsDir } from "../omp/sessions";
import { displayPath } from "../paths";
import { PullRequestIndex } from "../pull-requests";
import type { SessionFacts } from "../live-session";
import type { LinkedPullRequest, PastSession } from "../shared";

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

export class SessionFiles {
	#byPath = new Map<string, SavedSession>();
	/** Newest first; rebuilt from {@link #byPath} when a refresh changed it. */
	#files: SavedSession[] = [];
	#byId = new Map<string, SavedSession>();
	/** Session files the watcher reported since the last refresh. */
	#touched = new Set<string>();
	/** Scans and refreshes run one after another, so a slow full scan never overwrites a newer single-file read. */
	#chain: Promise<unknown> = Promise.resolve();
	readonly pullRequests = new PullRequestIndex(repoOf);
	readonly #root: string;

	/** `root`: omp's sessions directory, one directory per working directory. */
	constructor(root: string = sessionsDir) {
		this.#root = root;
	}

	/** The file of session `sessionId`, or `null` while it is not listed. */
	readonly pathOf = (sessionId: string): string | null => this.#byId.get(sessionId)?.path ?? null;

	/** What the pull-request index knows of session `sessionId`'s transcript. */
	readonly pullRequestsOf = (sessionId: string): LinkedPullRequest[] => {
		const path = this.pathOf(sessionId);
		return path ? this.pullRequests.of(path) : [];
	};

	/** What the index knows of session `sessionId`: its pull requests and /ship stage. */
	readonly factsOf = (sessionId: string): SessionFacts => {
		const path = this.pathOf(sessionId);
		return path ? this.#factsAt(path) : { pullRequests: [], ship: null };
	};

	#factsAt(path: string): SessionFacts {
		return { pullRequests: this.pullRequests.of(path), ship: this.pullRequests.shipOf(path) };
	}

	/** Directories sessions ran in, newest first. Sessions from old omp versions recorded none. */
	cwds(): string[] {
		return this.#files.map(session => session.cwd).filter(Boolean);
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
	}

	/** Read the transcripts for the pull requests they touched; whether any link changed. The first read covers every transcript. */
	linkPullRequests(): Promise<boolean> {
		return this.pullRequests.refresh(this.#files);
	}

	/** The saved sessions that no live session continues, newest first. `interrupted` names those that stopped without End session. */
	past(liveSessionIds: ReadonlySet<string>, interrupted: (sessionId: string) => boolean): PastSession[] {
		return this.#files
			.filter(session => !session.empty && !liveSessionIds.has(session.id))
			.map(session => ({
				sessionId: session.id,
				title: session.title,
				cwd: session.cwd,
				cwdDisplay: displayPath(session.cwd),
				modifiedAt: session.modifiedAt,
				...this.#factsAt(session.path),
				interrupted: interrupted(session.id),
			}));
	}
}
