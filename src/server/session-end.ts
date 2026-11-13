/**
 * Ending a session, from **End session** in the page or from omp's `end_session` tool: stop it, then remove the linked
 * git worktree it worked in, with the checks of Settings → Worktrees, and keep its branch. A main checkout or a directory
 * outside git stays as it is; a worktree those checks keep, such as a dirty one, stays listed there, and the server logs why.
 * The removed worktree is remembered, so a resume of the session adds it back where its agent left it.
 */
import { access } from "node:fs/promises";
import { JsonFile } from "../fs";
import { mainCheckoutOf, restoreWorktree, worktreeAt } from "../git";
import { errorText, isObject } from "../json";
import { displayPath } from "../paths";
import type { WorktreeRemovalResult } from "../worktrees-shared";

export interface EndingSession {
	sessionId: string;
	/** Where it works: the linked worktree its bash calls last ran in, else its own directory. */
	workDir: string;
	end(): Promise<void>;
}

/** Removes the linked worktree `dir` is in; `null` when it is in none. */
export type RemoveCheckout = (dir: string) => Promise<WorktreeRemovalResult | null>;

/** A linked worktree that ending a session removed. */
export interface EndedWorktree {
	/** Its root directory. */
	path: string;
	/** Its repository's main checkout, else the git directory of a bare repository: where git adds it back. */
	repository: string;
	/** The branch it had checked out, which ending the session keeps. */
	branch: string;
}

/** Ends `session`, removes its worktree, and hands `remember` the worktree it removed, when it was on a branch. */
export async function endSession(session: EndingSession, removeCheckout: RemoveCheckout, remember: (worktree: EndedWorktree) => void): Promise<void> {
	try {
		await session.end();
	} catch (err) {
		console.error(`omp-agents: could not end session ${session.sessionId}: ${errorText(err)}`);
		throw err;
	}
	let why: string | null;
	try {
		const at = await worktreeAt(session.workDir);
		const result = await removeCheckout(session.workDir);
		if (result?.removed && at?.linked && at.branch) remember({ path: at.top, repository: mainCheckoutOf(at) ?? at.common, branch: at.branch });
		why = !result || result.removed ? null : (result.error ?? result.blockers.map(blocker => blocker.message).join(" "));
	} catch (err) {
		why = errorText(err);
	}
	if (why) console.error(`omp-agents: kept the worktree ${displayPath(session.workDir)} of ended session ${session.sessionId}: ${why}`);
}

/**
 * Adds back `ended`, the worktree that ending a session removed, before the session resumes, so its agent finds the
 * directory it worked in: on its branch while that branch exists, else on a new branch of that name, as a new
 * session's work branch starts. Nothing when no worktree was removed or its directory exists again.
 * @throws Error when its repository is gone, so the session never starts on a missing directory, or when git cannot add it.
 */
export async function restoreEndedWorktree(ended: EndedWorktree | null): Promise<void> {
	if (!ended || (await access(ended.path).then(() => true, () => false))) return;
	if (!(await access(ended.repository).then(() => true, () => false))) throw new Error(`the repository ${displayPath(ended.repository)} of this session's worktree ${displayPath(ended.path)} no longer exists`);
	try {
		await restoreWorktree(ended.repository, ended.path, ended.branch);
	} catch (err) {
		throw new Error(`cannot add back this session's worktree ${displayPath(ended.path)} on ${ended.branch}: ${errorText(err)}`);
	}
	console.log(`omp-agents: added back the worktree ${displayPath(ended.path)} on ${ended.branch} for a resumed session`);
}

/** The most sessions {@link EndedWorktrees} remembers; it forgets the oldest past that. */
const KEPT = 500;

interface Saved {
	worktrees: Array<{ sessionId: string } & EndedWorktree>;
}

const isSaved = (value: unknown): value is Saved =>
	isObject(value) &&
	Array.isArray(value.worktrees) &&
	value.worktrees.every(
		(entry: unknown) =>
			isObject(entry) && typeof entry.sessionId === "string" && typeof entry.path === "string" && typeof entry.repository === "string" && typeof entry.branch === "string",
	);

/** The worktrees that ending sessions removed, by session id, which a file keeps across restarts. */
export class EndedWorktrees {
	readonly #file: JsonFile<Saved>;
	/** Oldest first. */
	readonly #bySession: Map<string, EndedWorktree>;

	constructor(path: string) {
		this.#file = new JsonFile(path, { parse: value => (isSaved(value) ? value : null), holds: "a list of ended sessions' worktrees", onInvalid: "ignore" });
		this.#bySession = new Map((this.#file.load()?.worktrees ?? []).map(({ sessionId, path, repository, branch }) => [sessionId, { path, repository, branch }]));
	}

	/** Remembers that ending session `sessionId` removed `worktree`. */
	record(sessionId: string, worktree: EndedWorktree): void {
		this.#bySession.delete(sessionId);
		this.#bySession.set(sessionId, worktree);
		for (const oldest of this.#bySession.keys()) {
			if (this.#bySession.size <= KEPT) break;
			this.#bySession.delete(oldest);
		}
		this.#file.save({ worktrees: [...this.#bySession].map(([sessionId, ended]) => ({ sessionId, ...ended })) });
	}

	/** The worktree that ending the first of `sessionIds` that has one removed; `null` when none does. */
	of(sessionIds: readonly string[]): EndedWorktree | null {
		for (const sessionId of sessionIds) {
			const ended = this.#bySession.get(sessionId);
			if (ended) return ended;
		}
		return null;
	}
}
