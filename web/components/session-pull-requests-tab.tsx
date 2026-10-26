import { GitPullRequest } from "lucide-react";
import { useState } from "react";
import type { LinkedPullRequest, PullRequest } from "../../src/shared/github";
import type { RosterHost } from "../../src/shared/sessions";
import { DetailsEmpty } from "./details-sidebar-frame";
import type { PullRequestDetailTab } from "./pull-requests/pr-details";
import { PullRequestDetails } from "./pull-requests/pr-page";

interface PullRequestsTabProps {
	/** What the session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The sidebar's workspace `cwd`, or `null` for every workspace, whose pull request list offers the quick actions. */
	workspace: string | null;
	hosts: RosterHost[];
	/** A change reads the shown pull request from GitHub again. */
	version?: unknown;
	/** The `instanceId` of the live session the sidebar belongs to, `null` for a past one. */
	current: string | null;
}

/**
 * The session's pull requests in the right sidebar: one's details as the Pull requests page shows them, the first until another
 * is picked from its stack or from the session's other pull requests in the header's stack menu. Callers key it by session, so a
 * pick lasts only while the sidebar shows that session.
 */
export function SessionPullRequestsTab({ pullRequests, workspace, hosts, version, current }: PullRequestsTabProps) {
	const [picked, setPicked] = useState<PullRequest | null>(null);
	const [tab, setTab] = useState<PullRequestDetailTab>("summary");
	const shown = picked ?? pullRequests[0];
	if (!shown) return <DetailsEmpty icon={GitPullRequest} title="No pull request yet" description="Pull requests this session opens or works on show here." />;
	const pick = (pr: PullRequest): void => {
		setPicked(pr);
		setTab("summary");
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PullRequestDetails workspace={workspace} hosts={hosts} target={shown} placement="sidebar" version={version} tab={tab} onTab={setTab} onPick={pick} session={pullRequests} current={current} />
		</div>
	);
}
