/**
 * The bar above the Todo page's list: **Filter**, a submenu per field it filters by, and **Display**, its grouping;
 * under them a chip per filter that leaves something out. The sidebar's lists are its views, so it has no tabs.
 */
import { IconCalendar4, IconCalendarClock, IconChainLink1, IconUser } from "central-icons";
import type { UserTodo } from "../../../src/user-todos-shared";
import { NEXT_DAY_RANGE_LABELS } from "../../list-filter";
import {
	ASSIGNEE_OPTIONS,
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
import { DisplayButton, dayField, type FilterField, GroupingSubmenu, ListFilterBar, setField } from "../list-filter-bar";
import { PRIORITY_ICON } from "./fields";

/** Each field of **Filter**, in menu order; **Link** offers the kinds `todos` carry. */
function filterFields(todos: readonly UserTodo[], filter: TodoFilter, onFilter: (filter: TodoFilter) => void): FilterField[] {
	const set = (change: Partial<TodoFilter>): void => onFilter({ ...filter, ...change });
	return [
		setField({ id: "priority", label: "Priority", icon: PRIORITY_ICON[2][0], control: "todo.filter.priority", noun: "priorities", options: PRIORITY_OPTIONS, checked: filter.priorities, onChecked: priorities => set({ priorities }) }),
		setField({ id: "assignee", label: "Assignee", icon: IconUser, control: "todo.filter.assignee", noun: "assignees", options: ASSIGNEE_OPTIONS, checked: filter.assignees, onChecked: assignees => set({ assignees }) }),
		setField({ id: "link", label: "Link", icon: IconChainLink1, control: "todo.filter.link", noun: "links", options: linkOptions(todos, filter.links), checked: filter.links, onChecked: links => set({ links }) }),
		// Overdue todos count as due within any range.
		dayField({ id: "due", label: "Due", icon: IconCalendarClock, control: "todo.filter.due", verb: "is", labels: NEXT_DAY_RANGE_LABELS, value: filter.due, onValue: due => set({ due }) }),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "todo.filter.created", value: filter.created, onValue: created => set({ created }) }),
	];
}

interface TodoViewBarProps {
	/** The list's todos before **Filter** narrows it. */
	todos: readonly UserTodo[];
	filter: TodoFilter;
	onFilter: (filter: TodoFilter) => void;
	/** `null` for Archive, which has no grouping and so no **Display**. */
	display: TodoDisplay | null;
	onDisplay: (display: TodoDisplay) => void;
}

/** **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out. */
export function TodoViewBar({ todos, filter, onFilter, display, onDisplay }: TodoViewBarProps) {
	return (
		<ListFilterBar
			fields={filterFields(todos, filter, onFilter)}
			filtering={filters(filter)}
			controls={{ filter: "todo.filter", clear: "todo.filter.clear" }}
			onClearAll={() => onFilter(NO_FILTER)}
			display={
				display !== null && (
					<DisplayButton label="Display" control="todo.display" active={display.grouping !== DEFAULT_DISPLAY.grouping}>
						<GroupingSubmenu groupings={GROUPINGS} labels={GROUPING_LABELS} value={display.grouping} control="todo.display.grouping" onValue={grouping => onDisplay({ ...display, grouping })} />
					</DisplayButton>
				)
			}
		/>
	);
}
