import { IconMagnifyingGlass } from "central-icons";
import { memo, type ReactNode, useMemo } from "react";
import type { View } from "../../src/shared/sessions";
import { agentOn } from "../../src/shared/moves";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { type BotRow, botsNeedingYou } from "../bots-model";
import { folderName, sessionsWaiting } from "../labels";
import { withoutHidden, yourMoveCount } from "../pull-requests-model";
import { useHiddenRepos } from "../pull-requests-state";
import { pullRequestsStore } from "../reads";
import type { Page, SettingsRoute, SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import type { NavRow } from "../sidebar-tabs";
import type { BoardState } from "../../templates/omp/agent/extensions/board/log";
import { BoardSidebar } from "./board/sidebar";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "./segmented-tabs";
import type { KnownSessions } from "./todo/links";
import type { SessionLists } from "../use-session-lists";
import type { WorkspaceScope } from "../use-workspace-scope";
import { AppMark } from "./app-mark";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
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
	onTab: (tab: SidebarTab | "sessions") => void;
	/** The shown tabs, in the user's order; the Board's is the sidebar's own Board tab, beside Sessions, rather than a row. */
	tabs: readonly SidebarTab[];
	/** The Board, `null` until the server sends it. */
	board: BoardState | null;
	/** Every live and past session, which the Board tab names. */
	known: KnownSessions;
	botList: BotRow[] | null;
	/** The open page's own list, shown beneath its row while the sidebar floats, as on a phone; otherwise the page holds it. */
	list: ReactNode;
	settings: SettingsRoute;
	unreadNotices: number;
	onPickWorkspace: (cwd: string | null) => void;
	onSearch: () => void;
}

/**
 * The left sidebar above its foot: the app's row with the command menu, the page list, and the roster; `SidebarFoot` sits under it.
 * The nodes it hands down are memoized, so a roster message that changes nothing the sidebar shows leaves it alone.
 */
export const AppSidebar = memo(function AppSidebar({
	scope: { visible, workspaces, workspace },
	sessions: { lists, projects, pinned, groups, query, setQuery, togglePin },
	page,
	panes,
	row,
	onTab,
	tabs,
	board,
	known,
	botList,
	list,
	settings,
	unreadNotices,
	onPickWorkspace,
	onSearch,
}: AppSidebarProps) {
	const { openNewSession } = useDashboardActions();
	const { connected, pullRequestsScope } = useDashboardStatus();
	const pullRequestRead = pullRequestsStore.use(pullRequestsScope).read;
	const [hiddenRepos] = useHiddenRepos();
	const counts = useMemo(
		(): Partial<Record<SidebarTab, NavCount>> => ({
			bots: { count: botList ? botsNeedingYou(botList) : 0, says: sessionsWaiting },
			"pull-requests": { count: pullRequestRead ? yourMoveCount(withoutHidden(pullRequestRead.data, hiddenRepos), agentOn(visible.hosts)) : 0, says: count => `${count} your move` },
		}),
		[botList, pullRequestRead, hiddenRepos, visible.hosts],
	);
	const selectedWorkspace = workspaces.find(({ cwd }) => cwd === workspace);
	const newSessionLabel = selectedWorkspace ? `New session in ${folderName(selectedWorkspace.cwdDisplay) ?? selectedWorkspace.cwdDisplay}` : "New session";
	const hasBoard = tabs.includes("board");
	const onBoard = hasBoard && page?.kind === "board";
	const pageTabs = useMemo(() => tabs.filter(tab => tab !== "board"), [tabs]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-(--window-header-height) shrink-0 items-center justify-end pr-2 select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]">
				<h1 className="sr-only">omp sessions</h1>
				{/* The sidebar's toggle rides over this corner, from `DashboardSidebar`, so it can glide to the strip a hidden sidebar leaves. */}
				<span aria-hidden className="size-7 shrink-0" />
			</div>
			<div className="mx-2 flex h-8 shrink-0 items-center gap-1.5 pl-2">
				<AppMark className="size-4 shrink-0" />
				<span aria-hidden className="text-[15px] font-semibold tracking-tight">omp</span>
				<Tooltip content="Command menu" shortcut={shortcutLabels("switcher")} side="bottom">
					<Button {...activityControl("sidebar.command-menu")} variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" aria-label="Command menu" onClick={onSearch}>
						<IconMagnifyingGlass />
					</Button>
				</Tooltip>
			</div>
			{!connected && <p className="mx-3 mb-1 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">Lost the dashboard server. Retrying…</p>}
			{hasBoard && (
				<SegmentedTabs value={onBoard ? "board" : "sessions"} onValueChange={value => onTab(value === "board" ? "board" : "sessions")} className="mx-3 mt-1 mb-1 shrink-0">
					<SegmentedTabsList aria-label="Sidebar" className="grid w-full grid-cols-2">
						<SegmentedTab {...activityControl("sidebar.view.sessions")} value="sessions">
							Sessions
						</SegmentedTab>
						<SegmentedTab {...activityControl("sidebar.view.board")} value="board">
							Board
						</SegmentedTab>
					</SegmentedTabsList>
				</SegmentedTabs>
			)}
			{onBoard ? (
				<BoardSidebar route={page} state={board} workspaces={workspaces} picked={workspace} sessions={known} />
			) : (
				<>
					<SidebarNav
						tabs={pageTabs}
						current={row}
						counts={counts}
						list={list}
						newSessionLabel={newSessionLabel}
						onNewSession={() => openNewSession()}
						onTab={onTab}
						settingsRoute={settings}
						unreadNotices={unreadNotices}
					/>
					<SidebarContent>
						<Roster
							workspaces={workspaces}
							lists={lists}
							projects={projects}
							pinnedIds={pinned}
							groups={groups}
							query={query}
							onQuery={setQuery}
							onTogglePin={togglePin}
							open={page ? NO_VIEWS : panes}
							projectOpen={page?.kind === "projects" ? page.open : null}
							onPickWorkspace={onPickWorkspace}
						/>
					</SidebarContent>
				</>
			)}
		</div>
	);
});
