/** The right sidebar for a session: its agent's todo list once it has one, its pull requests and, once it has any, its Linear issues; a Bot's details share the last two. */
import { GitPullRequest, ListChecks } from "lucide-react";
import { useMemo } from "react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { RosterHost, View } from "../../src/shared/sessions";
import { PAGE_ICON } from "../page-icons";
import { useTranscript } from "../pane-store";
import { latestTodos } from "../transcript-view";
import { type DetailsTab, DetailsSidebarFrame } from "./details-sidebar-frame";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";
import { openTodos, SessionTodosTab } from "./session-todos-tab";

/** The right sidebar's tab, kept across views; the key keeps its old name, and a tab that no longer exists reads as PRs. */
const TAB_KEY = "omp-agents.plan-tab";

/** What a session worked on, which its **PRs** and **Tickets** tabs show. */
export interface SessionWork {
	/** The session the tabs show; a change starts the PRs tab afresh. */
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
	/** The `instanceId` of the live session the sidebar belongs to, `null` for a past one. */
	current: string | null;
}

/** The **PRs** tab, and the **Tickets** tab once the session worked on any. */
export function sessionWorkTabs({ scope, working, pullRequests, tickets, workspace, hosts, current }: SessionWork): DetailsTab<"pull-requests" | "tickets">[] {
	return [
		{
			value: "pull-requests",
			icon: GitPullRequest,
			name: "PRs",
			control: "session-details.tab.pull-requests",
			count: pullRequests.length,
			scrollsItself: true,
			content: <SessionPullRequestsTab key={scope} pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} current={current} />,
		},
		...(tickets.length > 0
			? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", control: "session-details.tab.tickets", count: tickets.length, content: <SessionTicketsTab tickets={tickets} version={working} /> } as const]
			: []),
	];
}

interface SessionDetailsProps extends Omit<SessionWork, "scope" | "current"> {
	view: View;
	/** The session's directory, which relative file paths in pull requests and issues resolve against. */
	cwd: string | null;
}

/** The right sidebar's content for the focused view: its agent's todo list when it has one, its session's pull requests, and its Linear issues when it has any. */
export function SessionDetails({ view, working, cwd, pullRequests, tickets, workspace, hosts }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(host => host.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const items = useTranscript(view);
	const todos = useMemo(() => latestTodos(items), [items]);
	const workTabs = sessionWorkTabs({ scope, working, pullRequests, tickets, workspace, hosts, current: view.kind === "live" ? view.instanceId : null });
	const tabs: DetailsTab<"todos" | "pull-requests" | "tickets">[] =
		todos.length > 0
			? [{ value: "todos", icon: ListChecks, name: "Todos", control: "session-details.tab.todos", count: openTodos(todos), content: <SessionTodosTab phases={todos} /> }, ...workTabs]
			: workTabs;
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab={todos.length > 0 ? "todos" : "pull-requests"} cwd={cwd} tabs={tabs} />;
}
