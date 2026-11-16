/**
 * The bar above the Todo page's list: **Filter**, a submenu per field it filters by, and **Display**, its grouping;
 * under them a chip per filter that leaves something out. The sidebar's lists are its views, so it has no tabs.
 */
import { IconCalendar4, IconCalendarClock4, IconChainLink1, IconUser } from "central-icons";
import { useState } from "react";
import type { UserTodo } from "../../../src/user-todos-shared";
import { MenuRadioGroup, MenuRadioItem, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { activityControl } from "../../activity";
import { DAY_RANGE_LABELS, DAY_RANGES, type DayRange, withToggled } from "../../list-filter";
import { useStoredState } from "../../stored-state";
import {
	ASSIGNEE_OPTIONS,
	DEFAULT_DISPLAY,
	decodeDisplay,
	decodeFilter,
	encodeDisplay,
	encodeFilter,
	filters,
	GROUPING_LABELS,
	GROUPINGS,
	linkOptions,
	NO_FILTER,
	PRIORITY_OPTIONS,
	type TodoFilter,
	type TodoGrouping,
} from "../../todo-filter";
import { DisplayButton, dayField, type FieldBase, FilterChips, type FilterField, FilterMenu, setField } from "../list-filter-bar";
import { PRIORITY_ICON } from "../tickets/ticket-row";

/** What the list keeps, of what you picked under **Filter**. */
export const useTodoFilter = () => useStoredState("omp-agents.todo-filter", decodeFilter, encodeFilter);

/** How the list groups its todos. */
export const useTodoDisplay = () => useStoredState("omp-agents.todo-display", decodeDisplay, encodeDisplay);

/** **Due**: the todos due within the next {@link DayRange}, overdue ones too, with **Any time** first; its chip reads `Due within the next week`. */
function dueField({ id, label, icon, control, value, onValue }: FieldBase & { value: DayRange | null; onValue: (value: DayRange | null) => void }): FilterField {
	const next = (days: DayRange): string => DAY_RANGE_LABELS[days].replace(/^Last/, "Next");
	return {
		id,
		label,
		icon,
		active: value !== null,
		verb: "within the",
		value: value === null ? "Any time" : next(value).toLowerCase(),
		full: null,
		clear: () => onValue(null),
		items: (
			<MenuRadioGroup value={value === null ? "any" : String(value)} onValueChange={(picked: string) => onValue(DAY_RANGES.find(days => String(days) === picked) ?? null)}>
				<MenuRadioItem {...activityControl(control)} value="any" closeOnClick>
					Any time
				</MenuRadioItem>
				{DAY_RANGES.map(days => (
					<MenuRadioItem {...activityControl(control)} key={days} value={String(days)} closeOnClick>
						{next(days)}
					</MenuRadioItem>
				))}
			</MenuRadioGroup>
		),
	};
}

/** Each field of **Filter**, in menu order; **Link** offers the kinds `todos` carry. */
function filterFields(filter: TodoFilter, setFilter: (filter: TodoFilter) => void, todos: readonly UserTodo[]): FilterField[] {
	const set = (change: Partial<TodoFilter>): void => setFilter({ ...filter, ...change });
	return [
		setField({
			id: "priority",
			label: "Priority",
			icon: PRIORITY_ICON[2][0],
			control: "todo.filter.priority",
			noun: "priorities",
			options: PRIORITY_OPTIONS,
			checked: filter.priorities,
			active: filter.priorities.size > 0,
			onToggle: key => set({ priorities: withToggled(filter.priorities, key) }),
			clear: () => set({ priorities: new Set() }),
		}),
		setField({
			id: "assignee",
			label: "Assignee",
			icon: IconUser,
			control: "todo.filter.assignee",
			noun: "assignees",
			options: ASSIGNEE_OPTIONS,
			checked: filter.assignees,
			active: filter.assignees.size > 0,
			onToggle: key => set({ assignees: withToggled(filter.assignees, key) }),
			clear: () => set({ assignees: new Set() }),
		}),
		setField({
			id: "link",
			label: "Link",
			icon: IconChainLink1,
			control: "todo.filter.link",
			noun: "links",
			options: linkOptions(todos, filter.links),
			checked: filter.links,
			active: filter.links.size > 0,
			onToggle: key => set({ links: withToggled(filter.links, key) }),
			clear: () => set({ links: new Set() }),
		}),
		dueField({ id: "due", label: "Due", icon: IconCalendarClock4, control: "todo.filter.due", value: filter.due, onValue: due => set({ due }) }),
		dayField({ id: "created", label: "Created", icon: IconCalendar4, control: "todo.filter.created", value: filter.created, onValue: created => set({ created }) }),
	];
}

function DisplayMenu({ grouping, onGrouping }: { grouping: TodoGrouping; onGrouping: (grouping: TodoGrouping) => void }) {
	const [open, setOpen] = useState(false);
	return (
		<DisplayButton label="Display" control="todo.display" active={grouping !== DEFAULT_DISPLAY.grouping} open={open} onOpenChange={setOpen}>
			<MenuSubmenu>
				<MenuSubmenuTrigger value={GROUPING_LABELS[grouping]}>Grouping</MenuSubmenuTrigger>
				<MenuSubmenuContent className="w-48">
					<MenuRadioGroup value={grouping} onValueChange={(picked: TodoGrouping) => onGrouping(picked)}>
						{GROUPINGS.map(option => (
							<MenuRadioItem {...activityControl("todo.display.grouping")} key={option} value={option} closeOnClick>
								{GROUPING_LABELS[option]}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuSubmenuContent>
			</MenuSubmenu>
		</DisplayButton>
	);
}

/**
 * **Filter** and **Display** at the end of their row, and under them a chip per filter that leaves something out.
 * `todos` are the list's before **Filter** narrows it; `grouping` is left out for Archive, which has none.
 */
export function TodoViewBar({
	todos,
	filter,
	onFilter,
	grouping,
	onGrouping,
}: {
	todos: readonly UserTodo[];
	filter: TodoFilter;
	onFilter: (filter: TodoFilter) => void;
	grouping: TodoGrouping | null;
	onGrouping: (grouping: TodoGrouping) => void;
}) {
	const fields = filterFields(filter, onFilter, todos);
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<div className="ml-auto flex shrink-0 items-center gap-1.5">
					<FilterMenu fields={fields} active={filters(filter)} control="todo.filter" />
					{grouping !== null && <DisplayMenu grouping={grouping} onGrouping={onGrouping} />}
				</div>
			</div>
			<FilterChips fields={fields} clearControl="todo.filter.clear" onClearAll={() => onFilter(NO_FILTER)} />
		</div>
	);
}
