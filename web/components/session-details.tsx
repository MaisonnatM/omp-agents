/** The right sidebar for a session: its pull requests, its running app in the desktop app, once it has any its Linear issues and its artifacts, and a personal session's memory; a Bot's details share its Tickets tab. */
import { AppWindow, Brain, GitPullRequest, Sparkles } from "lucide-react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { LiveView, RosterHost, View } from "../../src/shared/sessions";
import { type Artifact, artifactsOf, sameArtifacts } from "../artifacts-model";
import { type PaneData, usePaneSelect } from "../pane-store";
import { PAGE_ICON } from "../page-icons";
import { type DetailsTab, DetailsSidebarFrame } from "./details-sidebar-frame";
import { isPhonePage } from "../api";
import { ArtifactsPanel } from "./artifacts-panel";
import { BROWSER_AVAILABLE, BrowserPanel } from "./browser-panel";
import { MemoryList } from "./memory-list";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";

/** The right sidebar's tab, kept across views; the key keeps its old name, and a tab that no longer exists reads as PRs. */
export const TAB_KEY = "omp-agents.plan-tab";

/** What a session worked on, runs, and saved, which its **PRs**, **Browser**, **Tickets**, and **Artifacts** tabs show. */
export interface SessionWork {
	/** The session the tabs show; a change starts the PRs and Browser tabs afresh. */
	scope: string;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	/** The Linear issues the session and its subagents worked on, by identifier, the session's own first. */
	tickets: string[];
	hosts: RosterHost[];
	/** The live session or subagent the sidebar belongs to, whose composer the Browser's picks go to; `null` for a past one. */
	live: LiveView | null;
	/** The view the sidebar belongs to, whose transcript's cards the **Artifacts** tab answers. */
	view: View;
	/** The artifacts the view's session saved, most recently saved first. */
	artifacts: Artifact[];
	/** Whether the right sidebar is open. */
	open: boolean;
}

/** The **Tickets** tab once the session worked on any Linear issue; none before. */
export const ticketsTabs = (tickets: string[], working: boolean): DetailsTab<"tickets">[] =>
	tickets.length > 0
		? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", control: "session-details.tab.tickets", count: tickets.length, scrollsItself: true, content: <SessionTicketsTab tickets={tickets} version={working} /> }]
		: [];

/** The **PRs** tab, the **Tickets** tab once the session worked on any, the **Browser** tab for a live session in the desktop app, and the **Artifacts** tab once the session saved any. */
export function sessionWorkTabs({ scope, working, pullRequests, tickets, hosts, live, view, artifacts, open }: SessionWork): DetailsTab<"pull-requests" | "browser" | "tickets" | "artifacts">[] {
	return [
		{
			value: "pull-requests",
			icon: GitPullRequest,
			name: "PRs",
			control: "session-details.tab.pull-requests",
			count: pullRequests.length,
			scrollsItself: true,
			content: <SessionPullRequestsTab key={scope} pullRequests={pullRequests} hosts={hosts} version={working} current={live?.instanceId ?? null} />,
		},
		...ticketsTabs(tickets, working),
		...(BROWSER_AVAILABLE && live !== null && !isPhonePage()
			? [
					{
						value: "browser",
						icon: AppWindow,
						name: "Browser",
						control: "session-details.tab.browser",
						count: 0,
						scrollsItself: true,
						keepMounted: true,
						content: <BrowserPanel key={scope} view={live} sessionId={scope} />,
					} as const,
				]
			: []),
		...(artifacts.length > 0
			? [
					{
						value: "artifacts",
						icon: Sparkles,
						name: "Artifacts",
						control: "session-details.tab.artifacts",
						count: artifacts.length,
						scrollsItself: true,
						content: <ArtifactsPanel key={scope} view={view} sessionId={scope} artifacts={artifacts} open={open} />,
					} as const,
				]
			: []),
	];
}

/** Module-level, so the store keeps one selector and runs it only when the pane changes. */
const paneArtifacts = (pane: PaneData): Artifact[] => artifactsOf(pane.items);

interface SessionDetailsProps extends Omit<SessionWork, "scope" | "live" | "artifacts"> {
	/** The session's directory, which relative file paths in pull requests and issues resolve against. */
	cwd: string | null;
	/** What personal sessions remember, for a personal session; `null` for any other. */
	personalMemory: string | null;
}

/** The right sidebar's content for the focused view: its session's pull requests, its running app, its Linear issues and its artifacts when it has any, and a personal session's **Memory**. */
export function SessionDetails({ view, working, cwd, personalMemory, pullRequests, tickets, hosts, open }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(host => host.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const artifacts = usePaneSelect(view, paneArtifacts, sameArtifacts);
	const tabs = [
		...sessionWorkTabs({ scope, working, pullRequests, tickets, hosts, live: view.kind === "live" ? view : null, view, artifacts, open }),
		...(personalMemory !== null
			? [
					{
						value: "memory",
						icon: Brain,
						name: "Memory",
						control: "session-details.tab.memory",
						count: 0,
						content: (
							<div className="px-4 pt-2 pb-4">
								<MemoryList path="personal-memory.md" memory={personalMemory} empty="Nothing yet. Tell it something worth keeping, and it remembers it." />
							</div>
						),
					} as const,
				]
			: []),
	];
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab="pull-requests" cwd={cwd} tabs={tabs} />;
}
