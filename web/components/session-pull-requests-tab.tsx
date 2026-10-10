import { useState } from "react";
import type { LinkedPullRequest, PullRequest } from "../../src/shared/github";
import type { RosterHost } from "../../src/shared/sessions";
import { PullRequestDetails } from "./pull-requests/pr-page";

interface PullRequestsTabProps {
	/** What the session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The sidebar's workspace `cwd`, or `null` for every workspace, whose pull request list offers the quick actions. */
	workspace: string | null;
	hosts: RosterHost[];
	/** A change reads the shown pull request from GitHub again. */
	version?: unknown;
}

/**
 * The session's pull requests in the right sidebar: one's details as the Pull requests page shows them, the first until another
 * is picked from its stack or from the session's other pull requests, which its Summary lists.
 */
export function SessionPullRequestsTab({ pullRequests, workspace, hosts, version }: PullRequestsTabProps) {
	const [picked, setPicked] = useState<PullRequest | null>(null);
	const shown = picked ?? pullRequests[0];
	if (!shown) return <p className="px-4 py-2 text-sm text-muted-foreground">No pull request yet.</p>;
	return (
		<div className="space-y-3 px-4 pt-2 pb-4">
			<PullRequestDetails workspace={workspace} hosts={hosts} target={shown} placement="sidebar" version={version} onPick={setPicked} session={pullRequests} />
		</div>
	);
}
