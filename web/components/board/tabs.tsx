/** The tabs across a Workspace's Board, as across a Slack channel, and every tab but Messages: another page's content kept to the Workspace. */
import * as TabsPrimitive from "@ui-sdk/react/tabs";
import { type ReactNode, useContext, useMemo, useRef } from "react";
import type { View } from "../../../src/shared/sessions";
import type { BoardState } from "../../../templates/omp/agent/extensions/board/log";
import { activityControl } from "../../activity";
import type { WebModuleId } from "../../modules";
import { PageHashContext } from "../../page-hash";
import { pullRequestsScope, pullRequestsStore, UNREAD } from "../../reads";
import { COLUMN_MIN, listPlacement, listSplits } from "../../page-list";
import { hashForPage, type PullRequestsRoute, workspaceSection } from "../../routing";
import { latestSession, type ProjectGroup, workspaceCwd } from "../../sessions";
import { type DashboardActions, DashboardActionsContext, DashboardStatusContext, SessionsTabContext, useDashboardActions, useDashboardStatus } from "../dashboard-context";
import { ViewConversation } from "../pane";
import { HeaderTitleShown } from "../page-header";
import { useShowConversation } from "../../pane-store";
import { Roster } from "../roster";
import type { CoreData } from "../module-views";
import { ProjectMemoryTab } from "../memory/project-memory";
import { RoutinesTab } from "../routines/routines-tab";
import { ProjectsPage } from "../projects/page";
import { ProjectsNav } from "../projects/projects-nav";
import { PullRequestsPage } from "../pull-requests/pull-requests-page";
import { PageListColumn, pageListLabel, useWidth } from "../page-list";
import { SettingsNav } from "../settings/settings-nav";
import { SettingsPage } from "../settings/settings-page";
import { BOARD_TABS, type BoardTab, type BoardTabDef, type BoardView, tabView } from "./module";
import { boardPageHash } from "./sidebar";

const TAB = "inline-flex h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-selected:border-foreground aria-selected:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** The tabs whose module is on; a tab showing a module's page goes while that module is off. */
export const boardTabsOn = (off: ReadonlySet<WebModuleId>): BoardTabDef[] => BOARD_TABS.filter(each => each.module === null || !off.has(each.module));

/** The row of tabs under the Workspace's name, underlined on the header's rule as under a Slack channel's; it scrolls sideways in a narrow column. The rule is an inset shadow the selected tab's underline covers, not a border a tab overlaps with a negative margin: that 1px overflow let a click scroll the row down a pixel, so the rule flickered. */
export function ChannelTabs({ tab, tabs, workspace }: { tab: BoardTab; tabs: readonly BoardTabDef[]; workspace: string | null }) {
	return (
		<TabsPrimitive.Tabs
			value={tab}
			onValueChange={next => {
				const picked = tabs.find(each => each.id === next);
				if (picked) location.hash = hashForPage({ kind: "board", workspace, view: tabView(picked.id), search: null, reply: null, session: null });
			}}
			activation="manual"
		>
			<TabsPrimitive.TabsList aria-label="Board tabs" className="flex gap-4 overflow-x-auto px-6 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] max-phone:px-3">
				{tabs.map(({ id, label, icon: Icon }) => (
					<TabsPrimitive.TabsTab key={id} value={id} className={TAB} {...activityControl("board.tab")}>
						<Icon aria-hidden className="size-4 shrink-0" />
						{label}
					</TabsPrimitive.TabsTab>
				))}
			</TabsPrimitive.TabsList>
		</TabsPrimitive.Tabs>
	);
}

/** The sessions and projects of Workspace `cwd`; a session belongs by its Workspace, a project by the Workspace it was made in, or, made on the Projects page, by a session of it that ran here. */
function workspaceSlice(core: CoreData, cwd: string | null) {
	const here = <Row extends { cwd: string; workspace: Parameters<typeof workspaceCwd>[0]["workspace"] }>(rows: Row[]): Row[] => rows.filter(row => workspaceCwd(row) === cwd);
	const hosts = here(core.sessions.hosts);
	const past = here(core.sessions.past);
	const ran = new Set([...hosts, ...past].map(row => row.sessionId));
	const projects = core.projects && { projects: core.projects.projects.filter(project => (project.workspace === undefined ? project.sessionIds.some(id => ran.has(id)) : project.workspace === cwd)) };
	return { hosts, past, projects };
}

