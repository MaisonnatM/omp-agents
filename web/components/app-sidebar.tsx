import { IconMagnifyingGlass } from "central-icons";
import { memo, type ReactNode, useMemo } from "react";
import type { View } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import type { Page, SettingsRoute, SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import type { NavRow } from "../sidebar-tabs";
import type { BoardState } from "../../templates/omp/agent/extensions/board/log";
import { BoardSidebar, ThreadsRow } from "./board/sidebar";
import { BOARD_PAGE } from "./board/module";
import type { SessionLists } from "../use-session-lists";
import type { WorkspaceScope } from "../use-workspace-scope";
import { AppMark } from "./app-mark";
import { useDashboardStatus } from "./dashboard-context";
import { PinnedGroup, Roster } from "./roster";
import { SidebarNav } from "./sidebar-nav";

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
	/** The shown tabs, in the user's order; while the Board's is among them, the sidebar lists its Workspaces under the page rows instead of the sessions, rather than a row. */
	tabs: readonly SidebarTab[];
	/** The Board, `null` until the server sends it. */
	board: BoardState | null;
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
	list,
	settings,
	unreadNotices,
	onPickWorkspace,
	onSearch,
}: AppSidebarProps) {
	const { connected } = useDashboardStatus();
	const hasBoard = tabs.includes("board");
	// Pull requests open from a Workspace's Board, not from the sidebar.
	const pageTabs = useMemo(() => tabs.filter(tab => tab !== "board" && tab !== "pull-requests"), [tabs]);
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
			<SidebarNav
				tabs={pageTabs}
				current={row}
				counts={{}}
				list={list}
				onTab={onTab}
				settingsRoute={settings}
				unreadNotices={unreadNotices}
				first={hasBoard && <ThreadsRow state={board} active={page?.kind === "board" && page.view.tab === "threads"} />}
			/>
			{hasBoard ? (
				<>
					<div className="shrink-0">
						<PinnedGroup pinned={lists.pinned} open={page ? NO_VIEWS : panes} showWorkspace={false} onTogglePin={togglePin} />
					</div>
					<BoardSidebar route={page?.kind === "board" ? page : BOARD_PAGE.home} state={board} workspaces={workspaces} picked={workspace} hosts={visible.hosts} />
				</>
			) : (
				<SidebarContent>
					<Roster
						workspaces={workspaces}
						lists={lists}
						projects={projects}
						pinnedIds={pinned}
						groups={groups}
						board={board}
						query={query}
						onQuery={setQuery}
						onTogglePin={togglePin}
						open={page ? NO_VIEWS : panes}
						projectOpen={page?.kind === "projects" ? page.open : null}
						onPickWorkspace={onPickWorkspace}
					/>
				</SidebarContent>
			)}
		</div>
	);
});
