import { IconPlusSmall, IconSquareX, IconTodos, IconTrashCan } from "central-icons";
import { Fragment, type ReactNode, useRef, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { isClosed, type TodoStatus, type UserTodo, type UserTodoChange, type UserTodoLeaf, type UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DONE_KEPT_HOURS } from "../../../src/user-todos";
import { localDay } from "../../../src/shared/days";
import { ALL_WORKSPACES, folderName } from "../../labels";
import { hashForTodo, type TodoListView } from "../../routing";
import { shortcutKeys } from "../../shortcuts";
import { sectionId } from "../../section";
import { groupFoldKey, groupTodos, keepsTodo, NO_FILTER, filters, soleCategory, type TodoGroup, withLiveCategories } from "../../todo-filter";
import { useTodoDisplay, useTodoFilter } from "../../todo-state";
import { inScope, LIST_KINDS, lastOf, placeIn, PRIORITY_LABEL, type Section, TODO_STATUS, type TodoEntry, todoMatcher, todosOf, leftIn } from "../../todo-views";
import { useOpenLatest } from "../../use-open-latest";
import { useTodoDrag } from "../../use-todo-drag";
import { type OpenPicker, useTodoKeys } from "../../use-todo-keys";
import { useDashboardStatus } from "../dashboard-context";
import { FoldButton, useFolds } from "../fold";
import { NothingMatches } from "../list-filter-bar";
import { PageFrame } from "../list-page";
import { ListSplit } from "../list-split";
import { TodoDetail } from "./detail";
import { useTodoEditing } from "./editing";
import { ASSIGNEE, AssigneeIcon, PriorityIcon, StatusIcon } from "./fields";
import type { KnownSessions } from "./links";
import { ArchivedRow, DraftRow, TodoRow } from "./row";
import { TodoSearch } from "./search";
import { TodoViewBar } from "./view-bar";

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	view: TodoListView;
	/** The todo the route opens beside the list; one the list does not hold opens nothing. */
	openId: string | null;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	/** Settles once the server has handled the change, which the notes editor waits on before it shows what arrives. */
	onChange: (change: UserTodoChange) => Promise<void>;
	hosts: RosterHost[];
	past: PastSession[];
	/** Where **Start session** opens the new-session draft of a todo with no Workspace. */
	newSessionCwd: string;
	/** The Workspaces a todo's Workspace picker offers. */
	workspaces: Workspace[];
}

/** The groups you folded or unfolded, by `groupFoldKey`; Done and Canceled start folded. */
const FOLDS_KEY = "omp-agents.todo-status-folds";
const foldedByDefault = (key: string): boolean => key === "done" || key === "canceled";

/** A group of the list as the page draws it. */
interface TodoGroupView {
	/** Its fold key, which its element ids derive from. */
	key: string;
	/** Its icon and name; `null` for the one group of no grouping, which shows no heading. */
	heading: { icon: ReactNode; label: string } | null;
	todos: UserTodo[];
	/** By status, the status of the group and of a todo added to it; `null` under other groupings. */
	status: TodoStatus | null;
}

function groupView(group: TodoGroup<UserTodo>): TodoGroupView {
	const view = { key: group.foldKey, todos: group.todos, status: null };
	switch (group.by) {
		case "status":
			return { ...view, heading: { icon: <StatusIcon status={group.key} />, label: TODO_STATUS[group.key].label }, status: group.key };
		case "priority":
			return { ...view, heading: { icon: <PriorityIcon priority={group.key} />, label: PRIORITY_LABEL[group.key] } };
		case "assignee":
			return { ...view, heading: { icon: <AssigneeIcon assignee={group.key} />, label: ASSIGNEE[group.key ?? "none"].label } };
		case "none":
			return { ...view, heading: null };
	}
}

interface TodoGroupSectionProps {
	group: TodoGroupView;
	open: boolean;
	/** The list's name, which names the rows' list. */
	listTitle: string;
	onToggle: () => void;
	/** Starts a todo in a status's group; `null` where the list takes none. */
	onAdd: ((status: TodoStatus) => void) | null;
	/** The group's rows, then what follows them: the new todo typed at its end, and the add row. */
	children: ReactNode;
}