/** A tab other than Messages: the page it names, kept to the Workspace; a project or pull request it opens shows in the tab. */
export function WorkspaceTab({ view, workspace, board, core, disabled }: { view: Exclude<BoardView, { tab: "messages" }>; workspace: string | null; board: BoardState; core: CoreData; disabled: boolean }) {
	const to = useMemo(() => boardPageHash(workspace), [workspace]);
	return (
		<PageHashContext.Provider value={to}>
			<TabPage view={view} workspace={workspace} board={board} core={core} disabled={disabled} />
		</PageHashContext.Provider>
	);
}

function TabPage({ view, workspace, board, core, disabled }: { view: Exclude<BoardView, { tab: "messages" }>; workspace: string | null; board: BoardState; core: CoreData; disabled: boolean }) {
	const { changeModule } = useDashboardActions();
	const slice = workspaceSlice(core, workspace);
	switch (view.tab) {
		case "sessions":
			return <WorkspaceSessions board={board} core={core} workspace={workspace} session={view.session} />;
		case "routines":
			return <RoutinesTab workspace={workspace ?? core.defaultWorkspace} route={view.routine} routines={core.routines} held={core.held.routines ?? null} workspaces={core.workspaces} connected={core.connected} />;
		case "pull-requests":
			return <WorkspacePullRequests workspace={workspace} hosts={slice.hosts} past={slice.past} route={view.page} />;
		case "memory":
			return <ProjectMemoryTab repo={workspace} pinned />;
		case "projects":
			return (
				<ListedTab label={pageListLabel(view.page)} split={listSplits(view.page)} list={<ProjectsNav state={slice.projects} openId={view.page.open} disabled={disabled} workspace={workspace ?? undefined} />}>
					<ProjectsPage
						route={view.page}
						core={core}
						state={slice.projects}
						empty="No projects in this Workspace yet"
						workspace={workspace ?? undefined}
						disabled={disabled}
						onChange={change => changeModule("projects", change)}
					/>
				</ListedTab>
			);
		case "settings":
			return <WorkspaceSettings workspace={workspace} workspaces={core.workspaces} section={view.section} />;
	}
}

/** The Pull requests page read for Workspace `workspace` rather than the sidebar's scope: it polls that Workspace's pull requests while it shows, and its rows, details, and changes read that entry. */
function WorkspacePullRequests({ workspace, hosts, past, route }: { workspace: string | null; hosts: CoreData["sessions"]["hosts"]; past: CoreData["sessions"]["past"]; route: PullRequestsRoute }) {
	const status = useDashboardStatus();
	const scope = pullRequestsScope(workspace);
	pullRequestsStore.usePolling(scope);
	const scoped = useMemo(() => ({ ...status, pullRequestsScope: scope, scope: { workspace } }), [status, scope, workspace]);
	return (
		<DashboardStatusContext.Provider value={scoped}>
			<PullRequestsPage hosts={hosts} past={past} route={route} />
		</DashboardStatusContext.Provider>
	);
}

const settingsHash = (workspace: string | null, section: string) => hashForPage({ kind: "board", workspace, view: { tab: "settings", section }, search: null, reply: null, session: null });

/** Settings kept to the Workspace, with no workspace picker: its sections down the left, the one the address names at the right. */
function WorkspaceSettings({ workspace, workspaces, section: named }: { workspace: string | null; workspaces: CoreData["workspaces"]; section: string | null }) {
	const section = workspaceSection(named);
	const page = { kind: "settings", section } as const;
	return (
		<ListedTab label={pageListLabel(page)} split={listSplits(page)} list={<SettingsNav route={{ section }} group="workspace" hash={value => settingsHash(workspace, value)} />}>
			<SettingsPage key={workspace ?? ""} section={section} cwd={workspace} workspaces={workspaces} scope={{ kind: "workspace", sectionHash: value => settingsHash(workspace, value) }} />
		</ListedTab>
	);
}

