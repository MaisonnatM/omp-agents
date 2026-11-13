/** `PageList`, the open page's own list, and `PageListColumn`, the column at the page's left that holds it, as Linear's inbox does. */
import type { ReactNode } from "react";
import type { BotRow } from "../bots-model";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import type { UserNoteList } from "../../src/user-notes-shared";
import type { UserTodoList } from "../../src/user-todos-shared";
import type { Space } from "../../src/shared/workspaces";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStoredState } from "../stored-state";
import type { NotesListView, Page, PullRequestsRoute, SettingsRoute, TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import { type NavRow, TAB_ROWS } from "../sidebar-tabs";
import { BotsNav } from "./bots/bots-nav";
import { CalendarNav } from "./calendar/calendar-nav";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { EmailNav } from "./email/email-nav";
import { NotesNav } from "./notes/nav";
import { pullRequestsPageShows, usePullRequestDetailsPlacement, usePullRequestsView } from "./pull-requests/pull-requests-board";
import { PullRequestsBoardIndex, PullRequestsIndex, PullRequestsNav } from "./pull-requests/pull-requests-nav";
import { SettingsNav } from "./settings/settings-nav";
import { SportNav } from "./sport/nav";
import { TicketsNav } from "./tickets/tickets-nav";
import { TodoCategories } from "./todo/categories";
import { Separator, useDragSeparator } from "./drag-separator";

const NO_PULL_REQUESTS_ROUTE: PullRequestsRoute = { target: null };

/** The column's width in px: one width for every page's list, kept in this browser as the other list widths are. */
const COLUMN_DEFAULT = 256;
const COLUMN_MIN = 192;
const COLUMN_MAX = 400;
const COLUMN_STEP = 16;

const clampColumn = (width: number): number => Math.round(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, width)));

/** A row whose page has a list of its own: the Sessions page has the roster in the sidebar instead, and New session has none. */
export type ListRow = Exclude<NavRow, "new" | "sessions">;

export const hasPageList = (row: NavRow | null): row is ListRow => row !== null && row !== "new" && row !== "sessions";

interface PageListProps {
	row: ListRow;
	page: Page | null;
	/** The server has sent the session lists. */
	listed: boolean;
	/** The space's sessions, live and past, which the pull request lists ask GitHub about. */
	hosts: RosterHost[];
	past: PastSession[];
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	todoSessions: { hosts: RosterHost[]; past: PastSession[] };
	botList: BotRow[] | null;
	userTodos: UserTodoList | null;
	todoView: TodoListView;
	userNotes: UserNoteList | null;
	notesView: NotesListView;
	space: Space;
	settings: SettingsRoute;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
}

export function PageList({ row, page, listed, hosts, past, todoSessions, botList, userTodos, todoView, userNotes, notesView, space, settings, sectionTarget, onSectionTarget }: PageListProps) {
	const { changeTodo } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [pullRequestsView] = usePullRequestsView();
	const [detailsPlacement] = usePullRequestDetailsPlacement();
	switch (row) {
		case "pull-requests": {
			// Until the sessions are listed, the saved workspace reads as all workspaces, which would ask GitHub about every repository.
			if (!listed) return <p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>;
			// The Pull requests page lists the pull requests itself, so its list links to the page's sections or columns then,
			// and lists them only beside a pull request's page or another page.
			const shows = page?.kind === "pull-requests" ? pullRequestsPageShows(pullRequestsView, detailsPlacement, page) : "details";
			if (shows === "list") return <PullRequestsIndex hosts={hosts} target={sectionTarget} onTarget={onSectionTarget} />;
			if (shows === "board") return <PullRequestsBoardIndex hosts={hosts} target={sectionTarget} onTarget={onSectionTarget} />;
			return <PullRequestsNav hosts={hosts} past={past} route={page?.kind === "pull-requests" ? page : NO_PULL_REQUESTS_ROUTE} />;
		}
		case "tickets":
			return <TicketsNav target={sectionTarget} onTarget={onSectionTarget} />;
		case "bots":
			return <BotsNav rows={botList} openId={page?.kind !== "bots" ? undefined : page.target === null ? (page.adding ? null : undefined) : page.target} />;
		case "todo":
			return <TodoCategories list={userTodos} view={todoView} disabled={!connected} onChange={changeTodo} sessions={todoSessions} />;
		case "notes":
			return <NotesNav list={userNotes} view={notesView} space={space} />;
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
}

/** The column at the page's left that holds its {@link PageList}, the full height of the page, beside the page's own content; drag its right edge to size it. */
export function PageListColumn({ row, children }: { row: ListRow; children: ReactNode }) {
	const label = row === "settings" ? "Settings" : TAB_ROWS[row].label;
	const [width, setWidth] = useStoredState("omp-agents.page-list-width", raw => {
		const stored = Number(raw);
		return stored >= COLUMN_MIN && stored <= COLUMN_MAX ? stored : COLUMN_DEFAULT;
	});
	const events = useDragSeparator({
		value: width,
		onValue: setWidth,
		axis: "vertical",
		keyStep: COLUMN_STEP,
		shiftSteps: 4,
		min: COLUMN_MIN,
		max: COLUMN_MAX,
		reset: COLUMN_DEFAULT,
		clamp: clampColumn,
		read: (event, start) => clampColumn(start.value + event.clientX - start.coordinate),
	});
	return (
		<nav aria-label={`${label} list`} style={{ width }} className="relative flex shrink-0 flex-col border-r border-border">
			<ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade px-2 py-2 [&>div]:!block [&>div]:!min-w-0">
				{children}
			</ScrollArea>
			<Separator
				{...events}
				axis="vertical"
				label={`Resize the ${label.toLowerCase()} list`}
				min={COLUMN_MIN}
				max={COLUMN_MAX}
				now={width}
				className="inset-y-0 -right-px w-3 translate-x-1/2 cursor-col-resize select-none"
			/>
		</nav>
	);
}
