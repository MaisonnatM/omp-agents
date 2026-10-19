/**
 * The cleanup after a merge: once a pull request merges, each idle session it leaves with every pull request merged or
 * closed ends, with its linked worktree, and the local branch of the pull request it merged. The worktree goes through
 * `Worktrees.removeCheckout`, so a checkout with changes stays, and the branch only while it still points at the merged
 * commit. It hears of a merge the dashboard made at once, and looks every two minutes for one made anywhere else; the
 * first look at a pull request only records it, so a dashboard start ends nothing for a merge made before it.
 */
import { errorText } from "../json";
import type { PullRequestState } from "../pull-request-merge";
import { type PullRequest, prKey, pullRequestName, samePullRequest } from "../shared/github";

/** How many minutes pass between two looks. */
const CLEANUP_WATCH_MINUTES = 2;

/** A live session, as the cleanup decides whether a merge finished it. */
export interface CleanupCandidate {
	sessionId: string;
	idle: boolean;
	pullRequests: readonly PullRequest[];
}

/**
 * The sessions in `sessions` that a merge of `merged` leaves with nothing to do: idle, linked to one of `merged`, and with
 * every pull request they link merged or closed, as `settled` says. A session that works or asks, or one with a pull
 * request still open or not read yet, stays. Project workers and every other session follow this one rule.
 */
export function finishedSessions<T extends CleanupCandidate>(sessions: readonly T[], merged: readonly PullRequest[], settled: (pr: PullRequest) => boolean): T[] {
	if (merged.length === 0) return [];
	return sessions.filter(session => session.idle && session.pullRequests.some(pr => merged.some(other => samePullRequest(pr, other))) && session.pullRequests.every(settled));
}

/** A session the cleanup may end, with where it works. */
export interface CleanupSession extends CleanupCandidate {
	/** The directory it works in: its linked worktree, else its own. */
	workDir: string;
	/** The branch it works on in a linked worktree, `null` in a main checkout, where the cleanup deletes no branch. */
	branch: string | null;
}

export interface MergeCleanupDeps {
	/** Whether Settings › Source control has the cleanup on. */
	enabled(): boolean;
	/** The live sessions it may end: those no project runs, since a project ends its own workers. */
	sessions(): CleanupSession[];
	/** Where each of `prs` stands, by {@link prKey}. */
	states(prs: readonly PullRequest[]): Promise<Map<string, PullRequestState>>;
	/** The git directory of the repository `dir` is in, read before the session's worktree goes; `null` outside git. */
	gitDir(dir: string): Promise<string | null>;
	/** Ends session `sessionId` as **End session** does, which removes its linked worktree unless something keeps it. */
	end(sessionId: string): Promise<void>;
	/** Deletes `branch` of `gitDir` while it still points at `head` and no worktree holds it. */
	deleteBranch(gitDir: string, branch: string, head: string): Promise<boolean>;
}

export class MergeCleanup {
	readonly #deps: MergeCleanupDeps;
	/** Each pull request of a live session as the last look saw it, by {@link prKey}. */
	readonly #seen = new Map<string, PullRequestState>();
	/** The sessions it is ending, which it never ends twice. */
	readonly #ending = new Set<string>();
	#minutes = 0;
	#looking = false;

	constructor(deps: MergeCleanupDeps) {
		this.#deps = deps;
	}

	/** The dashboard merged `pr`, whose head was `branch` at `head`: cleans up after it now rather than at the next look, and settles once that cleanup does. */
	merged(pr: PullRequest & Omit<PullRequestState, "state">): Promise<void> {
		this.#seen.set(prKey(pr), { state: "merged", branch: pr.branch, head: pr.head });
		return this.#settle([pr]);
	}

	/** A minute passed: every {@link CLEANUP_WATCH_MINUTES}, reads the live sessions' pull requests not yet merged or closed; a look while one runs is skipped. */
	async tick(): Promise<void> {
		if (++this.#minutes < CLEANUP_WATCH_MINUTES || this.#looking || !this.#deps.enabled()) return;
		this.#minutes = 0;
		this.#looking = true;
		try {
			const open = new Map<string, PullRequest>();
			for (const session of this.#deps.sessions()) {
				for (const pr of session.pullRequests) {
					const state = this.#seen.get(prKey(pr))?.state;
					if (state !== "merged" && state !== "closed") open.set(prKey(pr), pr);
				}
			}
			if (open.size === 0) return;
			const states = await this.#deps.states([...open.values()]).catch((error: unknown) => {
				console.error(`omp-agents: cannot read the sessions' pull requests: ${errorText(error)}`);
				return null;
			});
			if (!states) return;
			const merged: PullRequest[] = [];
			for (const [key, pr] of open) {
				const now = states.get(key);
				if (!now) continue;
				if (this.#seen.has(key) && now.state === "merged") merged.push(pr);
				this.#seen.set(key, now);
			}
			await this.#settle(merged);
		} finally {
			this.#looking = false;
		}
	}

	/** Ends each session a merge of `merged` finished; settles once each end, and its branch's deletion, did or failed. */
	async #settle(merged: PullRequest[]): Promise<void> {
		if (!this.#deps.enabled()) return;
		const settled = (pr: PullRequest): boolean => {
			const state = this.#seen.get(prKey(pr))?.state;
			return state === "merged" || state === "closed";
		};
		const sessions = this.#deps.sessions().filter(session => !this.#ending.has(session.sessionId));
		const finishing = finishedSessions(sessions, merged, settled).map(session => {
			this.#ending.add(session.sessionId);
			return this.#finish(session)
				.catch((error: unknown) => console.error(`omp-agents: cannot clean up after ${merged.map(pullRequestName).join(", ")}: ${errorText(error)}`))
				.finally(() => this.#ending.delete(session.sessionId));
		});
		await Promise.all(finishing);
	}

	async #finish(session: CleanupSession): Promise<void> {
		const { branch } = session;
		const pr = branch === null ? undefined : session.pullRequests.map(linked => this.#seen.get(prKey(linked))).find(state => state?.state === "merged" && state.branch === branch);
		const gitDir = pr ? await this.#deps.gitDir(session.workDir) : null;
		await this.#deps.end(session.sessionId);
		if (gitDir && branch && pr) await this.#deps.deleteBranch(gitDir, branch, pr.head);
	}
}
