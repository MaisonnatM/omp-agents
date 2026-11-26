import { access } from "node:fs/promises";
import { branchAt, type HeadHistory, type WorktreeAt } from "./git";
import type { SessionBranch } from "./shared/sessions";

/** What git says of the branch a session works on. */
export type GitBranch = Pick<SessionBranch, "name" | "linked">;

export const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

/** `ask`, asking about each directory once. */
export function once<T>(ask: (dir: string) => Promise<T>): (dir: string) => Promise<T> {
	const asked = new Map<string, Promise<T>>();
	return dir => {
		let answer = asked.get(dir);
		if (!answer) asked.set(dir, (answer = ask(dir)));
		return answer;
	};
}

/**
 * What git says of the branch a session that last wrote at `at`, in ms, works on in `dir`: in a linked worktree the one
 * checked out now, in a main checkout the one checked out at `at`; `null` on a detached HEAD, outside git, or once `dir` is gone.
 */
export async function gitBranch(
	dir: string,
	at: number,
	worktreeAt: (dir: string) => Promise<WorktreeAt | null>,
	historyOf: (dir: string) => Promise<HeadHistory | null>,
): Promise<GitBranch | null> {
	if (!(await exists(dir))) return null;
	const checkout = await worktreeAt(dir);
	if (!checkout) return null;
	if (checkout.linked) return checkout.branch === null ? null : { name: checkout.branch, linked: true };
	const history = await historyOf(dir);
	const name = history && branchAt(history, at);
	return name ? { name, linked: false } : null;
}

/**
 * The branch whose PR a session on `branch` links: a linked worktree's, or a main checkout's other than its default
 * branch `defaultBranch`, which every session there shares; `null` for none, and while git names no default.
 */
export function linkingBranch(branch: GitBranch | null, defaultBranch: string | null): string | null {
	return branch && (branch.linked || (defaultBranch !== null && branch.name !== defaultBranch)) ? branch.name : null;
}

/**
 * The linked worktree of `cwd`'s repository, other than the one `cwd` is in, that the most recent of `workDirs` in
 * one is in. Directories in `cwd`'s own checkout, outside git, or in another repository are passed over; a directory
 * that is gone ends the search with `null`, since it may be a worktree removed since, and an older one is stale.
 */
export async function workingWorktree(cwd: string, workDirs: readonly string[], worktreeAt: (dir: string) => Promise<WorktreeAt | null>): Promise<string | null> {
	if (workDirs.length === 0) return null;
	const own = await worktreeAt(cwd);
	if (!own) return null;
	for (const dir of workDirs) {
		if (!(await exists(dir))) return null;
		const at = await worktreeAt(dir);
		if (at && at.top !== own.top && at.common === own.common) return at.top;
	}
	return null;
}
