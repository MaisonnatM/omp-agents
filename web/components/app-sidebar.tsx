import { Search } from "lucide-react";
import { memo, type ReactNode, useContext, useMemo } from "react";
import type { View } from "../../src/shared/sessions";
import { agentOn } from "../../src/shared/moves";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { type BotRow, botsNeedingYou } from "../bots-model";
import { SPACE_LABELS, sessionsWaiting, workspaceName } from "../labels";
import { yourMoveCount } from "../pull-requests-model";
import { pullRequestsStore } from "../reads";
import type { Page, SettingsRoute, SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import type { NavRow } from "../sidebar-tabs";
import type { SessionLists } from "../use-session-lists";
import type { WorkspaceScope } from "../use-workspace-scope";
import { AppMark } from "./app-mark";
import { PersonalContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { Roster } from "./roster";
import { type NavCount, SidebarNav } from "./sidebar-nav";

const NO_VIEWS: View[] = [];

interface AppSidebarProps {
	scope: WorkspaceScope;
	sessions: SessionLists;
	page: Page | null;
	/** The panes on screen. */
	panes: View[];
	/** The row of the page list the page on screen selects. */
	row: NavRow | null;
	onTab: (tab: SidebarTab) => void;
	/** The shown tabs, in the user's order. */
	tabs: readonly SidebarTab[];
	botList: BotRow[] | null;
	/** The open page's own list, shown beneath its row while the sidebar floats, as on a phone; otherwise the page holds it. */
	list: ReactNode;
	settings: SettingsRoute;
	onPickWorkspace: (cwd: string | null) => void;
	onSearch: () => void;
	/** The account row at the bottom: the space, and what else the app offers. */
	foot: ReactNode;
}

/**
 * The left sidebar: the app's row with the command menu, the page list, the roster, and the space as an account row.
 * The nodes it hands down are memoized, so a roster message that changes nothing the sidebar shows leaves it alone.
 */
export const AppSidebar = memo(function AppSidebar({
	scope: { visible, workspaces, workspace, scheduled, space },
	sessions: { lists, groups, waiting, query, setQuery, togglePin },
	page,
	panes,
	row,
	onTab,
	tabs,
	botList,
	list,
	settings,
	onPickWorkspace,
	onSearch,
	foot,
}: AppSidebarProps) {
	const { openNewSession } = useDashboardActions();
	const { connected, pullRequestsScope } = useDashboardStatus();
	const personal = useContext(PersonalContext);
	const pullRequestRead = pullRequestsStore.use(pullRequestsScope).read;
	const counts = useMemo(
		(): Partial<Record<SidebarTab, NavCount>> => ({
			sessions: { count: waiting, says: sessionsWaiting },
			bots: { count: botList ? botsNeedingYou(botList) : 0, says: sessionsWaiting },
			"pull-requests": { count: pullRequestRead ? yourMoveCount(pullRequestRead.data, agentOn(visible.hosts)) : 0, says: count => `${count} your move` },
		}),
		[waiting, botList, pullRequestRead, visible.hosts],
	);
	const selectedWorkspace = workspaces.find(({ cwd }) => cwd === workspace);
	const newSessionLabel = selectedWorkspace
		? `New session in ${workspaceName(selectedWorkspace.cwdDisplay, personal) ?? selectedWorkspace.cwdDisplay}`
		: space === "personal" ? `New session in ${SPACE_LABELS.personal}` : "New session";
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-(--page-header-height) shrink-0 items-center gap-1.5 pr-2 pl-[max(0.75rem,env(titlebar-area-x,0px))] select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]">
				<h1 className="sr-only">omp sessions</h1>
				<AppMark className="size-4 shrink-0" />
				<span aria-hidden className="text-[15px] font-semibold tracking-tight">omp</span>
				<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
					<Button {...activityControl("sidebar.command-menu")} variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onSearch}>
						<Search />
					</Button>
				</Tooltip>
				{/* The sidebar's toggle rides over this corner, from `DashboardSidebar`, so it can glide to the strip a hidden sidebar leaves. */}
				<span aria-hidden className="size-7 shrink-0" />
			</div>
			{!connected && <p className="mx-3 mb-1 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">Lost the dashboard server. Retrying…</p>}
			<SidebarNav
				tabs={tabs}
				current={row}
				counts={counts}
				list={list}
				newSessionLabel={newSessionLabel}
				onNewSession={() => openNewSession()}
				onTab={onTab}
				settingsRoute={settings}
			/>
			<SidebarContent>
				<Roster
					workspaces={workspaces}
					lists={lists}
					groups={groups}
					query={query}
					onQuery={setQuery}
					onTogglePin={togglePin}
					open={page ? NO_VIEWS : panes}
					scheduled={scheduled}
					scheduledOpen={page?.kind === "scheduled" ? page.id : null}
					onPickWorkspace={onPickWorkspace}
				/>
			</SidebarContent>
			<div className="shrink-0 px-2 pt-1 pb-2">
				{foot}
			</div>
		</div>
	);
});
