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
	| "unregistered";

export interface WorktreeBlocker {
	code: WorktreeBlockerCode;
	message: string;
}

export interface WorktreeTarget {
	repository: string;
	path: string;
}

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

export interface WorktreeRemovalPlan extends WorktreeTarget {
	kind: "remove" | "registration";
	branch: string | null;
	head: string;
	ignored: string[];
	detachedCommitLoss: boolean;
	savedSessionIds: string[];
	blockers: WorktreeBlocker[];
	confirmation: string;
}

export interface WorktreeRemovalResult extends WorktreeTarget {
	removed: boolean;
	blockers: WorktreeBlocker[];
	error: string | null;
}

export interface WorktreeConfirmation extends WorktreeTarget {
	confirmation: string;
}

export type WorktreeRemovalRequest = { action: "preview"; targets: WorktreeTarget[] } | { action: "remove"; plans: WorktreeConfirmation[] };
