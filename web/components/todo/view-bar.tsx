/**
 * The bar above the Todo page's list: a tab per list; **Filter**, a submenu per field it filters by; **Display**, its
 * grouping and the categories, which you add, rename, and delete there; and under them a chip per filter that leaves
 * something out.
 */
import { IconCalendar4, IconCalendarClock, IconChainLink1, IconTag, IconUser } from "central-icons";
import type { UserTodo, UserTodoCategory } from "../../../src/user-todos-shared";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { activityControl } from "../../activity";
import { NEXT_DAY_RANGE_LABELS } from "../../list-filter";
import { hashForTodo, TODO_VIEWS, type TodoListView } from "../../routing";
import {
	ASSIGNEE_OPTIONS,
	categoryOptions,
	DEFAULT_DISPLAY,
	filters,
	GROUPING_LABELS,
	GROUPINGS,
	linkOptions,
	NO_FILTER,
	PRIORITY_OPTIONS,
	type TodoDisplay,
	type TodoFilter,
} from "../../todo-filter";
import { LIST_KINDS } from "../../todo-views";
import { dayField, DisplayWithPanel, type FilterField, GroupingSubmenu, ListFilterBar, setField, ViewTabs } from "../list-filter-bar";
import { CategoriesPanel, type CategoriesPanelProps } from "./categories-panel";
import { PRIORITY_ICON } from "./fields";

/** Each field of **Filter**, in menu order; **Category** offers the list's categories, and **Link** the kinds `todos` carry. */
function filterFields(todos: readonly UserTodo[], categories: readonly UserTodoCategory[], filter: TodoFilter, onFilter: (filter: TodoFilter) => void): FilterField[] {
	const set = (change: Partial<TodoFilter>): void => onFilter({ ...filter, ...change });
	return [
		setField({ id: "category", label: "Category", icon: IconTag, control: "todo.filter.category", noun: "categories", options: categoryOptions(todos, categories), checked: filter.categories, onChecked: categories => set({ categories }) }),
		setField({ id: "priority", label: "Priority", icon: PRIORITY_ICON[2][0], control: "todo.filter.priority", noun: "priorities", options: PRIORITY_OPTIONS, checked: filter.priorities, onChecked: priorities => set({ priorities }) }),
		setField({ id: "assignee", label: "Assignee", icon: IconUser, control: "todo.filter.assignee", noun: "assignees", options: ASSIGNEE_OPTIONS, checked: filter.assignees, onChecked: assignees => set({ assignees }) }),
		setField({ id: "link", label: "Link", icon: IconChainLink1, control: "todo.filter.link", noun: "links", options: linkOptions(todos, filter.links), checked: filter.links, onChecked: links => set({ links }) }),
		// Overdue todos count as due within any range.
		dayField({ id: "due", label: "Due", icon: IconCalendarClock, control: "todo.filter.due", verb: "is", labels: NEXT_DAY_RANGE_LABELS, value: filter.due, onValue: due => set({ due }) }),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "todo.filter.created", value: filter.created, onValue: created => set({ created }) }),
	];
}

/** **Display**: the grouping, unless `display` is `null`, and **Categories…**, which opens {@link CategoriesPanel} under the same button. */
function DisplayMenu({ display, onDisplay, ...panel }: CategoriesPanelProps & { display: TodoDisplay | null; onDisplay: (display: TodoDisplay) => void }) {
	return (
		<DisplayWithPanel
			label="Display"
			control="todo.display"
			active={display !== null && display.grouping !== DEFAULT_DISPLAY.grouping}
			menu={openPanel => (
				<>
					{display !== null && (
						<>
							<GroupingSubmenu groupings={GROUPINGS} labels={GROUPING_LABELS} value={display.grouping} control="todo.display.grouping" onValue={grouping => onDisplay({ ...display, grouping })} />
							<MenuSeparator />
						</>
					)}
					<MenuItem {...activityControl("todo.categories")} onClick={openPanel}>
						Categories…
						{panel.categories.length > 0 && <span className="ml-auto pl-4 text-xs text-muted-foreground">{panel.categories.length}</span>}
					</MenuItem>
				</>
			)}
			title="Categories"
			description="Filter › Category shows the categories you check. Deleting one keeps its todos, in no category."
			panelClassName="w-80"
			// Esc in a category's name leaves the name as it was, and the panel open.
			escapeKeepsOpen={target => target instanceof HTMLInputElement}
		>
			<CategoriesPanel {...panel} />
		</DisplayWithPanel>
	);
}

interface TodoViewBarProps extends CategoriesPanelProps {
	/** The list the page shows, its tab picked. */
	view: TodoListView;
	/** The list's todos before **Filter** narrows it. */
	todos: readonly UserTodo[];
	/** `null` for Archive, which has no grouping. */
	display: TodoDisplay | null;
	onDisplay: (display: TodoDisplay) => void;
}

/** The tabs, **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out. */
export function TodoViewBar({ view, todos, categories, filter, onFilter, display, onDisplay, disabled, onChange }: TodoViewBarProps) {
	return (
		<ListFilterBar
			tabs={<ViewTabs views={TODO_VIEWS} labelOf={list => LIST_KINDS[list].tab} picked={view} control="todo.view" onPick={list => (location.hash = hashForTodo(list))} />}
			fields={filterFields(todos, categories, filter, onFilter)}
			filtering={filters(filter)}
			controls={{ filter: "todo.filter", clear: "todo.filter.clear" }}
			onClearAll={() => onFilter(NO_FILTER)}
			display={<DisplayMenu display={display} onDisplay={onDisplay} categories={categories} filter={filter} onFilter={onFilter} disabled={disabled} onChange={onChange} />}
		/>
	);
}
