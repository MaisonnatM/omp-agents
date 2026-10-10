import { type Dispatch, type SetStateAction, memo, useCallback, useMemo } from "react";
import type { Notice } from "../../src/shared/notices";
import type { PastSession, RosterHost, View } from "../../src/shared/sessions";
import type { Routine } from "../../src/routines";
import type { UserTodoList } from "../../src/user-todos-shared";
import type { PaletteEvent } from "../command-palette";
import type { PullRequestsRoute, Page, SettingsRoute, SidebarTab, TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import type { SessionLists } from "../use-session-lists";
import type { Workspace } from "../use-workspace";
import { PullRequestsIndex, PullRequestsNav } from "./pull-requests/pull-requests-nav";
import { NoticesBell } from "./notices";
import { Roster } from "./roster";
import { SidebarToggle } from "./sidebar-panel";

const NO_VIEWS: View[] = [];
const NO_PULL_REQUESTS_ROUTE: PullRequestsRoute = { target: null };

interface AppSidebarProps {
	workspace: Workspace;
	sessions: SessionLists;
	page: Page | null;
	/** The panes on screen. */
	panes: View[];
	tab: SidebarTab;
	onTab: (tab: SidebarTab) => void;
	ticketsShown: boolean;
	/** The server has sent the session lists. */
	listed: boolean;
	userTodos: UserTodoList | null;
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	hosts: RosterHost[];
	past: PastSession[];
	notices: Notice[];
	routines: Routine[];
	todoView: TodoListView;
	routinesTarget: string | null;
	settings: SettingsRoute;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	onPickProject: (cwd: string | null) => void;
	dispatchPalette: Dispatch<PaletteEvent>;
	setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
	toggleSidebar: (side: "left") => void;
}

/**
 * The left sidebar's content: the roster wired to the page. The nodes it hands the roster are memoized, so a roster
 * message that changes nothing the sidebar shows leaves it alone.
 */
export const AppSidebar = memo(function AppSidebar({
	workspace: { visible, projects, project },
	sessions: { lists, waiting, query, setQuery, togglePin },
	page,
	panes,
	tab,
	onTab,
	ticketsShown,
	listed,
	userTodos,
	hosts,
	past,
	notices,
	routines,
	todoView,
	routinesTarget,
	settings,
	sectionTarget,
	onSectionTarget,
	onPickProject,
	dispatchPalette,
	setShortcutsOpen,
	toggleSidebar,
}: AppSidebarProps) {
	const pullRequestsTab = useMemo(() => {
		// Until the sessions are listed, the saved project reads as all projects, which would ask GitHub about every repository.
		if (!listed) return <p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>;
		// The Pull requests page lists the pull requests itself, so the sidebar's Pull requests tab shows its sections then.
		if (page?.kind === "pull-requests" && !page.target) return <PullRequestsIndex project={project} hosts={visible.hosts} target={sectionTarget} onTarget={onSectionTarget} />;
		return <PullRequestsNav project={project} hosts={visible.hosts} past={visible.past} route={page?.kind === "pull-requests" ? page : NO_PULL_REQUESTS_ROUTE} />;
	}, [listed, page, project, visible, sectionTarget, onSectionTarget]);
	const toggle = useMemo(() => <SidebarToggle side="left" open onToggle={() => toggleSidebar("left")} />, [toggleSidebar]);
	const todoSessions = useMemo(() => ({ hosts, past }), [hosts, past]);
	const calendarTab = useMemo(
		() => (page?.kind === "calendar" ? page : page?.kind === "routines" ? ({ kind: "routines", target: routinesTarget } as const) : null),
		[page, routinesTarget],
	);
	const onShowSearch = useCallback(() => dispatchPalette({ type: "open" }), [dispatchPalette]);
	const onShowShortcuts = useCallback(() => setShortcutsOpen(true), [setShortcutsOpen]);
	const bell = useMemo(() => <NoticesBell notices={notices} />, [notices]);
	return (
		<Roster
			projects={projects}
			lists={lists}
			waiting={waiting}
			query={query}
			onQuery={setQuery}
			onTogglePin={togglePin}
			open={page ? NO_VIEWS : panes}
			newSessionOpen={page?.kind === "new"}
			ticketsShown={ticketsShown}
			tab={tab}
			onTab={onTab}
			userTodos={userTodos}
			todoView={todoView}
			todoSessions={todoSessions}
			routines={routines}
			calendarTab={calendarTab}
			settingsRoute={settings}
			sectionTarget={sectionTarget}
			onSectionTarget={onSectionTarget}
			pullRequestsTab={pullRequestsTab}
			hosts={visible.hosts}
			project={project}
			onPickProject={onPickProject}
			onShowSearch={onShowSearch}
			onShowShortcuts={onShowShortcuts}
			bell={bell}
			toggle={toggle}
		/>
	);
});
