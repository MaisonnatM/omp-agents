import { ListX, Plus, Trash2 } from "lucide-react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { isClosed, type TodoStatus, type UserTodo, type UserTodoChange, type UserTodoLeaf, type UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DONE_KEPT_HOURS } from "../../../src/user-todos";
import { localDay } from "../../days";
import { hashForTodo, type TodoListView } from "../../routing";
import { byStatus, LIST_KINDS, lastOf, leftIn, matches, placeIn, type Section, TODO_STATUS, type TodoEntry, titleOf, todosOf } from "../../todo-views";
import { useTodoDrag } from "../../use-todo-drag";
import { type OpenPicker, type TodoField, useTodoKeys } from "../../use-todo-keys";
import { FoldButton, useFolds } from "../fold";
import { PageFrame } from "../list-page";
import { TodoDetail } from "./detail";
import { useTodoEditing } from "./editing";
import { StatusIcon } from "./fields";
import type { KnownSessions } from "./links";
import { ArchivedRow, DraftRow, TodoRow } from "./row";
import { TodoSearch } from "./search";
import { TodoSplit } from "./split";

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	view: TodoListView;
	/** The todo the route opens beside the list; one the list does not hold opens nothing. */
	openId: string | null;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
}

/** The status groups you folded or unfolded, by status; Done and Canceled start folded. */
const FOLDS_KEY = "omp-agents.todo-status-folds";
const foldedByDefault = (status: string): boolean => status === "done" || status === "canceled";

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

function LoadedTodoPage({ list, view, openId, disabled, onChange, hosts, past, newSessionCwd, linearConnected }: TodoPageProps & { list: UserTodoList }) {
	const openTodo = (id: string | null): void => {
		location.hash = hashForTodo(view, id);
	};
	const [query, setQuery] = useState("");
	const [picker, setPicker] = useState<OpenPicker | null>(null);
	const listRef = useRef<HTMLElement>(null);
	const day = localDay();
	const kind = LIST_KINDS[view.kind];
	const frozen = disabled || kind.readOnly;
	const canAdd = !disabled && kind.add !== null;
	const sessions: KnownSessions = { hosts, past };
	const listed = todosOf(list, view, day, sessions);
	const section: Section = { categoryId: view.kind === "category" ? view.id : null, todos: listed.filter(todo => matches(todo, query)) };
	// Looked up before the search filters the list, so typing a search keeps the open todo on screen.
	const open = openId === null ? null : (placeIn([listed], openId)?.entry ?? null);
	const editing = useTodoEditing({ list, kind, day, frozen, onChange, onRemoved: id => openId === id && openTodo(null), newSessionCwd });
	const drag = useTodoDrag(kind.canMove && !frozen, onChange);
	const folds = useFolds(FOLDS_KEY, foldedByDefault);

	const title = titleOf(list, view);
	const left = leftIn(list, view, day, sessions);
	const anyClosed = section.todos.some(todo => todo.doneAt !== null || todo.children.some(child => child.doneAt !== null));
	const empty = section.todos.length === 0 ? (query ? `No todo matches “${query}”.` : kind.empty) : null;
	const groups = (kind.readOnly ? [] : byStatus(section.todos))
		.filter(group => group.todos.length > 0 || (group.status === "todo" && canAdd))
		// A search shows every match, closed ones too.
		.map(group => ({ ...group, open: query !== "" || !folds.isFolded(group.status) }));
	const shown = kind.readOnly ? section.todos : groups.flatMap(group => (group.open ? group.todos : []));
	const order = shown.flatMap(todo => [todo.id, ...(kind.readOnly ? [] : todo.children.map(child => child.id))]);
	const at = open ? order.indexOf(open.todo.id) : -1;
	const startDraft = (status: TodoStatus): void => {
		folds.unfold([status]);
		editing.startDraft({ parentId: null, afterId: lastOf(section.todos, status), categoryId: section.categoryId, status });
	};
	const openStep = useTodoKeys({
		listRef,
		groups: kind.readOnly ? [section.todos] : groups.map(group => group.todos),
		editingId: editing.editingId,
		canMove: kind.canMove,
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
			category={entry.parent === null && view.kind !== "category" ? list.categories.find(({ id }) => id === entry.todo.categoryId) : undefined}
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
								leadingIcon={Trash2}
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
							<Button variant="ghost" size="compact" leadingIcon={ListX} onClick={() => onChange({ op: "clear-done", categoryId: view.kind === "category" ? view.id : null })}>
								Clear done
							</Button>
						</Tooltip>
					)}
				</>
			}
		>
			<TodoSplit
				list={
					<section ref={listRef} aria-label={title} className="mx-auto w-full max-w-3xl space-y-2 px-3 py-2">
						{kind.readOnly ? (
							<ul aria-label="Archived todos" className="flex flex-col gap-0.5">
								{section.todos.map(todo => (
									<ArchivedRow key={todo.id} todo={todo} disabled={disabled} open={todo.id === openId} onOpen={openTodo} onChange={onChange} />
								))}
							</ul>
						) : (
							groups.map(({ status, todos, open: groupOpen }) => {
								const { label } = TODO_STATUS[status];
								const id = `todo-group-${status}`;
								return (
									<section key={status} aria-labelledby={`${id}-heading`}>
										<h3 id={`${id}-heading`} className="sticky top-0 z-10 flex h-10 items-center gap-2 rounded-md bg-muted px-3 text-sm font-medium">
											<FoldButton open={groupOpen} onToggle={() => folds.toggle(status)} controls={`${id}-list`} className="items-center gap-2.5">
												<StatusIcon status={status} />
												{label}
												<span className="tabular-nums text-muted-foreground">{todos.length}</span>
											</FoldButton>
											{isClosed(status) && <span className="ml-auto text-xs font-normal text-muted-foreground">Archived after {DONE_KEPT_HOURS} hours</span>}
											{canAdd && (
												<Tooltip content={`Add a todo to ${label}`}>
													<Button variant="ghost" size="icon-compact" aria-label={`Add a todo to ${label}`} className={isClosed(status) ? undefined : "ml-auto"} onClick={() => startDraft(status)}>
														<Plus />
													</Button>
												</Tooltip>
											)}
										</h3>
										{groupOpen && (
											// A row scrolled into view clears the sticky h-10 heading above it.
											<ul id={`${id}-list`} aria-label={`${label} todos of ${title}`} className="flex flex-col gap-0.5 py-1 *:scroll-mt-12">
												{todos.map(todo => rowsOf(todo, todos))}
												{draftAt(null, null, status)}
												{status === "todo" && canAdd && kind.add && (
													<li>
														<Tooltip content={kind.add.dueToday ? "Add a todo due today" : "Add a todo at the end of Todo"}>
															<button
																type="button"
																onClick={() => startDraft("todo")}
																className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
															>
																<Plus />
																{kind.add.label}
															</button>
														</Tooltip>
													</li>
												)}
											</ul>
										)}
									</section>
								);
							})
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
							linearConnected={linearConnected}
						/>
					)
				}
			/>
		</PageFrame>
	);
}
