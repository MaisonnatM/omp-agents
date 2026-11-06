import type { PullRequestActionId } from "../../../../src/pull-request-actions";
import type { LinkedPullRequest, PullRequest, PullRequestSummary } from "../../../../src/shared/github";
import type { RosterHost, View } from "../../../../src/shared/sessions";
import type { OpenMode } from "../../../routing";
import type { QuickActionsProps } from "../../quick-actions";

export type Placement = "page" | "sidebar";
export type PullRequestDetailTab = "summary" | "timeline" | "code" | "review";

export interface DetailContentProps {
	pr: PullRequest;
	/** Its pull request list entry, for who you are to it; `null` when the list does not hold it, so no move or quick action applies, since a start needs the workspace the list names. */
	listed: PullRequestSummary | null;
	/** The quick action whose session is starting for it, if any. */
	pending: QuickActionsProps["pending"];
	/** Starts `action` on the pull request, as `facts` describe it. */
	onRun: (facts: PullRequestSummary, action: PullRequestActionId) => void;
	/** The running sessions that work on it. */
	sessions: RosterHost[];
	onOpen: (view: View, mode: OpenMode) => void;
	/** The session's pull requests, in the session details sidebar; those outside the stack list under it. */
	session?: LinkedPullRequest[];
	/** Where the details show: the main area's page, whose heading takes focus, or the session details sidebar, under its own heading. */
	placement: Placement;
	/** A change reads the pull request from GitHub again. */
	version?: unknown;
	/** The tab it shows; its host keeps it, and on the page the route decides whether it is Code. */
	tab: PullRequestDetailTab;
	onTab: (tab: PullRequestDetailTab) => void;
	/** The changed file the route opens in the Code tab. */
	path?: string | null;
	/** Shows another pull request of its stack or of the session in place; without it, each of its stack links to its page. */
	onPick?: (pr: PullRequest) => void;
	/** The workspace whose pull request list a change here shows in at once. */
	workspace: string | null;
	/** A checkout of its repository, where copying its branch removes the linked worktree that has it checked out; `null` when none is known. */
	cwd: string | null;
}