/** A group's heading, which folds it, and its rows; the one group of no grouping is its rows alone. */
function TodoGroupSection({ group: { key, heading, todos, status }, open, listTitle, onToggle, onAdd, children }: TodoGroupSectionProps) {
	if (heading === null) {
		return (
			<ul aria-label={`Todos of ${listTitle}`} className="flex flex-col gap-0.5 py-1">
				{children}
			</ul>
		);
	}
	const id = sectionId("todo", key);
	const { icon, label } = heading;
	return (
		<section aria-labelledby={`${id}-heading`}>
			<h3 id={`${id}-heading`} className="sticky top-0 z-10 flex h-10 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium">
				<FoldButton open={open} onToggle={onToggle} controls={`${id}-list`} className="items-center gap-2.5">
					{icon}
					{label}
					<span className="tabular-nums text-muted-foreground">{todos.length}</span>
				</FoldButton>
				{status !== null && isClosed(status) && <span className="ml-auto text-xs font-normal text-muted-foreground">Archived after {DONE_KEPT_HOURS} hours</span>}
				{status !== null && onAdd && (
					<Tooltip content={`Add a todo to ${label}`}>
						<Button variant="ghost" size="icon-compact" aria-label={`Add a todo to ${label}`} className={isClosed(status) ? undefined : "ml-auto"} onClick={() => onAdd(status)}>
							<IconPlusSmall />
						</Button>
					</Tooltip>
				)}
			</h3>
			{open && (
				// A row scrolled into view clears the sticky h-10 heading above it.
				<ul id={`${id}-list`} aria-label={`${label} todos of ${listTitle}`} className="flex flex-col gap-0.5 py-1 *:scroll-mt-12">
					{children}
				</ul>
			)}
		</section>
	);
}

/** Your own todos, each with todos of its own, two deep at most, beside the open one's notes. */
export function TodoPage({ list, ...props }: TodoPageProps) {
	if (list === null) {
		return (
			<PageFrame title="Todo" meta="Your own todo list">
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your todos…</p>
			</PageFrame>
		);
	}
	return <LoadedTodoPage list={list} {...props} />;
}

