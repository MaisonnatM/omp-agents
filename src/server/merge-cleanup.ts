/**
 * The cleanup after a merge: each live session this dashboard started that is linked to a pull request that merged while
 * this server watched ends, with its linked worktree and the local branch of the pull request it merged, once it is idle
 * with every pull request it links merged or closed. The worktree goes through `Worktrees.removeCheckout`, which keeps it
 * while any live session, a terminal one included, still works in it or it has changes, and the
 * branch only while it still points at the merged commit. It hears of a merge the queue made at once, and looks every two
 * minutes for one made anywhere else; the first look at a pull request only records it, so a dashboard start ends nothing
 * for a merge made before it. Every look settles the sessions a merge left waiting again, so one whose end failed, or
 * whose last pull request closed later, ends then.
 */
import { errorText } from "../json";
import type { PullRequestState } from "../pull-request-merge";
import { type PullRequest, prKey, type Repo, repoKey, samePullRequest } from "../shared/github";

/** How many minutes pass between two looks. */
const CLEANUP_WATCH_MINUTES = 2;

/** A live session the cleanup may end, with where it works. */
export interface CleanupSession {
	sessionId: string;
	idle: boolean;
	pullRequests: readonly PullRequest[];
	/** The directory it works in: its linked worktree, else its own. */
	workDir: string;
	/** The branch it works on in a linked worktree, `null` in a main checkout, where the cleanup deletes no branch. */
	branch: string | null;
}

/** The checkout a session works in: its repository's git directory and the GitHub repository `origin` names. */
export interface CleanupCheckout {
	gitDir: string;
	repo: Repo | null;
}

export interface MergeCleanupDeps {
	/** The live sessions a merge may end: those {@link cleanupEnds} lets it end. */
	sessions(): CleanupSession[];
	/** Where each of `prs` stands, by {@link prKey}. */
	states(prs: readonly PullRequest[]): Promise<Map<string, PullRequestState>>;
	/** The checkout `dir` is in, read before the session's worktree goes; `null` outside git. */
	checkout(dir: string): Promise<CleanupCheckout | null>;
	/** Ends session `sessionId` as **End session** does, which removes its linked worktree unless something keeps it; rejects when it did not end. */
	end(sessionId: string): Promise<void>;
	/** Deletes `branch` of `gitDir` while it still points at `head` and no worktree holds it. */
	deleteBranch(gitDir: string, branch: string, head: string): Promise<boolean>;
}

/** A live session as the settings see it: whether this dashboard started it, and its place in a project, `watches` when that project watches its pull requests. */
export interface CleanupHost {
	startedHere: boolean;
	project: { role: "coordinator" | "worker"; watches: boolean } | null;
}

/**
 * Whether the cleanup may end `host`: only a session this dashboard started, never one in a terminal or one another
 * dashboard owns; a project's worker while its project watches its pull requests, never a coordinator, and any other
 * session while `cleanUp` is on.
 */
export function cleanupEnds(host: CleanupHost, cleanUp: boolean): boolean {
	if (!host.startedHere) return false;
	if (host.project) return host.project.role === "worker" && host.project.watches;
	return cleanUp;
}

export class MergeCleanup {
	readonly #deps: MergeCleanupDeps;
	/** Each pull request of a live session as the last look saw it, by {@link prKey}. */
	readonly #seen = new Map<string, PullRequestState>();
	/** The sessions linked to a pull request that merged while this server watched: each ends once it is idle with every pull request settled. */
	readonly #finishing = new Set<string>();
	/** The sessions it is ending, which it never ends twice. */
	readonly #ending = new Set<string>();
	#minutes = 0;
	#looking = false;

	constructor(deps: MergeCleanupDeps) {
		this.#deps = deps;
	}

	/** The queue merged `pr`, whose head was `branch` at `head`: cleans up after it now rather than at the next look, and settles once that cleanup does. */
	merged(pr: PullRequest & Omit<PullRequestState, "state">): Promise<void> {
		this.#seen.set(prKey(pr), { state: "merged", branch: pr.branch, head: pr.head });
		this.#watch([pr]);
		return this.#settle();
	}

	/** A minute passed: every {@link CLEANUP_WATCH_MINUTES}, reads the live sessions' pull requests not yet merged or closed, then settles; a look while one runs is skipped. */
	async tick(): Promise<void> {
		if (++this.#minutes < CLEANUP_WATCH_MINUTES || this.#looking) return;
		this.#minutes = 0;
		this.#looking = true;
		try {
			await this.#look();
			await this.#settle();
		} finally {
			this.#looking = false;
		}
	}

	async #look(): Promise<void> {
		const unsettled = new Map<string, PullRequest>();
		for (const session of this.#deps.sessions()) for (const pr of session.pullRequests) if (!this.#settled(pr)) unsettled.set(prKey(pr), pr);
		if (unsettled.size === 0) return;
		const states = await this.#deps.states([...unsettled.values()]).catch((error: unknown) => {
			console.error(`omp-agents: cannot read the sessions' pull requests: ${errorText(error)}`);
			return null;
		});
		if (!states) return;
		const merged: PullRequest[] = [];
		for (const [key, pr] of unsettled) {
			const now = states.get(key);
			if (!now) continue;
			if (this.#seen.has(key) && now.state === "merged") merged.push(pr);
			this.#seen.set(key, now);
		}
		this.#watch(merged);
	}

	#settled(pr: PullRequest): boolean {
		const state = this.#seen.get(prKey(pr))?.state;
		return state === "merged" || state === "closed";
	}

	/** Each live session linked to one of `merged` waits to end. */
	#watch(merged: readonly PullRequest[]): void {
		if (merged.length === 0) return;
		for (const session of this.#deps.sessions()) if (session.pullRequests.some(pr => merged.some(other => samePullRequest(pr, other)))) this.#finishing.add(session.sessionId);
	}

	/** Ends each waiting session that is idle with every pull request merged or closed; one whose end fails waits for the next look. */
	async #settle(): Promise<void> {
		if (this.#finishing.size === 0) return;
		const live = this.#deps.sessions();
		for (const sessionId of this.#finishing) if (!live.some(session => session.sessionId === sessionId)) this.#finishing.delete(sessionId);
		const done = live.filter(session => this.#finishing.has(session.sessionId) && !this.#ending.has(session.sessionId) && session.idle && session.pullRequests.every(pr => this.#settled(pr)));
		await Promise.all(
			done.map(async session => {
				this.#ending.add(session.sessionId);
				try {
					await this.#finish(session);
					this.#finishing.delete(session.sessionId);
				} catch (error) {
					console.error(`omp-agents: cannot end session ${session.sessionId} after its merge: ${errorText(error)}`);
				} finally {
					this.#ending.delete(session.sessionId);
				}
			}),
		);
	}

	/** Ends `session`, then deletes its branch when that is the head branch of a pull request of its own repository that merged. */
	async #finish(session: CleanupSession): Promise<void> {
		const { branch } = session;
		const checkout = branch === null ? null : await this.#deps.checkout(session.workDir);
		const repo = checkout?.repo;
		const merged = repo
			? session.pullRequests.flatMap(pr => {
					const state = this.#seen.get(prKey(pr));
					return repoKey(pr) === repoKey(repo) && state?.state === "merged" && state.branch === branch ? [state] : [];
				})[0]
			: undefined;
		await this.#deps.end(session.sessionId);
		if (!checkout || !merged || branch === null) return;
		await this.#deps.deleteBranch(checkout.gitDir, branch, merged.head).catch((error: unknown) => console.error(`omp-agents: cannot delete the merged branch ${branch}: ${errorText(error)}`));
	}
}
