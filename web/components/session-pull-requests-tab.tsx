import { GitPullRequest } from "lucide-react";
import { prKey, type LinkedPullRequest } from "../../src/shared/github";
import { useSessionPullRequestTabs } from "../pull-request-tabs";
import { PullRequestTabsStrip } from "./pull-requests/pr-tabs";
import type { RosterHost } from "../../src/shared/sessions";
import { DetailsEmpty } from "./details-sidebar-frame";
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
	/** The identity, stable across the session's live and past views, under which the browser keeps its open tabs. */
	scope: string;
}

/**
 * The session's pull requests in the right sidebar: one's details as the Pull requests page shows them, the first until another
 * is picked from its stack or from the session's other pull requests in the header's stack menu.
 */
export function SessionPullRequestsTab({ pullRequests, workspace, hosts, version, current, scope }: PullRequestsTabProps) {
	const { tabs, dispatch } = useSessionPullRequestTabs(scope, pullRequests[0]);
	const shown = tabs.open.find(pr => prKey(pr) === tabs.active);
	if (!shown) return <DetailsEmpty icon={GitPullRequest} title="No pull request yet" description="Pull requests this session opens or works on show here." />;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<PullRequestTabsStrip tabs={tabs} dispatch={dispatch} workspace={workspace} />
			<PullRequestDetails workspace={workspace} hosts={hosts} target={shown} placement="sidebar" version={version} tab={shown.detailTab} onTab={tab => dispatch({ type: "detail", pr: shown, tab })} onPick={pr => dispatch({ type: "open", pr })} session={pullRequests} current={current} />
		</div>
	);
}
