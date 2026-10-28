/** The right sidebar for a session: its pull requests, its running app in the desktop app, and once it has any, its Linear issues; a Bot's details share them. */
import { AppWindow, GitPullRequest } from "lucide-react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { LiveView, RosterHost, View } from "../../src/shared/sessions";
import { PAGE_ICON } from "../page-icons";
import { type DetailsTab, DetailsSidebarFrame } from "./details-sidebar-frame";
import { PREVIEW_AVAILABLE, PreviewPanel } from "./preview-panel";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";

/** The right sidebar's tab, kept across views; the key keeps its old name, and a tab that no longer exists reads as PRs. */
const TAB_KEY = "omp-agents.plan-tab";

/** What a session worked on and runs, which its **PRs**, **Preview**, and **Tickets** tabs show. */
export interface SessionWork {
	/** The session the tabs show; a change starts the PRs and Preview tabs afresh. */
	scope: string;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first. */
	tickets: string[];
	/** The sidebar's workspace `cwd`, or `null` for every workspace. */
	workspace: string | null;
	hosts: RosterHost[];
	/** The live session or subagent the sidebar belongs to, whose composer the Preview's picks go to; `null` for a past one. */
	live: LiveView | null;
}

/** The **PRs** tab, the **Preview** tab for a live session in the desktop app, and the **Tickets** tab once the session worked on any. */
export function sessionWorkTabs({ scope, working, pullRequests, tickets, workspace, hosts, live }: SessionWork): DetailsTab<"pull-requests" | "preview" | "tickets">[] {
	return [
		{
			value: "pull-requests",
			icon: GitPullRequest,
			name: "PRs",
			control: "session-details.tab.pull-requests",
			count: pullRequests.length,
			scrollsItself: true,
			content: <SessionPullRequestsTab key={scope} pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} current={live?.instanceId ?? null} />,
		},
		...(PREVIEW_AVAILABLE && live !== null
			? [
					{
						value: "preview",
						icon: AppWindow,
						name: "Preview",
						control: "session-details.tab.preview",
						count: 0,
						scrollsItself: true,
						keepMounted: true,
						content: <PreviewPanel key={scope} view={live} sessionId={scope} />,
					} as const,
				]
			: []),
		...(tickets.length > 0
			? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", control: "session-details.tab.tickets", count: tickets.length, content: <SessionTicketsTab tickets={tickets} version={working} /> } as const]
			: []),
	];
}

interface SessionDetailsProps extends Omit<SessionWork, "scope" | "live"> {
	view: View;
	/** The session's directory, which relative file paths in pull requests and issues resolve against. */
	cwd: string | null;
}

/** The right sidebar's content for the focused view: its session's pull requests, its running app, and its Linear issues when it has any. */
export function SessionDetails({ view, working, cwd, pullRequests, tickets, workspace, hosts }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(host => host.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const tabs = sessionWorkTabs({ scope, working, pullRequests, tickets, workspace, hosts, live: view.kind === "live" ? view : null });
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab="pull-requests" cwd={cwd} tabs={tabs} />;
}
