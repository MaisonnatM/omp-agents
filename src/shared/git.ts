/** Git checkouts and branches a new session can work on. */
import type { Repo } from "./github";

/** A local branch, and the worktree that has it checked out, `null` when none has. */
export interface LocalBranch {
	name: string;
	worktree: string | null;
}

/** The git checkout a directory is in: what the new-session draft's branch picker lists and a session's header names. */
export interface GitCheckout {
	/** The GitHub repository that `origin` names, `null` when `origin` is not on GitHub. */
	github: Repo | null;
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
