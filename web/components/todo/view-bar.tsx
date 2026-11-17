/**
 * The bar above the Todo page's list: a tab per list; **Filter**, a submenu per field it filters by; **Display**, its
 * grouping and the categories, which you add, rename, and delete there; and under them a chip per filter that leaves
 * something out.
 */
import { IconCalendar4, IconCalendarClock, IconChainLink1, IconPencil, IconPlusSmall, IconTag, IconTrashCan, IconUser } from "central-icons";
import { useId, useRef, useState } from "react";
import type { UserTodo, UserTodoCategory, UserTodoChange } from "../../../src/user-todos-shared";
import { badgeColors } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Popover, PopoverAnchor, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
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
import { categoryColor, LIST_KINDS } from "../../todo-views";
import { DisplayButton, dayField, type FilterField, GroupingSubmenu, ListFilterBar, setField, ViewTabs } from "../list-filter-bar";
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

interface NameInputProps {
	initial: string;
	label: string;
	/** Enter, or focus leaving, with `name` trimmed; an empty name saves nothing. */
	onDone: (name: string) => void;
}

/** A category's name being typed; Esc leaves it as it was. */
function NameInput({ initial, label, onDone }: NameInputProps) {
	const [name, setName] = useState(initial);
	const done = useRef(false);
	const finish = (value: string): void => {
		if (done.current) return;
		done.current = true;
		onDone(value.trim());
	};
	return (
		<input
			autoFocus
			aria-label={label}
			value={name}
			onChange={event => setName(event.target.value)}
			onKeyDown={event => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Enter") finish(name);
				else if (event.key === "Escape") finish("");
			}}
			onBlur={() => finish(name)}
			className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm outline-none ring-1 ring-ring/40"
		/>
	);
}

/** What the categories panel types into: a category's new name, or the name of one not added yet. */
type Naming = { kind: "none" } | { kind: "rename"; id: string } | { kind: "add" };

interface CategoriesProps {
	categories: readonly UserTodoCategory[];
	filter: TodoFilter;
	onFilter: (filter: TodoFilter) => void;
	/** Changes would not reach the server. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/**
 * **Display**: the grouping, unless `display` is `null`, and **Categories…**, a panel that lists each category with
 * its color, renames it, deletes it while keeping its todos, and adds one, which **Filter** then keeps alone.
 */
function DisplayMenu({ display, onDisplay, categories, filter, onFilter, disabled, onChange }: CategoriesProps & { display: TodoDisplay | null; onDisplay: (display: TodoDisplay) => void }) {
	const [panel, setPanel] = useState(false);
	const [menu, setMenu] = useState(false);
	const [naming, setNaming] = useState<Naming>({ kind: "none" });
	const button = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	return (
		<Popover
			open={panel}
			onOpenChange={open => {
				setPanel(open);
				if (!open) setNaming({ kind: "none" });
			}}
		>
			<PopoverAnchor asChild>
				<span className="inline-flex">
					<DisplayButton
						label="Display"
						control="todo.display"
						active={panel || (display !== null && display.grouping !== DEFAULT_DISPLAY.grouping)}
						open={menu}
						onOpenChange={setMenu}
						tooltipHidden={panel}
						buttonRef={button}
					>
						{display !== null && (
							<>
								<GroupingSubmenu groupings={GROUPINGS} labels={GROUPING_LABELS} value={display.grouping} control="todo.display.grouping" onValue={grouping => onDisplay({ ...display, grouping })} />
								<MenuSeparator />
							</>
						)}
						<MenuItem {...activityControl("todo.categories")} onClick={() => setPanel(true)}>
							Categories…
							{categories.length > 0 && <span className="ml-auto pl-4 text-xs text-muted-foreground">{categories.length}</span>}
						</MenuItem>
					</DisplayButton>
				</span>
			</PopoverAnchor>
			<PopoverContent
				align="end"
				collisionPadding={8}
				aria-labelledby={titleId}
				// With no trigger of its own, the popover hands focus back to **Display** as it closes.
				onCloseAutoFocus={event => {
					event.preventDefault();
					button.current?.focus();
				}}
				// Esc while naming a category leaves the name as it was, and the panel open.
				onEscapeKeyDown={event => {
					if (naming.kind !== "none") event.preventDefault();
				}}
				className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto p-3"
			>
				<PopoverHeader>
					<PopoverTitle id={titleId} className="text-sm">
						Categories
					</PopoverTitle>
					<PopoverDescription className="text-xs">Filter › Category shows one category's todos. Deleting a category keeps its todos, in no category.</PopoverDescription>
				</PopoverHeader>
				{categories.length > 0 && (
					<ul aria-label="Todo categories" className="space-y-1 text-sm">
						{categories.map(({ id, name }) => (
							<li key={id} className="flex h-7 items-center gap-2">
								<span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: badgeColors[categoryColor(id)] }} />
								{naming.kind === "rename" && naming.id === id ? (
									<NameInput
										initial={name}
										label={`Rename ${name}`}
										onDone={next => {
											if (next && next !== name) onChange({ op: "rename-category", id, name: next });
											setNaming({ kind: "none" });
										}}
									/>
								) : (
									<span title={name} className="min-w-0 flex-1 truncate">
										{name}
									</span>
								)}
								<Tooltip content="Rename">
									<Button {...activityControl("todo.category.rename")} variant="ghost" size="icon-compact" aria-label={`Rename ${name}`} disabled={disabled} onClick={() => setNaming({ kind: "rename", id })}>
										<IconPencil />
									</Button>
								</Tooltip>
								<Tooltip content="Delete, keeping its todos">
									<Button
										{...activityControl("todo.category.delete")}
										variant="ghost"
										size="icon-compact"
										aria-label={`Delete ${name}, keeping its todos`}
										disabled={disabled}
										onClick={() => {
											onChange({ op: "remove-category", id });
											if (filter.categories.has(id)) onFilter({ ...filter, categories: new Set([...filter.categories].filter(key => key !== id)) });
										}}
									>
										<IconTrashCan />
									</Button>
								</Tooltip>
							</li>
						))}
					</ul>
				)}
				{naming.kind === "add" ? (
					<div className="flex h-7 items-center">
						<NameInput
							initial=""
							label="New category"
							onDone={name => {
								setNaming({ kind: "none" });
								if (!name) return;
								const id = crypto.randomUUID();
								onChange({ op: "add-category", id, name });
								onFilter({ ...filter, categories: new Set([id]) });
							}}
						/>
					</div>
				) : (
					<Button {...activityControl("todo.category.add")} variant="outline" size="compact" leadingIcon={IconPlusSmall} disabled={disabled} onClick={() => setNaming({ kind: "add" })}>
						New category
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}

interface TodoViewBarProps extends CategoriesProps {
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
