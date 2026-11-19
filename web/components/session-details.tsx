/** The right sidebar for a session: its overview, the subagent picked there, its pull requests, its running app in the desktop app, its artifacts once it has any, and a Linear issue. */
import { IconAiBotHead, IconBranch, IconBulletList, IconLinear, IconPlusSmall, IconPullRequest, IconSparklesTwo, IconWindowApp } from "central-icons";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { LiveView, PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { isPhonePage } from "../api";
import type { Artifact } from "../artifacts-model";
import { addDetailsTab, newIdsByScope, revealDetailsTab } from "../details-tabs";
import { useArtifacts, useLinkedIssues, useShowConversation } from "../pane-store";
import type { ModelList } from "../reads";
import { requestNewTerminal } from "../terminal-requests";
import { ArtifactsPanel } from "./artifacts-panel";
import { BROWSER_AVAILABLE, BrowserPanel } from "./browser-panel";
import { type DetailsTab, DetailsSidebarFrame, menuMatches } from "./details-sidebar-frame";
import type { ChangesSession } from "./overview-changes";
import { ViewConversation } from "./pane";
import { SessionOverview } from "./session-overview";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { StatusDot } from "./status-dot";
import { agentLink, type SubagentLinksValue, useSubagentLinks } from "./subagent-links";
import { SessionDiffsTab } from "./session-diffs-tab";
import { SessionLinearTab } from "./session-linear-tab";

/** The right sidebar's open tabs, kept across views; the key keeps its old name, and a single tab name stored before tabs could close opens that tab. */
export const TAB_KEY = "omp-agents.plan-tab";

/** What a session worked on, runs, saved, and linked, which its **PRs**, **Browser**, **Artifacts**, and **Linear** tabs show. */
export interface SessionWork {
	/** The session the tabs show; a change starts the PRs and Browser tabs afresh. */
	scope: string;
	/** Marks the last turn as still running; a change also reads the shown pull request again. */
	working: boolean;
	/** What the view's session and its subagents submitted or worked on, the session's own first. */
	pullRequests: LinkedPullRequest[];
	hosts: RosterHost[];
	/** The live session or subagent the sidebar belongs to, whose composer the Browser's picks go to; `null` for a past one. */
	live: LiveView | null;
	/** The view the sidebar belongs to, whose transcript's cards the **Artifacts** tab answers. */
	view: View;
	/** The session whose artifacts these are, which their addresses name; `null` while unknown, as for a subagent, which leaves the **Artifacts** tab out. */
	sessionId: string | null;
	/** The artifacts the view's session saved, most recently saved first. */
	artifacts: Artifact[];
	/** The ids of the Linear issues the view's prompts and replies link to, in the order they first appear. */
	linearIssues: string[];
}

/** The **PRs** tab, the **Browser** tab for a live session in the desktop app, the **Artifacts** tab once the session saved any, and the **Linear** tab. */
export function sessionWorkTabs({ scope, working, pullRequests, hosts, live, view, sessionId, artifacts, linearIssues }: SessionWork): DetailsTab<"diffs" | "pull-requests" | "browser" | "artifacts" | "linear">[] {
	return [
		...(sessionId !== null
			? [
					{
						value: "diffs",
						icon: IconBranch,
						name: "Diffs",
						control: "session-details.tab.diffs",
						count: 0,
						scrollsItself: true,
						content: <SessionDiffsTab key={sessionId} sessionId={sessionId} working={working} />,
					} as const,
				]
			: []),
		{
			value: "pull-requests",
			icon: IconPullRequest,
			name: "PRs",
			control: "session-details.tab.pull-requests",
			count: pullRequests.length,
			scrollsItself: true,
			content: <SessionPullRequestsTab key={scope} pullRequests={pullRequests} hosts={hosts} version={working} current={live?.instanceId ?? null} />,
		},
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
		{
			value: "linear",
			icon: IconLinear,
			name: "Linear",
			control: "session-details.tab.linear",
			count: linearIssues.length,
			scrollsItself: true,
			// Kept while another tab shows, so the issue typed into it stays on screen.
			keepMounted: true,
			content: <SessionLinearTab key={scope} linked={linearIssues} />,
		},
	];
}

/** The + menu's Subagents section: the live view's subagents whose name or activity holds `query`, each a link to its own view; none while none match. */
function subagentsMenuGroup(links: SubagentLinksValue, query: string): ReactNode {
	const agents = links.agents.filter(agent => menuMatches(query, agent.id, agent.activity));
	if (agents.length === 0) return null;
	return (
		<>
			<MenuSeparator />
			<MenuGroup>
				<MenuGroupLabel>Subagents</MenuGroupLabel>
				{agents.map(agent => {
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

/** The + menu's sections after the tabs that match `query`, as Capy's: the live view's subagents, then **New terminal**, which a paired phone leaves out; `null` when none match. */
function sessionMenuSections(links: SubagentLinksValue | null, query: string): ReactNode {
	const subagents = links && subagentsMenuGroup(links, query);
	const terminal = !isPhonePage() && menuMatches(query, "New terminal", "Terminals");
	if (!subagents && !terminal) return null;
	return (
		<>
			{subagents}
			{terminal && (
				<>
					<MenuSeparator />
					<MenuGroup>
						<MenuGroupLabel>Terminals</MenuGroupLabel>
						<MenuItem {...activityControl("details.menu.new-terminal")} onClick={requestNewTerminal}>
							<IconPlusSmall aria-hidden="true" />
							New terminal
						</MenuItem>
					</MenuGroup>
				</>
			)}
		</>
	);
}

interface SubagentConversationProps {
	view: LiveView;
	host: RosterHost | null;
	lastHost: RosterHost | null;
	models: ModelList;
	workspaces: Workspace[];
}

/** The **Subagent** tab: the picked subagent's conversation and composer, streamed while the tab is open, beside the session's own in the pane. */
function SubagentConversation({ view, host, lastHost, models, workspaces }: SubagentConversationProps) {
	useShowConversation(view);
	return <ViewConversation view={view} focused={false} host={host} lastHost={lastHost} session={null} models={models} workspaces={workspaces} header={false} />;
}

interface SessionDetailsProps extends Pick<SessionWork, "view" | "sessionId" | "working" | "hosts"> {
	/** The session's directory, which relative file paths in pull requests resolve against. */
	cwd: string | null;
	/** The live view's roster row, whose subagents the **Overview** tab lists; `null` for a past or ended one. */
	host: RosterHost | null;
	/** The live view's last roster row, which the **Subagent** tab's conversation reads once the session ended. */
	lastHost: RosterHost | null;
	/** The view's roster row, an ended session's last one, or its past entry: the pull requests, arenas, and directory the tabs show. */
	row: RosterHost | PastSession | null;
	/** The session's model list, which the **Subagent** tab's composer offers. */
	models: ModelList;
	/** The workspaces, which the **Subagent** tab's composer offers. */
	workspaces: Workspace[];
}

const SUBAGENT_TAB = "subagent";

/** The Linear issues each session linked while the page is open, kept across its views, which mount the sidebar afresh, and its transcript's reloads. */
const linkedBefore = newIdsByScope();

/**
 * Adds the **Linear** tab behind the tab on screen once the session `scope` links an issue it had not linked before, as when
 * its conversation first loads or a reply links a new one; a closed tab stays closed until the session links another.
 */
function useOpenLinearOnLink(scope: string, linked: readonly string[]): void {
	useEffect(() => {
		if (linkedBefore(scope, linked)) addDetailsTab(TAB_KEY, "linear");
	}, [scope, linked]);
}

/** The right sidebar's content for the focused view: its **Overview**, the subagent picked there, its session's pull requests, its running app, its artifacts when it has any, and its Linear issue. */
export function SessionDetails({ view, sessionId, working, cwd, hosts, host, lastHost, row, models, workspaces }: SessionDetailsProps) {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(each => each.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const artifacts = useArtifacts(view);
	const [picked, setPicked] = useState<LiveView | null>(null);
	const linearIssues = useLinkedIssues(view);
	useOpenLinearOnLink(scope, linearIssues);
	const opened = useSubagentLinks(view, host);
	// A plain click on a subagent shows it in the **Subagent** tab; a split or a new window still opens it as a pane.
	const links = useMemo<SubagentLinksValue | null>(
		() =>
			opened && {
				...opened,
				onOpen: (target, mode) => {
					if (mode !== "replace" || target.kind !== "live" || target.agentId === null) return opened.onOpen(target, mode);
					setPicked(target);
					revealDetailsTab(TAB_KEY, SUBAGENT_TAB, "overview");
				},
			},
		[opened],
	);
	const pullRequests = row?.pullRequests ?? [];
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
		...(picked
			? [
					{
						value: SUBAGENT_TAB,
						icon: IconAiBotHead,
						name: picked.agentId ?? "Subagent",
						control: "session-details.tab.subagent",
						count: 0,
						scrollsItself: true,
						content: <SubagentConversation key={picked.agentId} view={picked} host={host} lastHost={lastHost} models={models} workspaces={workspaces} />,
					} as const,
				]
			: []),
		...sessionWorkTabs({ scope, working, pullRequests, hosts, live: view.kind === "live" ? view : null, view, sessionId, artifacts, linearIssues }),
	];
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab="overview" cwd={cwd} tabs={tabs} menuSections={query => sessionMenuSections(links, query)} />;
}
