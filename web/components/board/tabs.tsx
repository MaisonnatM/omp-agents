/** The tabs across a Workspace's Board, as across a Slack channel, and every tab but Messages: another page's content kept to the Workspace. */
import * as TabsPrimitive from "@ui-sdk/react/tabs";
import { useMemo } from "react";
import { activityControl } from "../../activity";
import type { WebModuleId } from "../../modules";
import { botRows } from "../../bots-model";
import { PageHashContext } from "../../page-hash";
import { pullRequestsScope, pullRequestsStore } from "../../reads";
import { hashForPage, type PullRequestsRoute, WORKSPACE_SECTIONS, workspaceSection } from "../../routing";
import { workspaceCwd } from "../../sessions";
import { DashboardStatusContext, useDashboardActions, useDashboardStatus } from "../dashboard-context";
import type { CoreData } from "../module-views";
import { BotsView } from "../bots/bots-view";
import { ProjectMemoryTab } from "../memory/project-memory";
import { ProjectsPage } from "../projects/page";
import { PullRequestsPage } from "../pull-requests/pull-requests-page";
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
				if (picked) location.hash = hashForPage({ kind: "board", workspace, view: tabView(picked.id), search: null, reply: null, bots: false });
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

/** The sessions, Bots, and projects of Workspace `cwd`; a session belongs by its Workspace, a Bot by its directory, a project by the Workspace it was made in, or, made on the Projects page, by a session of it that ran here. */
function workspaceSlice(core: CoreData, cwd: string | null) {
	const here = <Row extends { cwd: string; workspace: Parameters<typeof workspaceCwd>[0]["workspace"] }>(rows: Row[]): Row[] => rows.filter(row => workspaceCwd(row) === cwd);
	const hosts = here(core.sessions.hosts);
	const past = here(core.sessions.past);
	const ran = new Set([...hosts, ...past].map(row => row.sessionId));
	const bots = core.bots && core.bots.filter(bot => bot.cwd === cwd);
	const projects = core.projects && { projects: core.projects.projects.filter(project => (project.workspace === undefined ? project.sessionIds.some(id => ran.has(id)) : project.workspace === cwd)) };
	return { hosts, past, bots, projects };
}

/** A tab other than Messages: the page it names, kept to the Workspace; a Bot, project, or pull request it opens shows in the tab. */
export function WorkspaceTab({ view, workspace, core, disabled }: { view: Exclude<BoardView, { tab: "messages" }>; workspace: string | null; core: CoreData; disabled: boolean }) {
	const to = useMemo(() => boardPageHash(workspace), [workspace]);
	return (
		<PageHashContext.Provider value={to}>
			<TabPage view={view} workspace={workspace} core={core} disabled={disabled} />
		</PageHashContext.Provider>
	);
}

function TabPage({ view, workspace, core, disabled }: { view: Exclude<BoardView, { tab: "messages" }>; workspace: string | null; core: CoreData; disabled: boolean }) {
	const { changeModule } = useDashboardActions();
	const slice = workspaceSlice(core, workspace);
	switch (view.tab) {
		case "bots":
			return (
				<BotsView
					route={view.page}
					rows={slice.bots && botRows(slice.bots, core.sessions.hosts, core.botLasts)}
					routines={core.routines}
					open={core.openBot}
					bots={core.bots}
					past={core.sessions.past}
					lastHosts={core.lastHosts}
					models={core.models}
					workspaces={core.workspaces}
					defaultCwd={workspace ?? core.defaultWorkspace}
					connected={core.connected}
					detailsOpen={core.detailsOpen}
					onToggleDetails={core.onToggleDetails}
					completions={core.newSessionCompletions}
				/>
			);
		case "pull-requests":
			return <WorkspacePullRequests workspace={workspace} hosts={slice.hosts} past={slice.past} route={view.page} />;
		case "memory":
			return <ProjectMemoryTab repo={workspace} pinned />;
		case "projects":
			return (
				<ProjectsPage
					route={view.page}
					core={core}
					state={slice.projects}
					empty="No projects in this Workspace yet"
					workspace={workspace ?? undefined}
					disabled={disabled}
					onChange={change => changeModule("projects", change)}
				/>
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

const settingsHash = (workspace: string | null, section: string) => hashForPage({ kind: "board", workspace, view: { tab: "settings", section }, search: null, reply: null, bots: false });

/** Settings kept to the Workspace, with no workspace picker: its sections down the left, the one the address names at the right. */
function WorkspaceSettings({ workspace, workspaces, section: named }: { workspace: string | null; workspaces: CoreData["workspaces"]; section: string | null }) {
	const section = workspaceSection(named);
	return (
		<TabsPrimitive.Tabs
			value={section}
			onValueChange={next => {
				const picked = WORKSPACE_SECTIONS.find(({ value }) => value === next);
				if (picked) location.hash = settingsHash(workspace, picked.value);
			}}
			activation="manual"
			orientation="vertical"
			className="flex min-h-0 flex-1 @container/board-settings max-phone:flex-col"
		>
			<TabsPrimitive.TabsList aria-label="Workspace settings" className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2 max-phone:w-full max-phone:flex-row max-phone:overflow-x-auto max-phone:border-r-0 max-phone:border-b">
				{WORKSPACE_SECTIONS.map(({ value, label, icon: Icon }) => (
					<TabsPrimitive.TabsTab
						key={value}
						value={value}
						className="flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-selected:bg-accent aria-selected:font-medium aria-selected:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
					>
						<Icon aria-hidden className="size-4 shrink-0" />
						{label}
					</TabsPrimitive.TabsTab>
				))}
			</TabsPrimitive.TabsList>
			<SettingsPage key={workspace ?? ""} section={section} cwd={workspace} workspaces={workspaces} scope={{ kind: "workspace", sectionHash: value => settingsHash(workspace, value) }} />
		</TabsPrimitive.Tabs>
	);
}
