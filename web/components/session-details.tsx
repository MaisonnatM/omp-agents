/** The right sidebar for a session: its overview, its pull requests, its running app in the desktop app, and once it has any its Linear issues and its artifacts; a Bot's details share its Tickets tab. */
import { IconAiBotHead, IconBulletList, IconPlusLarge, IconPullRequest, IconSparklesTwo, IconWindowApp } from "central-icons";
import { useMemo } from "react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { LiveView, PastSession, RosterHost, View } from "../../src/shared/sessions";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { isPhonePage } from "../api";
import type { Artifact } from "../artifacts-model";
import { useArtifacts } from "../pane-store";
import { PAGE_ICON } from "../page-icons";
import { requestNewTerminal } from "../terminal-requests";
import { ArtifactsPanel } from "./artifacts-panel";
import { BROWSER_AVAILABLE, BrowserPanel } from "./browser-panel";
import { type DetailsTab, DetailsSidebarFrame } from "./details-sidebar-frame";
import type { ChangesSession } from "./overview-changes";
import { SessionOverview } from "./session-overview";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { SessionTicketsTab } from "./session-tickets-tab";
import { StatusDot } from "./status-dot";
import { agentLink, type SubagentLinksValue, useSubagentLinks } from "./subagent-links";

/** The right sidebar's open tabs, kept across views; the key keeps its old name, and a single tab name stored before tabs could close opens that tab. */
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
	/** The session whose artifacts these are, which their addresses name; `null` while unknown, as for a subagent, which leaves the **Artifacts** tab out. */
	sessionId: string | null;
	/** The artifacts the view's session saved, most recently saved first. */
	artifacts: Artifact[];
}

/** The **Tickets** tab once the session worked on any Linear issue; none before. */
export const ticketsTabs = (tickets: string[], working: boolean): DetailsTab<"tickets">[] =>
	tickets.length > 0
		? [{ value: "tickets", icon: PAGE_ICON.tickets, name: "Tickets", control: "session-details.tab.tickets", count: tickets.length, scrollsItself: true, content: <SessionTicketsTab tickets={tickets} version={working} /> }]
		: [];

/** The **PRs** tab, the **Tickets** tab once the session worked on any, the **Browser** tab for a live session in the desktop app, and the **Artifacts** tab once the session saved any. */
export function sessionWorkTabs({ scope, working, pullRequests, tickets, hosts, live, view, sessionId, artifacts }: SessionWork): DetailsTab<"pull-requests" | "browser" | "tickets" | "artifacts">[] {
	return [
		{
			value: "pull-requests",
			icon: IconPullRequest,
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
						icon: IconWindowApp,
						name: "Browser",
						control: "session-details.tab.browser",
						shortcut: "detailsBrowser",
						count: 0,
						scrollsItself: true,
						keepMounted: true,
						content: <BrowserPanel key={scope} view={live} sessionId={scope} />,
					} as const,
				]
			: []),
		...(sessionId !== null && artifacts.length > 0
			? [
					{
						value: "artifacts",
						icon: IconSparklesTwo,
						name: "Artifacts",
						control: "session-details.tab.artifacts",
						count: artifacts.length,
						scrollsItself: true,
						content: <ArtifactsPanel key={sessionId} view={view} sessionId={sessionId} artifacts={artifacts} />,
					} as const,
				]
			: []),
	];
}

/** The + menu's Subagents section: the live view's subagents, each a link to its own view; none while it has none. */
function SubagentsMenuGroup({ links }: { links: SubagentLinksValue }) {
	if (links.agents.length === 0) return null;
	return (
		<>
			<MenuSeparator />
			<MenuGroup>
				<MenuGroupLabel>Subagents</MenuGroupLabel>
				{links.agents.map(agent => {
					const { href, onClick } = agentLink(links, agent.id);
					return (
						<MenuLinkItem key={agent.id} {...activityControl("details.menu.subagent")} href={href} onClick={onClick} className="items-start">
							<span className="relative mt-0.5 flex shrink-0 items-center text-muted-foreground">
								<IconAiBotHead aria-hidden="true" />
								<StatusDot status={agent.status} />
							</span>
							<span className="flex min-w-0 max-w-72 flex-col">
								<span className="truncate">{agent.id}</span>
								{agent.activity && <span className="truncate text-xs text-muted-foreground">{agent.activity}</span>}
							</span>
						</MenuLinkItem>
					);
				})}
			</MenuGroup>
		</>
	);
}

/** The + menu's sections after the tabs, as Capy's: the live view's subagents, then **New terminal**, which a paired phone leaves out. */
function SessionMenuSections({ links }: { links: SubagentLinksValue | null }) {
	return (
		<>
			{links && <SubagentsMenuGroup links={links} />}
			{!isPhonePage() && (
				<>
					<MenuSeparator />
					<MenuGroup>
						<MenuGroupLabel>Terminals</MenuGroupLabel>
						<MenuItem {...activityControl("details.menu.new-terminal")} onClick={requestNewTerminal}>
							<IconPlusLarge aria-hidden="true" />
							New terminal
						</MenuItem>
					</MenuGroup>
				</>
			)}
		</>
	);
}

interface SessionDetailsProps extends Omit<SessionWork, "scope" | "live" | "artifacts" | "pullRequests" | "tickets"> {
	/** The session's directory, which relative file paths in pull requests and issues resolve against. */
	cwd: string | null;
	/** The live view's roster row, whose subagents the **Overview** tab lists; `null` for a past or ended one. */
	host: RosterHost | null;
	/** The view's roster row, an ended session's last one, or its past entry: the pull requests, Linear issues, arenas, and directory the tabs show. */
	row: RosterHost | PastSession | null;
}

/** The right sidebar's content for the focused view: its **Overview**, its session's pull requests, its running app, and its Linear issues and its artifacts when it has any. */
export function SessionDetails({ view, sessionId, working, cwd, hosts, host, row }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(each => each.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const artifacts = useArtifacts(view);
	const links = useSubagentLinks(view, host);
	const pullRequests = row?.pullRequests ?? [];
	const tickets = row?.tickets ?? [];
	// The row's directory, unlike `cwd`, outlives an ended live session, whose changed files still resolve against it.
	const session = useMemo<ChangesSession>(() => ({ sessionId, cwd: row?.cwd ?? null, facts: row }), [sessionId, row]);
	const tabs = [
		{
			value: "overview",
			icon: IconBulletList,
			name: "Overview",
			control: "session-details.tab.overview",
			shortcut: "detailsOverview",
			count: 0,
			content: <SessionOverview view={view} working={working} links={links} session={session} />,
		} as const,
		...sessionWorkTabs({ scope, working, pullRequests, tickets, hosts, live: view.kind === "live" ? view : null, view, sessionId, artifacts }),
	];
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab="overview" cwd={cwd} tabs={tabs} menuSections={<SessionMenuSections links={links} />} />;
}
