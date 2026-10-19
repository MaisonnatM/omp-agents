export type WorktreeBlockerCode =
	| "main"
	| "locked"
	| "server"
	| "occupied"
	| "unknown-agent-location"
	| "unreadable"
	| "foreign"
	| "changed"
	| "nested-repository"
	| "drift"
	| "unregistered"
	| "unmerged";

export interface WorktreeBlocker {
	code: WorktreeBlockerCode;
	message: string;
}

export interface WorktreeTarget {
	repository: string;
	path: string;
}

/** The most worktrees one removal request previews or removes. */
export const MAX_WORKTREE_BATCH = 100;

/** Why a checkout's work counts as merged: its branch's newest pull request merged, or the default branch contains its commit. */
export type WorktreeMerge = { by: "pull-request"; number: number } | { by: "default-branch"; branch: string };

export interface WorktreeEntry extends WorktreeTarget {
	branch: string | null;
	head: string;
	main: boolean;
	bare: boolean;
	locked: string | null;
	prunable: string | null;
	missing: boolean;
	lastActivity: number | null;
	savedSessionIds: string[];
	blockers: WorktreeBlocker[];
	/** `null` for a main or bare checkout, and for one nothing shows merged. */
	merged: WorktreeMerge | null;
}

export interface WorktreeInventory {
	repositories: { repository: string; path: string; name: string; worktrees: WorktreeEntry[] }[];
	errors: { path: string; error: string }[];
}

export interface WorktreeMetrics extends WorktreeTarget {
	allocatedBytes: number | null;
	lastCommit: number | null;
	modified: number | null;
	untracked: number | null;
	errors: string[];
}

/** Every plan says what blocks removal; only a checkout the server could read carries what removal would do. */
export type WorktreeRemovalPlan = WorktreeTarget & { blockers: WorktreeBlocker[] } & (
	| { kind: "unreadable" }
	| {
		kind: "remove" | "registration";
		branch: string | null;
		head: string;
		ignored: string[];
		detachedCommitLoss: boolean;
		savedSessionIds: string[];
		confirmation: string;
	}
);

export interface WorktreeRemovalResult extends WorktreeTarget {
	removed: boolean;
	blockers: WorktreeBlocker[];
	error: string | null;
}

export interface WorktreeConfirmation extends WorktreeTarget {
	confirmation: string;
}

/** `merged` adds the `unmerged` blocker to every target whose work is not merged, for **Remove merged**. */
export type WorktreeRemovalRequest = { action: "preview"; targets: WorktreeTarget[]; merged: boolean } | { action: "remove"; plans: WorktreeConfirmation[] };