/** A tab's page beside its list, in the resizable column the Projects and Settings pages keep at their left; the column, named `label`, takes what leaves the page its floor, the wider floor of a page that `split`s its list from its open item. */
function ListedTab({ label, split, list, children }: { label: string; split: boolean; list: ReactNode; children: ReactNode }) {
	const area = useRef<HTMLDivElement>(null);
	const placement = listPlacement(split, false, useWidth(area));
	return (
		<div ref={area} className="flex min-h-0 min-w-0 flex-1">
			<PageListColumn label={label} max={placement.at === "column" ? placement.max : COLUMN_MIN}>
				{list}
			</PageListColumn>
			<div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
		</div>
	);
}

/** The Sessions tab lists no projects: the Projects tab beside it shows them, and their sessions stay in their own lists. */
const NO_PROJECTS: ProjectGroup[] = [];

const sessionsHash = (workspace: string | null, session: string) => hashForPage({ kind: "board", workspace, view: { tab: "sessions", session }, search: null, reply: null, session: null });

/**
 * The Workspace's **Sessions** tab, as a mail app's split: its live, interrupted, waiting, and past sessions with search and Resume all in the column at the left,
 * and at the right the conversation of session `session`, else the latest one listed. A row opens its session here rather than in the panes. The App keeps the
 * selected Workspace on the open one, so the lists are this Workspace's.
 */
function WorkspaceSessions({ board, core, workspace, session }: { board: BoardState; core: CoreData; workspace: string | null; session: string | null }) {
	const tab = useContext(SessionsTabContext);
	const actions = useDashboardActions();
	const { hosts, past: saved } = core.sessions;
	const latest = useRef(hosts);
	latest.current = hosts;
	// A row's click names its session in the address, by session id, which outlives the host running it, so a resumed session stays open.
	const rowActions = useMemo<DashboardActions>(
		() => ({
			...actions,
			open: (view: View) => {
				const id = view.kind === "past" ? view.sessionId : latest.current.find(host => host.instanceId === view.instanceId)?.sessionId;
				if (id) location.hash = sessionsHash(workspace, id);
			},
		}),
		[actions, workspace],
	);
	const fallback = tab && latestSession(tab.sessions.byWorkspace.lists);
	const picked = session ?? (fallback === null ? null : fallback.kind === "past" ? fallback.sessionId : (hosts.find(host => host.instanceId === fallback.instanceId)?.sessionId ?? null));
	const host = picked === null ? null : (hosts.find(each => each.sessionId === picked) ?? null);
	const past = picked === null || host ? null : (saved.find(each => each.sessionId === picked) ?? null);
	const instanceId = host?.instanceId ?? null;
	const view = useMemo<View | null>(() => (instanceId !== null ? { kind: "live", instanceId, agentId: null } : picked !== null ? { kind: "past", sessionId: picked } : null), [instanceId, picked]);
	const open = useMemo(() => (view ? [view] : []), [view]);
	useShowConversation(view);
	if (!tab) return null;
	const { sessions, workspaces } = tab;
	return (
		<ListedTab
			label="Sessions"
			split
			list={
				<DashboardActionsContext.Provider value={rowActions}>
					<Roster
						workspaces={workspaces}
						lists={sessions.byWorkspace.lists}
						projects={NO_PROJECTS}
						pinnedIds={sessions.pinned}
						groups={sessions.byWorkspace.groups}
						board={board}
						query={sessions.query}
						onQuery={sessions.setQuery}
						onTogglePin={sessions.togglePin}
						open={open}
						projectOpen={null}
					/>
				</DashboardActionsContext.Provider>
			}
		>
			{/* The tab names the Workspace, not the session, so the conversation's header shows its title. */}
			<HeaderTitleShown.Provider value>
				{view ? (
					<ViewConversation
						key={picked}
						view={view}
						focused
						host={host}
						lastHost={null}
						session={past}
						models={(view.kind === "live" && core.models.get(view.instanceId)) || UNREAD}
						workspaces={core.workspaces}
						header
					/>
				) : (
					<p className="m-auto text-sm text-muted-foreground">No sessions in this Workspace yet</p>
				)}
			</HeaderTitleShown.Provider>
		</ListedTab>
	);
}
