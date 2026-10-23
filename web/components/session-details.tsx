/** The right sidebar for a session: its pull requests and, once it has any, Linear issues. */
import { GitPullRequest } from "lucide-react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { RosterHost, View } from "../../src/shared/sessions";
import { PAGE_ICON } from "../page-icons";
import { DetailsSidebarFrame } from "./details-sidebar-frame";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";

/** The right sidebar's tab, kept across views; the key keeps its old name, and a tab that no longer exists reads as PRs. */
const TAB_KEY = "omp-agents.plan-tab";

interface SessionDetailsProps {
	view: View;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** The session's directory, which relative file paths in pull requests and issues resolve against. */
	cwd: string | null;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first. */
	tickets: string[];
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
}

/** The right sidebar's content for the focused view: its session's pull requests, and its Linear issues when it has any. */
export function SessionDetails({ view, working, cwd, pullRequests, tickets, workspace, hosts }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(host => host.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	return (
		<DetailsSidebarFrame
			label="Session details"
			storageKey={TAB_KEY}
			defaultTab="pull-requests"
			cwd={cwd}
			tabs={[
				{
					value: "pull-requests",
					icon: GitPullRequest,
					name: "PRs",
					count: pullRequests.length,
					scrollsItself: true,
					content: <SessionPullRequestsTab key={scope} pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} current={view.kind === "live" ? view.instanceId : null} />,
				},
				...(tickets.length > 0
					? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", count: tickets.length, content: <SessionTicketsTab tickets={tickets} version={working} /> } as const]
					: []),
			]}
		/>
	);
}
