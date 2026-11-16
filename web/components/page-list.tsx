/** `PageList`, the open page's own list, and `PageListColumn`, the column at the page's left that holds it, as Linear's inbox does. */
import { type ReactNode, type RefObject, useLayoutEffect, useState } from "react";
import type { BotRow } from "../bots-model";
import type { PastSession, RosterHost } from "../../src/shared/sessions";
import type { UserTodoList } from "../../src/user-todos-shared";
import { ScrollArea } from "@/components/ui/scroll-area";
import { isModulePage } from "../modules";
import { COLUMN_DEFAULT, COLUMN_MAX, COLUMN_MIN, type ListPage } from "../page-list";
import { useStoredState } from "../stored-state";
import type { TodoListView } from "../routing";
import type { SectionTarget } from "../section";
import { TAB_ROWS } from "../sidebar-tabs";
import { BotsNav } from "./bots/bots-nav";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ModuleNavView } from "./module-views";
import { SettingsNav } from "./settings/settings-nav";
import { TodoCategories } from "./todo/categories";
import { Separator, useDragSeparator } from "./drag-separator";

const COLUMN_STEP = 16;

interface PageListProps {
	page: ListPage;
	/** Every session, including those in directories the sidebar hides, so a todo's linked session resolves. */
	todoSessions: { hosts: RosterHost[]; past: PastSession[] };
	botList: BotRow[] | null;
	userTodos: UserTodoList | null;
	todoView: TodoListView;
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
}

export function PageList({ page, todoSessions, botList, userTodos, todoView, sectionTarget, onSectionTarget }: PageListProps) {
	const { changeTodo } = useDashboardActions();
	const { connected } = useDashboardStatus();
	if (isModulePage(page)) return <ModuleNavView page={page} section={sectionTarget} onSection={onSectionTarget} />;
	switch (page.kind) {
		case "bots":
			return <BotsNav rows={botList} openId={page.target === null ? (page.adding ? null : undefined) : page.target} />;
		case "todo":
			return <TodoCategories list={userTodos} view={todoView} disabled={!connected} onChange={changeTodo} sessions={todoSessions} />;
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
