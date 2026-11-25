/** The right sidebar for a session: its overview, the subagent picked there, its pull requests, its running app in the desktop app, its artifacts once it has any, the screen changes to review once a reply lists any, and a Linear issue. */
import { IconAiBotHead, IconBranch, IconBulletList, IconEyeOpen, IconLinear, IconPlusSmall, IconPullRequest, IconSparklesTwo, IconWindowApp } from "central-icons";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { LinkedPullRequest } from "../../src/shared/github";
import type { LiveView, PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { Workspace } from "../../src/shared/workspaces";
import { MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { activityControl } from "../activity";
import { isPhonePage } from "../api";
import type { Artifact } from "../artifacts-model";
import { addDetailsTab, newIdsByScope, newIdsOnOpen, revealDetailsTab } from "../details-tabs";
import { type BeforeAfter, changeKey, latestBeforeAfter, sameChanges } from "../before-after";
import { itemsSelector, useArtifacts, useLinkedIssues, usePaneSelect, useShowConversation } from "../pane-store";
import type { ModelList } from "../reads";
import { requestNewTerminal } from "../terminal-requests";
import { ArtifactsPanel } from "./artifacts-panel";
import { BROWSER_AVAILABLE, BrowserPanel } from "./browser-panel";
import { ReviewPanel } from "./review-panel";
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

/** What a session worked on, runs, saved, and linked, which its **PRs**, **Browser**, **Artifacts**, **Review**, and **Linear** tabs show. */
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
	/** The screen changes the view's latest `before-after` list names, which the **Review** tab compares; empty leaves it out. */
	changes: BeforeAfter[];
}

/** The **PRs** tab, the **Browser** tab for a live session in the desktop app, the **Artifacts** tab once the session saved any, the **Review** tab once a reply listed screen changes, and the **Linear** tab. */
export function sessionWorkTabs({ scope, working, pullRequests, hosts, live, view, sessionId, artifacts, linearIssues, changes }: SessionWork): DetailsTab<"diffs" | "pull-requests" | "browser" | "artifacts" | "review" | "linear">[] {
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
		...(changes.length > 0
			? [
					{
						value: "review",
						icon: IconEyeOpen,
						name: "Review",
						control: "session-details.tab.review",
						count: changes.length,
						scrollsItself: true,
						content: <ReviewPanel scope={scope} changes={changes} live={live} />,
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

/** Whether session `scope` names an id not seen for it yet, remembering them. */
export type SeenIds = (scope: string, ids: readonly string[]) => boolean;

/**
 * Which pull requests, Linear issues, and screen changes each session showed while the page is open, for one sidebar
 * kept under `storageKey`, so a new one opens its tab there once, behind the tab on screen; a closed tab stays closed until another.
 */
export interface WorkTabOpeners {
	storageKey: string;
	/** Named anew each time a session is shown, so opening one with an issue opens the **Linear** tab. */
	linked: SeenIds;
	/** Kept as `linked` is, so opening one with a pull request opens the **PRs** tab. */
	submitted: SeenIds;
	/** By {@link changeKey}, so a closed **Review** tab stays closed until a new change. */
	listed: SeenIds;
}

export const workTabOpeners = (storageKey: string): WorkTabOpeners => ({ storageKey, linked: newIdsOnOpen(), submitted: newIdsOnOpen(), listed: newIdsByScope() });

const SESSION_OPENERS = workTabOpeners(TAB_KEY);

const pullRequestKey = ({ owner, repo, number }: LinkedPullRequest): string => `${owner}/${repo}#${number}`;

/** Adds tab `tab` to the sidebar kept under `storageKey` once the session `scope` names an id `seen` had not seen for it. */
export function useOpenTabOnNew(seen: SeenIds, storageKey: string, scope: string, ids: readonly string[], tab: string): void {
	useEffect(() => {
		if (seen(scope, ids)) addDetailsTab(storageKey, tab);
	}, [seen, storageKey, scope, ids, tab]);
}

const changesOf = itemsSelector((items): BeforeAfter[] => latestBeforeAfter(items));

/** What the session behind `view` worked on, saved, and linked, for {@link sessionWorkTabs}; a new pull request, issue, or change opens its tab through `openers`. */
export function useSessionWork({ view, sessionId, working, hosts, row }: Pick<SessionWork, "view" | "sessionId" | "working" | "hosts"> & { row: RosterHost | PastSession | null }, openers: WorkTabOpeners): SessionWork {
	const scope = view.kind === "past" ? view.sessionId : (hosts.find(each => each.instanceId === view.instanceId)?.sessionId ?? view.instanceId);
	const artifacts = useArtifacts(view);
	const promptIssues = useLinkedIssues(view);
	const shipIssue = row?.ship?.issue?.toUpperCase() ?? null;
	const savedIssues = row?.issues;
	// The issue a /ship run works on, those the session saved through Linear, then those the user's prompts link.
	const linearIssues = useMemo(() => [...new Set([...(shipIssue ? [shipIssue] : []), ...(savedIssues ?? []), ...promptIssues])], [shipIssue, savedIssues, promptIssues]);
	useOpenTabOnNew(openers.linked, openers.storageKey, scope, linearIssues, "linear");
	const changes = usePaneSelect(view, changesOf, sameChanges);
	const changeKeys = useMemo(() => changes.map(changeKey), [changes]);
	useOpenTabOnNew(openers.listed, openers.storageKey, scope, changeKeys, "review");
	const pullRequests = useMemo(() => row?.pullRequests ?? [], [row?.pullRequests]);
	const pullRequestKeys = useMemo(() => pullRequests.map(pullRequestKey), [pullRequests]);
	useOpenTabOnNew(openers.submitted, openers.storageKey, scope, pullRequestKeys, "pull-requests");
	return { scope, working, pullRequests, hosts, live: view.kind === "live" ? view : null, view, sessionId, artifacts, linearIssues, changes };
}

/** The right sidebar's content for the focused view: its **Overview**, the subagent picked there, its session's pull requests, its running app, its artifacts when it has any, the screen changes to review, and its Linear issue. */
export function SessionDetails({ view, sessionId, working, cwd, hosts, host, lastHost, row, models, workspaces }: SessionDetailsProps) {
	const work = useSessionWork({ view, sessionId, working, hosts, row }, SESSION_OPENERS);
	const [picked, setPicked] = useState<LiveView | null>(null);
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
	const session = useMemo<ChangesSession>(() => ({ sessionId, cwd: row?.cwd ?? null, facts: row }), [sessionId, row]);
	const tabs = [
		sessionOverviewTab(view, working, links, session),
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
		...sessionWorkTabs(work),
	];
	return <DetailsSidebarFrame label="Session details" storageKey={TAB_KEY} defaultTab="overview" cwd={cwd} tabs={tabs} menuSections={query => sessionMenuSections(links, query)} />;
}

/** The **Overview** tab: the session's to-dos, changes, and subagents, which `links` opens, or `null` to list them without links. */
export function sessionOverviewTab(view: View, working: boolean, links: SubagentLinksValue | null, session: ChangesSession): DetailsTab<"overview"> {
	return {
		value: "overview",
		icon: IconBulletList,
		name: "Overview",
		control: "session-details.tab.overview",
		shortcut: "detailsOverview",
		count: 0,
		content: <SessionOverview view={view} working={working} links={links} session={session} />,
	};
}
