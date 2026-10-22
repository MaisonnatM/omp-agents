/** Git checkouts and branches a new session can work on, and pull requests checked out locally. */
import type { PullRequest } from "./github";

/** A local branch, and the worktree that has it checked out, `null` when none has. */
export interface LocalBranch {
	name: string;
	worktree: string | null;
}

/** The git checkout a directory is in: what the new-session draft's branch picker lists. */
export interface GitCheckout {
	/** The branch checked out in the directory, `null` when HEAD is detached. */
	branch: string | null;
	/** Every local branch, the checked-out one first, then the most recently committed to. */
	branches: LocalBranch[];
	/** The repository's main worktree, beside which new worktrees go. */
	mainWorktree: string;
}

/** Where a new worktree for `branch` goes: beside the main worktree, named after both (`~/code/app-fix-login` for `fix/login`). */
export const worktreeDir = (mainWorktree: string, branch: string): string => `${mainWorktree}-${branch.replace(/[^\w.-]+/g, "-")}`;

/**
 * The branch a new session works on: an existing one, in the worktree that has it checked out (a new worktree beside
 * the main one when none has), or a new branch from `base`, always in a new worktree.
 */
export type BranchChoice = { kind: "existing"; name: string } | { kind: "new"; name: string; base: string };

/**
 * What `PUT /api/worktree/release` did with the linked worktree that has a branch checked out: `none` when no linked worktree
 * of the repository has it, `removed`, or `kept` with `why`, the checks that kept it or the removal's error.
 */
export type BranchRelease = { kind: "none" } | { kind: "removed"; path: string } | { kind: "kept"; path: string; why: string };

/** Where **Check out** puts a pull request: a worktree of its own with a new session on it, or the checkout the page knows, as `gh pr checkout` does. */
export type CheckoutPlace = "worktree" | "here";

/** The body of `PUT /api/pull-request/checkout`: pull request `number` of `owner/repo`, checked out at `place` from `cwd`, a checkout of its repository. */
export interface PullRequestCheckout extends PullRequest {
	cwd: string;
	place: CheckoutPlace;
	/** The skill the worktree session's first message goes through, the page's pinned one; `null` for none. */
	skill: string | null;
}

/** What `PUT /api/pull-request/checkout` did: the local branch now on the pull request, and the session started on it. */
export interface CheckedOutPullRequest {
	branch: string;
	/** The branch is at the pull request's latest commit; local commits keep it where it is. */
	onHead: boolean;
	/** The worktree session's `instanceId`; `null` for a checkout `here`, which starts none. */
	instanceId: string | null;
}