function LoadedTodoPage({ list, view, openId, disabled, onChange, hosts, past, newSessionCwd, workspaces }: TodoPageProps & { list: UserTodoList }) {
	// The sidebar's workspace narrows the list.
	const { scope } = useDashboardStatus();
	/** The Workspace a todo added here names, which its sessions start in: the sidebar's; `null` for none. */
	const workspace = scope.workspace;
	const openTodo = (id: string | null): void => {
		location.hash = hashForTodo(view, id);
	};
	const [query, setQuery] = useState("");
	const [picker, setPicker] = useState<OpenPicker | null>(null);
	const listRef = useRef<HTMLElement>(null);
	const day = localDay();
	const kind = LIST_KINDS[view];
	const frozen = disabled || kind.readOnly;
	const canAdd = !disabled && kind.add !== null;
	const sessions: KnownSessions = { hosts, past };
	const [stored, setFilter] = useTodoFilter();
	const [display, setDisplay] = useTodoDisplay();
	// A category deleted since, here or in another window, leaves nothing out; the next change stores the filter without it.
	const filter = withLiveCategories(stored, list.categories);
	const filtering = filters(filter);
	// Archive lists by when a todo was cleared, with no groups.
	const grouping = kind.readOnly ? null : display.grouping;
	const byStatus = grouping === "status";
	const spanning = todosOf(list, view, day, sessions);
	const listed = inScope(spanning, scope);
	const now = Date.now();
	const kept = filtering ? listed.filter(todo => keepsTodo(todo, filter, day, now)) : listed;
	const sole = soleCategory(filter);
	const section: Section = { categoryId: sole, todos: kept.filter(todoMatcher(query)) };
	// Looked up before the search and the sidebar's scope narrow the list, so neither takes the open todo off screen.
	const open = openId === null ? null : (placeIn([spanning], openId)?.entry ?? null);
	const editing = useTodoEditing({ list, kind, day, frozen, categories: filter.categories, onChange, onRemoved: id => openId === id && openTodo(null), newSessionCwd, workspace });
	// Todos move only among those of their status, so only the grouping by status lets you drag them.
	const canMove = kind.canMove && byStatus;
	const drag = useTodoDrag(canMove && !frozen, onChange);
	const folds = useFolds(FOLDS_KEY, foldedByDefault);

	const title = kind.title;
	const left = leftIn(list, view, day, sessions, scope);
	const anyClosed = section.todos.some(todo => todo.doneAt !== null || todo.children.some(child => child.doneAt !== null));
	const search = query.trim();
	const unmatched = section.todos.length === 0 && listed.length > 0 && (search !== "" || filtering);
	const emptyText = (): string | null => {
		if (scope.workspace !== null) return `No todo here names ${folderName(scope.workspace) ?? scope.workspace}, the workspace the sidebar shows. Choose ${ALL_WORKSPACES} in the sidebar to see every todo.`;
		return kind.empty;
	};
	const empty = section.todos.length > 0 || unmatched ? null : emptyText();
	const groups = (grouping === null ? [] : groupTodos(grouping, section.todos))
		.map(groupView)
		.filter(group => group.todos.length > 0 || (group.status === "todo" && canAdd))
		// A search shows every match, closed ones too.
		.map(group => ({ group, open: query !== "" || group.heading === null || !folds.isFolded(group.key) }));
	const shown = kind.readOnly ? section.todos : groups.flatMap(({ group, open }) => (open ? group.todos : []));
	useOpenLatest(id => hashForTodo(view, id), openId, shown[0]?.id ?? null, true);
	const order = shown.flatMap(todo => [todo.id, ...(kind.readOnly ? [] : todo.children.map(child => child.id))]);
	const at = open ? order.indexOf(open.todo.id) : -1;
	/**
	 * Where a new top-level todo of `status` goes: by status, last of its status's group, which unfolds to show it;
	 * under other groupings, last of the list, where the list's end shows it.
	 */
	const draftPlace = (status: TodoStatus): { afterId: string | null; unfold: string[] } =>
		byStatus ? { afterId: lastOf(section.todos, status), unfold: [groupFoldKey("status", status)] } : { afterId: null, unfold: [] };
	const startDraft = (status: TodoStatus): void => {
		const { afterId, unfold } = draftPlace(status);
		folds.unfold(unfold);
		editing.startDraft({ parentId: null, afterId, categoryId: section.categoryId, status });
	};
	const openStep = useTodoKeys({
		listRef,
		groups: kind.readOnly ? [section.todos] : groups.map(({ group }) => group.todos),
		editingId: editing.editingId,
		canMove,
		disabled: frozen,
		onChange,
		onToggle: todo => onChange({ op: "set-status", id: todo.id, status: isClosed(todo.status) ? "todo" : "done", at: new Date().toISOString() }),
		onPicker: setPicker,
		onNew: canAdd ? () => startDraft("todo") : null,
		openId: open && open.todo.id,
		openOrder: order,
		onOpen: openTodo,
	});

	/** The new todo typed at this place; a top-level one only in the group of its status. */
	const draftAt = (parentId: string | null, afterId: string | null, status?: TodoStatus): ReactNode => {
		const draft = editing.draftAt(section, parentId, afterId);
		// A new key per place and per added todo, so the input starts with the draft's text wherever it moves.
		return draft && (status === undefined || draft.status === status) && <DraftRow key={`draft:${parentId}:${afterId}:${draft.addedId}`} draft={draft} section={section} editing={editing} />;
	};
	const row = (entry: TodoEntry, siblings: readonly UserTodoLeaf[]) => (
		<TodoRow
			section={section}
			entry={entry}
			siblings={siblings}
			category={entry.parent === null && sole === null ? list.categories.find(({ id }) => id === entry.todo.categoryId) : undefined}
			workspace={entry.parent === null && workspace === null ? (entry.todo.workspace ?? undefined) : undefined}
			day={day}
			sessions={sessions}
			disabled={disabled}
			open={entry.todo.id === openId}
			picker={picker?.inRow && picker.id === entry.todo.id ? picker.field : null}
			onPicker={field => setPicker(field && { id: entry.todo.id, field, inRow: true })}
			drag={drag}
			editing={editing}
			onOpen={openTodo}
			onChange={onChange}
		/>
	);
	const rowsOf = (todo: UserTodo, siblings: readonly UserTodo[]): ReactNode => {
		const closedAt = todo.children.findIndex(child => child.doneAt !== null);
		const split = closedAt < 0 ? todo.children.length : closedAt;
		const childRow = (child: UserTodoLeaf): ReactNode => (
			<Fragment key={child.id}>
				{row({ todo: child, parent: todo }, todo.children)}
				{draftAt(todo.id, child.id)}
			</Fragment>
		);
		return (
			<Fragment key={todo.id}>
				{row({ todo, parent: null }, siblings)}
				{todo.children.slice(0, split).map(childRow)}
				{draftAt(todo.id, null)}
				{todo.children.slice(split).map(childRow)}
				{draftAt(null, todo.id, todo.status)}
			</Fragment>
		);
	};
	const addRow = canAdd && kind.add && (
		<li>
			<Tooltip content={kind.add.dueToday ? "Add a todo due today" : byStatus ? "Add a todo at the end of Todo" : "Add a todo at the end of the list"}>
				<button
					type="button"
					onClick={() => startDraft("todo")}
					className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
				>
					<IconPlusSmall />
					{kind.add.label}
				</button>
			</Tooltip>
		</li>
	);

	return (
		<PageFrame
			title={title}
			meta={kind.readOnly ? `${left} archived` : left === 0 ? "Nothing to do" : `${left} open`}
			actions={
				<>
					<TodoSearch query={query} onQuery={setQuery} />
					{kind.readOnly && list.archive.length > 0 && !disabled && (
						<Tooltip content="Delete every archived todo">
							<Button
								variant="ghost"
								size="compact"
								leadingIcon={IconTrashCan}
								onClick={() => {
									if (window.confirm(`Delete the ${list.archive.length} archived todos for good?`)) onChange({ op: "empty-archive" });
								}}
							>
								Empty
							</Button>
						</Tooltip>
					)}
					{!kind.readOnly && anyClosed && !disabled && (
						<Tooltip content="Move Done and Canceled todos to Archive">
							<Button variant="ghost" size="compact" leadingIcon={IconSquareX} onClick={() => onChange({ op: "clear-done", categoryId: sole })}>
								Clear done
							</Button>
						</Tooltip>
					)}
				</>
			}
		>
			<ListSplit
				widthKey="omp-agents.todo-list-width"
				defaultWidth={480}
				resizeLabel="Resize the todo list"
				detailLabel="Open todo"
				empty={{ icon: IconTodos, title: "No todo open", hint: `Click a todo, or focus one with ${shortcutKeys("todoNext")} and press Enter.` }}
				list={
					<section ref={listRef} tabIndex={-1} aria-label={title} className="outline-none focus-visible:ring-2 focus-visible:ring-ring mx-auto w-full max-w-3xl space-y-2 px-3 py-2">
						<TodoViewBar
							view={view}
							todos={listed}
							categories={list.categories}
							filter={filter}
							onFilter={setFilter}
							display={kind.readOnly ? null : display}
							onDisplay={setDisplay}
							disabled={disabled}
							onChange={onChange}
						/>
						{kind.readOnly ? (
							<ul aria-label="Archived todos" className="flex flex-col gap-0.5">
								{section.todos.map(todo => (
									<ArchivedRow key={todo.id} todo={todo} disabled={disabled} open={todo.id === openId} onOpen={openTodo} onChange={onChange} />
								))}
							</ul>
						) : (
							<>
								{groups.map(({ group, open: groupOpen }) => (
									<TodoGroupSection
										key={group.key}
										group={group}
										open={groupOpen}
										listTitle={title}
										onToggle={() => folds.toggle(group.key)}
										onAdd={canAdd ? startDraft : null}
									>
										{group.todos.map(todo => rowsOf(todo, group.todos))}
										{group.status !== null && draftAt(null, null, group.status)}
										{group.status === "todo" && addRow}
									</TodoGroupSection>
								))}
								{!byStatus && canAdd && (
									<ul aria-label={`New todos of ${title}`} className="flex flex-col gap-0.5">
										{draftAt(null, null)}
										{addRow}
									</ul>
								)}
							</>
						)}
						{unmatched && (
							<NothingMatches
								noneMatch="No todo matches"
								search={search}
								filtering={filtering}
								control="todo.filter.clear"
								onClearSearch={() => setQuery("")}
								onClearFilters={() => setFilter(NO_FILTER)}
								focusTarget={listRef}
							/>
						)}
						{empty && <p className="px-2 text-sm text-muted-foreground">{empty}</p>}
					</section>
				}
				detail={
					open && (
						<TodoDetail
							key={open.todo.id}
							list={list}
							open={open}
							readOnly={frozen}
							day={day}
							picker={picker && !picker.inRow && picker.id === open.todo.id ? picker.field : null}
							onPicker={field => setPicker(field && { id: open.todo.id, field, inRow: false })}
							onChange={onChange}
							onOpen={openTodo}
							onClose={() => openTodo(null)}
							onPrevious={at > 0 ? () => openStep(-1) : undefined}
							onNext={at >= 0 && at < order.length - 1 ? () => openStep(1) : undefined}
							sessions={sessions}
							newSessionCwd={newSessionCwd}
							workspaces={workspaces}
						/>
					)
				}
			/>
		</PageFrame>
	);
}
