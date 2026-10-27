import { type Dispatch, type SetStateAction, memo, useCallback, useMemo } from "react";
import type { PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { Routine } from "../../src/routines";
import type { UserNoteList } from "../../src/user-notes-shared";
import type { UserTodoList } from "../../src/user-todos-shared";
import type { NotesListView, PullRequestsRoute, Page, SettingsRoute, SidebarPanel, SidebarTab, TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import type { SessionLists } from "../use-session-lists";
import type { WorkspaceScope } from "../use-workspace-scope";
import { pullRequestsPageShows, usePullRequestsView } from "./pull-requests/pull-requests-board";
import { PullRequestsBoardIndex, PullRequestsIndex, PullRequestsNav } from "./pull-requests/pull-requests-nav";
import { Roster } from "./roster";

const NO_VIEWS: View[] = [];
const NO_PULL_REQUESTS_ROUTE: PullRequestsRoute = { target: null };

interface AppSidebarProps {
	scope: WorkspaceScope;
	sessions: SessionLists;
	page: Page | null;
	/** The panes on screen. */
	panes: View[];
	tab: SidebarPanel;
	onTab: (tab: SidebarTab) => void;
	/** The tabs the bar draws, the header switch's group's shown tabs, in order. */
	tabs: readonly SidebarTab[];
	/** The server has sent the session lists. */
	listed: boolean;
	userTodos: UserTodoList | null;
	userNotes: UserNoteList | null;
	notesView: NotesListView;
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	hosts: RosterHost[];
	past: PastSession[];
	routines: Routine[];
	todoView: TodoListView;
	routinesTarget: string | null;
	settings: SettingsRoute;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	onPickWorkspace: (cwd: string | null) => void;
	setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * The left sidebar's content: the roster wired to the page. The nodes it hands the roster are memoized, so a roster
 * message that changes nothing the sidebar shows leaves it alone.
 */
export const AppSidebar = memo(function AppSidebar({
	scope: { visible, workspaces, workspace },
	sessions: { lists, waiting, query, setQuery, togglePin },
	page,
	panes,
	tab,
	onTab,
	tabs,
	listed,
	userTodos,
	userNotes,
	notesView,
	hosts,
	past,
	routines,
	todoView,
	routinesTarget,
	settings,
	sectionTarget,
	onSectionTarget,
	onPickWorkspace,
	setShortcutsOpen,
}: AppSidebarProps) {
	const [pullRequestsView] = usePullRequestsView();
	const pullRequestsTab = useMemo(() => {
		// Until the sessions are listed, the saved workspace reads as all workspaces, which would ask GitHub about every repository.
		if (!listed) return <p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>;
		// The Pull requests page lists the pull requests itself, so the sidebar's Pull requests tab links to its sections or
		// columns then, and lists them only beside a pull request's page or another page.
		const shows = page?.kind === "pull-requests" ? pullRequestsPageShows(pullRequestsView, page) : "details";
		if (shows === "list") return <PullRequestsIndex workspace={workspace} hosts={visible.hosts} target={sectionTarget} onTarget={onSectionTarget} />;
		if (shows === "board") return <PullRequestsBoardIndex workspace={workspace} hosts={visible.hosts} target={sectionTarget} onTarget={onSectionTarget} />;
		return <PullRequestsNav workspace={workspace} hosts={visible.hosts} past={visible.past} route={page?.kind === "pull-requests" ? page : NO_PULL_REQUESTS_ROUTE} />;
	}, [listed, page, pullRequestsView, workspace, visible, sectionTarget, onSectionTarget]);
	const todoSessions = useMemo(() => ({ hosts, past }), [hosts, past]);
	const routinesOpen = page?.kind === "routines" ? routinesTarget : undefined;
	const onShowShortcuts = useCallback(() => setShortcutsOpen(true), [setShortcutsOpen]);
	return (
		<Roster
			workspaces={workspaces}
			lists={lists}
			waiting={waiting}
			query={query}
			onQuery={setQuery}
			onTogglePin={togglePin}
			open={page ? NO_VIEWS : panes}
			newSessionOpen={page?.kind === "new"}
			scheduledOpen={page?.kind === "scheduled" ? page.id : null}
			tabs={tabs}
			tab={tab}
			onTab={onTab}
			userTodos={userTodos}
			todoView={todoView}
			userNotes={userNotes}
			notesView={notesView}
			todoSessions={todoSessions}
			routines={routines}
			routinesOpen={routinesOpen}
			calendarOpen={page?.kind === "calendar"}
			settingsRoute={settings}
			sectionTarget={sectionTarget}
			onSectionTarget={onSectionTarget}
			pullRequestsTab={pullRequestsTab}
			hosts={visible.hosts}
			workspace={workspace}
			onPickWorkspace={onPickWorkspace}
			onShowShortcuts={onShowShortcuts}
		/>
	);
});
