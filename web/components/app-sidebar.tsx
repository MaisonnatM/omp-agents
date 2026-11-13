import { Search } from "lucide-react";
import { memo, type ReactNode, useContext, useMemo } from "react";
import type { PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { BotId, BotLast } from "../../src/shared/bots";
import type { UserTodoList } from "../../src/user-todos-shared";
import { agentOn } from "../../src/shared/moves";
import { Button } from "@/components/ui/button";
import { SidebarContent } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../activity";
import { botRows, botsNeedingYou } from "../bots-model";
import { SPACE_LABELS, sessionsWaiting, workspaceName } from "../labels";
import { yourMoveCount } from "../pull-requests-model";
import { pullRequestsStore } from "../reads";
import type { PullRequestsRoute, Page, SettingsRoute, SidebarTab, TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import { shortcutLabels } from "../shortcuts";
import type { NavRow } from "../sidebar-tabs";
import type { SessionLists } from "../use-session-lists";
import type { WorkspaceScope } from "../use-workspace-scope";
import { AppMark } from "./app-mark";
import { BotsNav } from "./bots/bots-nav";
import { CalendarNav } from "./calendar/calendar-nav";
import { PersonalContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { EmailNav } from "./email/email-nav";
import { pullRequestsPageShows, usePullRequestDetailsPlacement, usePullRequestsView } from "./pull-requests/pull-requests-board";
import { PullRequestsBoardIndex, PullRequestsIndex, PullRequestsNav } from "./pull-requests/pull-requests-nav";
import { Roster } from "./roster";
import { SettingsNav } from "./settings/settings-nav";
import { type NavCount, SidebarNav } from "./sidebar-nav";
import { SportNav } from "./sport/nav";
import { TicketsNav } from "./tickets/tickets-nav";
import { TodoCategories } from "./todo/categories";

const NO_VIEWS: View[] = [];
const NO_PULL_REQUESTS_ROUTE: PullRequestsRoute = { target: null };

interface AppSidebarProps {
	scope: WorkspaceScope;
	sessions: SessionLists;
	page: Page | null;
	/** The panes on screen. */
	panes: View[];
	/** The row of the page list the page on screen selects, which holds its own list. */
	row: NavRow | null;
	onTab: (tab: SidebarTab) => void;
	/** The shown tabs, in the user's order. */
	tabs: readonly SidebarTab[];
	/** The server has sent the session lists. */
	listed: boolean;
	userTodos: UserTodoList | null;
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	hosts: RosterHost[];
	past: PastSession[];
	/** Each Bot's conversation's last words, `null` for a Bot with none yet. */
	botLasts: Readonly<Record<BotId, BotLast | null>>;
	todoView: TodoListView;
	settings: SettingsRoute;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	onPickWorkspace: (cwd: string | null) => void;
	onSearch: () => void;
	/** The account row at the bottom: the space, and what else the app offers. */
	foot: ReactNode;
}

/**
 * The left sidebar: the app's row with the command menu, the page list with the open page's own list, the roster, and
 * the space as an account row. The nodes it hands down are memoized, so a roster message that changes nothing the
 * sidebar shows leaves it alone.
 */
export const AppSidebar = memo(function AppSidebar({
	scope: { visible, workspaces, workspace, bots, scheduled, space },
	sessions: { lists, groups, waiting, query, setQuery, togglePin },
	page,
	panes,
	row,
	onTab,
	tabs,
	listed,
	userTodos,
	hosts,
	past,
	botLasts,
	todoView,
	settings,
	sectionTarget,
	onSectionTarget,
	onPickWorkspace,
	onSearch,
	foot,
}: AppSidebarProps) {
	const { changeTodo, openNewSession } = useDashboardActions();
	const { connected, pullRequestsScope } = useDashboardStatus();
	const personal = useContext(PersonalContext);
	const [pullRequestsView] = usePullRequestsView();
	const [detailsPlacement] = usePullRequestDetailsPlacement();
	const pullRequestRead = pullRequestsStore.use(pullRequestsScope).read;
	const todoSessions = useMemo(() => ({ hosts, past }), [hosts, past]);
	const botList = useMemo(() => (bots === null ? null : botRows(bots, hosts, botLasts)), [bots, hosts, botLasts]);
	const counts = useMemo(
		(): Partial<Record<SidebarTab, NavCount>> => ({
			sessions: { count: waiting, says: sessionsWaiting },
			bots: { count: botList ? botsNeedingYou(botList) : 0, says: sessionsWaiting },
			"pull-requests": { count: pullRequestRead ? yourMoveCount(pullRequestRead.data, agentOn(visible.hosts)) : 0, says: count => `${count} your move` },
		}),
		[waiting, botList, pullRequestRead, visible.hosts],
	);
	// The open page's own list: the Sessions page has the roster below instead, and New session and no row have none.
	const list = useMemo((): ReactNode => {
		switch (row) {
			case null:
			case "new":
			case "sessions":
				return null;
			case "pull-requests": {
				// Until the sessions are listed, the saved workspace reads as all workspaces, which would ask GitHub about every repository.
				if (!listed) return <p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>;
				// The Pull requests page lists the pull requests itself, so the sidebar links to its sections or columns then,
				// and lists them only beside a pull request's page or another page.
				const shows = page?.kind === "pull-requests" ? pullRequestsPageShows(pullRequestsView, detailsPlacement, page) : "details";
				if (shows === "list") return <PullRequestsIndex hosts={visible.hosts} target={sectionTarget} onTarget={onSectionTarget} />;
				if (shows === "board") return <PullRequestsBoardIndex hosts={visible.hosts} target={sectionTarget} onTarget={onSectionTarget} />;
				return <PullRequestsNav hosts={visible.hosts} past={visible.past} route={page?.kind === "pull-requests" ? page : NO_PULL_REQUESTS_ROUTE} />;
			}
			case "tickets":
				return <TicketsNav target={sectionTarget} onTarget={onSectionTarget} />;
			case "bots":
				return <BotsNav rows={botList} openId={page?.kind !== "bots" ? undefined : page.target === null ? (page.adding ? null : undefined) : page.target} />;
			case "todo":
				return <TodoCategories list={userTodos} view={todoView} disabled={!connected} onChange={changeTodo} sessions={todoSessions} />;
			case "calendar":
				return <CalendarNav open={page?.kind === "calendar"} space={space} />;
			case "email":
				return <EmailNav space={space} />;
			case "sport":
				return <SportNav open={page?.kind === "sport" ? page : null} />;
			case "settings":
				return <SettingsNav route={settings} />;
			default: {
				const never: never = row;
				return never;
			}
		}
	}, [row, listed, page, pullRequestsView, detailsPlacement, visible, sectionTarget, onSectionTarget, botList, userTodos, todoView, connected, changeTodo, todoSessions, space, settings]);
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
			<SidebarContent>
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
