/** `PageList`, the open page's own list, and `PageListColumn`, the column at the page's left that holds it, as Linear's inbox does. */
import { type ReactNode, type RefObject, useLayoutEffect, useState } from "react";
import type { BotRow } from "../bots-model";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import type { UserTodoList } from "../../src/user-todos-shared";
import { ScrollArea } from "@/components/ui/scroll-area";
import { COLUMN_DEFAULT, COLUMN_MAX, COLUMN_MIN, type ListPage } from "../page-list";
import { useStoredState } from "../stored-state";
import type { TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import { TAB_ROWS } from "../sidebar-tabs";
import { BotsNav } from "./bots/bots-nav";
import { CalendarNav } from "./calendar/calendar-nav";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { EmailNav } from "./email/email-nav";
import { pullRequestsPageShows, usePullRequestDetailsPlacement, usePullRequestsView } from "./pull-requests/pull-requests-board";
import { PullRequestsBoardIndex, PullRequestsIndex, PullRequestsNav } from "./pull-requests/pull-requests-nav";
import { SettingsNav } from "./settings/settings-nav";
import { SportNav } from "./sport/nav";
import { TicketsNav } from "./tickets/tickets-nav";
import { TodoCategories } from "./todo/categories";
import { Separator, useDragSeparator } from "./drag-separator";

const COLUMN_STEP = 16;

interface PageListProps {
	page: ListPage;
	/** The server has sent the session lists. */
	listed: boolean;
	/** The sessions, live and past, which the pull request lists ask GitHub about. */
	hosts: RosterHost[];
	past: PastSession[];
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	todoSessions: { hosts: RosterHost[]; past: PastSession[] };
	botList: BotRow[] | null;
	userTodos: UserTodoList | null;
	todoView: TodoListView;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
}

export function PageList({ page, listed, hosts, past, todoSessions, botList, userTodos, todoView, sectionTarget, onSectionTarget }: PageListProps) {
	const { changeTodo } = useDashboardActions();
	const { connected } = useDashboardStatus();
	const [pullRequestsView] = usePullRequestsView();
	const [detailsPlacement] = usePullRequestDetailsPlacement();
	switch (page.kind) {
		case "pull-requests": {
			// Until the sessions are listed, the saved workspace reads as all workspaces, which would ask GitHub about every repository.
			if (!listed) return <p className="px-3 py-1 text-xs text-muted-foreground">Listing sessions…</p>;
			// The page lists the pull requests itself, so its list links to the page's sections or columns, and lists them only beside a pull request's details.
			const shows = pullRequestsPageShows(pullRequestsView, detailsPlacement, page);
			if (shows === "list") return <PullRequestsIndex hosts={hosts} target={sectionTarget} onTarget={onSectionTarget} />;
			if (shows === "board") return <PullRequestsBoardIndex hosts={hosts} target={sectionTarget} onTarget={onSectionTarget} />;
			return <PullRequestsNav hosts={hosts} past={past} route={page} />;
		}
		case "tickets":
			return <TicketsNav target={sectionTarget} onTarget={onSectionTarget} />;
		case "bots":
			return <BotsNav rows={botList} openId={page.target === null ? (page.adding ? null : undefined) : page.target} />;
		case "todo":
			return <TodoCategories list={userTodos} view={todoView} disabled={!connected} onChange={changeTodo} sessions={todoSessions} />;
		case "calendar":
			return <CalendarNav />;
		case "email":
			return <EmailNav />;
		case "sport":
			return <SportNav open={page} />;
		case "settings":
			return <SettingsNav route={page} />;
		default: {
			const never: never = page;
			return never;
		}
	}
}

/** The width of the element `ref` holds, in px, read before paint and on each resize. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setWidth(element.clientWidth);
		const observer = new ResizeObserver(() => setWidth(element.clientWidth));
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

/**
 * The column at the page's left that holds its {@link PageList}, the full height of the page; drag its right edge to size
 * it. The width the user picked holds for every page, and `max`, what leaves the page beside it its floor, caps it.
 */
export function PageListColumn({ page, max, children }: { page: ListPage; max: number; children: ReactNode }) {
	const label = page.kind === "settings" ? "Settings" : TAB_ROWS[page.kind].label;
	const [stored, setStored] = useStoredState("omp-agents.page-list-width", raw => {
		const value = Number(raw);
		return value >= COLUMN_MIN && value <= COLUMN_MAX ? value : COLUMN_DEFAULT;
	});
	const width = Math.min(stored, max);
	const clamp = (next: number): number => Math.round(Math.max(COLUMN_MIN, Math.min(max, next)));
	const events = useDragSeparator({
		value: width,
		onValue: setStored,
		axis: "vertical",
		keyStep: COLUMN_STEP,
		shiftSteps: 4,
		min: COLUMN_MIN,
		max,
		reset: Math.min(COLUMN_DEFAULT, max),
		clamp,
		read: (event, start) => clamp(start.value + event.clientX - start.coordinate),
	});
	return (
		<nav aria-label={label} style={{ width }} className="relative flex shrink-0 flex-col border-r border-border">
			<ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade px-2 py-2 [&>div]:!block [&>div]:!min-w-0">
				{children}
			</ScrollArea>
			<Separator
				{...events}
				axis="vertical"
				label={`Resize the ${label} column`}
				min={COLUMN_MIN}
				max={max}
				now={width}
				className="inset-y-0 -right-px w-3 translate-x-1/2 cursor-col-resize select-none"
			/>
		</nav>
	);
}
