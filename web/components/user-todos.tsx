import { CalendarClock, Circle, CircleCheck, GripVertical, ListX, NotebookText, Plus, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { PastSession, RosterHost, UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../src/shared";
import { applyUserTodo } from "../../src/user-todos";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hashForTodo, type TodoListView } from "../routing";
import { DAY_FORMAT, LIST_KINDS, lastToDo, leftIn, matches, placeIn, restoreOf, type TodoEntry, titleOf, todosOf, today } from "../todo-views";
import { workStateOf } from "../todo-work-state";
import { useTodoDrag } from "../use-todo-drag";
import { useTodoKeys } from "../use-todo-keys";
import { PageFrame } from "./list-page";
import { TodoDetail } from "./todo-detail";
import { type KnownSessions, TodoLinkChip, TodoWorkPill } from "./todo-links";
import { TodoSearch } from "./todo-search";
import { useUndo } from "./todo-undo";

/** What the Todo page types into: a todo's title, or a todo not added yet, at its place in the list, with what it holds so far. */
type Editing =
	| { kind: "none" }
	| { kind: "edit"; id: string }
	| { kind: "draft"; parentId: string | null; afterId: string | null; categoryId: string | null; text: string };

type Draft = Extract<Editing, { kind: "draft" }>;

const NOT_EDITING: Editing = { kind: "none" };

/** The keys a todo's input acts on, beyond typing. */
type TodoKey = "enter" | "escape" | "indent" | "outdent" | "erase";

function todoKey(event: KeyboardEvent<HTMLInputElement>): TodoKey | null {
	if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
	switch (event.key) {
		case "Enter":
			return "enter";
		case "Escape":
			return "escape";
		case "Tab":
			return event.shiftKey ? "outdent" : "indent";
		case "Backspace":
			return event.currentTarget.value === "" ? "erase" : null;
		default:
			return null;
	}
}

interface TodoInputProps {
	initial: string;
	label: string;
	/** Acts on `key`; whether the input goes away, so its blur must not save again. */
	onKey: (key: TodoKey, text: string) => boolean;
	/** Focus left the input with `text` in it. */
	onLeave: (text: string) => void;
}

function TodoInput({ initial, label, onKey, onLeave }: TodoInputProps) {
	const [text, setText] = useState(initial);
	const settled = useRef(false);
	return (
		<input
			autoFocus
			aria-label={label}
			value={text}
			onChange={event => setText(event.target.value)}
			onKeyDown={event => {
				const key = todoKey(event);
				if (!key) return;
				event.preventDefault();
				settled.current = onKey(key, text);
			}}
			onBlur={() => {
				if (!settled.current) onLeave(text);
			}}
			className="-mx-1 min-w-0 flex-1 rounded-sm bg-transparent px-1 outline-none ring-1 ring-ring/40"
		/>
	);
}

/** The todos the page lists under one heading: those of one category, of none, or of a list that is not a category. */
interface Section {
	/** The category a todo added here joins. */
	categoryId: string | null;
	/** `null` for the only section, which the page's title already names. */
	title: string | null;
	todos: UserTodo[];
}

/** For every todo, the todos of no category first, then each category with todos, in its order; any other list is one section. */
function sectionsOf(list: UserTodoList, view: TodoListView, day: string, sessions: KnownSessions): Section[] {
	if (view.kind !== "all") return [{ categoryId: view.kind === "category" ? view.id : null, title: null, todos: todosOf(list, view, day, sessions) }];
	const inCategory = (categoryId: string | null) => list.todos.filter(todo => todo.categoryId === categoryId);
	const named = list.categories.map(({ id, name }) => ({ categoryId: id, title: name, todos: inCategory(id) })).filter(section => section.todos.length > 0);
	return [{ categoryId: null, title: named.length > 0 ? "No category" : null, todos: inCategory(null) }, ...named];
}

/** A due day as the list reads it, and whether it has passed. */
function dueLabel(due: string, day: string): { text: string; overdue: boolean } {
	const [y, m, d] = due.split("-").map(Number);
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (due === day) return { text: "Today", overdue: false };
	if (due === today(tomorrow)) return { text: "Tomorrow", overdue: false };
	const date = DAY_FORMAT.format(new Date(y!, m! - 1, d!));
	return { text: due < day ? `Overdue · ${date}` : date, overdue: due < day };
}

function DueChip({ due, day }: { due: string; day: string }) {
	const { text, overdue } = dueLabel(due, day);
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1 text-xs [&>svg]:size-3", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
			<CalendarClock aria-hidden />
			{text}
		</span>
	);
}

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	/** Any list but Done, which `ArchivePage` shows. */
	view: TodoListView;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
	/** The desktop shell's quick-capture shortcut asked for a new todo, which `onQuickTodo` reports started. */
	quickTodo: boolean;
	onQuickTodo: () => void;
}

/** Your own todos, each with todos of its own, two deep at most, and the open one's notes beside them. */
export function TodoPage({ list, view, disabled, onChange, hosts, past, newSessionCwd, linearConnected, quickTodo, onQuickTodo }: TodoPageProps) {
	const [editing, setEditing] = useState<Editing>(NOT_EDITING);
	const [openId, setOpenId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const day = today();
	const kind = LIST_KINDS[view.kind];
	const sessions: KnownSessions = { hosts, past };
	const sections = list === null ? [] : sectionsOf(list, view, day, sessions).map(section => ({ ...section, todos: section.todos.filter(todo => matches(todo, query)) }));
	const undo = useUndo(onChange);
	const drag = useTodoDrag(kind.canMove && !disabled, onChange);
	const toggle = (todo: UserTodoLeaf): void => onChange({ op: "toggle", id: todo.id, doneAt: todo.doneAt === null ? new Date().toISOString() : null });
	useTodoKeys({
		listRef,
		groups: sections.map(section => section.todos),
		editingId: editing.kind === "edit" ? editing.id : null,
		canMove: kind.canMove,
		disabled,
		onChange,
		onToggle: toggle,
	});

	// Keyed on the list's arrival as well, so a request made before the server sent the list starts the todo once it lands.
	// Another list waits until All is showing: the address changes after the render that asked for the capture.
	useEffect(() => {
		if (!quickTodo || list === null || disabled || view.kind !== "all") return;
		onQuickTodo();
		const section = sections[0];
		if (section) setEditing({ kind: "draft", parentId: null, afterId: lastToDo(section.todos), categoryId: section.categoryId, text: "" });
	}, [quickTodo, list === null, disabled, view.kind]);

	if (list === null) {
		return (
			<PageFrame title="Todo" meta="Your own todo list">
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your todos…</p>
			</PageFrame>
		);
	}

	const title = titleOf(list, view);
	const left = leftIn(list, view, day, sessions);
	const anyDone = sections.some(section => section.todos.some(todo => todo.doneAt !== null || todo.children.some(child => child.doneAt !== null)));

	/** Deletes todo `id` with the todos under it, and offers **Undo**, which puts it back where it was. */
	const remove = (id: string, text: string): void => {
		const restore = restoreOf(list, id);
		onChange({ op: "remove", id });
		if (openId === id) setOpenId(null);
		if (restore) undo.offer(text, restore);
	};
	/** Saves `text` as todo `todo`'s title; an empty one removes the todo. */
	const commit = (todo: UserTodoLeaf, text: string): void => {
		const trimmed = text.trim();
		if (!trimmed) remove(todo.id, todo.text);
		else if (trimmed !== todo.text) onChange({ op: "edit", id: todo.id, text: trimmed });
	};
	const add = ({ parentId, afterId, categoryId }: Draft, text: string): string | null => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const id = crypto.randomUUID();
		onChange({ op: "add", id, parentId, afterId, categoryId, text: trimmed, due: parentId === null && kind.dueToday ? day : null });
		return id;
	};

	/** Where a todo added right below `todo` among `siblings` goes: after it, or after the last one to do when it is done. */
	const below = (todo: UserTodoLeaf, siblings: readonly UserTodoLeaf[]): string | null => (todo.doneAt === null ? todo.id : lastToDo(siblings));

	const editKey = (todo: UserTodoLeaf, siblings: readonly UserTodoLeaf[], parentId: string | null, categoryId: string | null, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter":
				commit(todo, text);
				setEditing(text.trim() && kind.canAdd ? { kind: "draft", parentId, afterId: below(todo, siblings), categoryId, text: "" } : NOT_EDITING);
				return true;
			case "escape":
				setEditing(NOT_EDITING);
				return true;
			case "erase":
				remove(todo.id, todo.text);
				setEditing(NOT_EDITING);
				return true;
			case "indent":
			case "outdent": {
				const move: UserTodoChange = { op: key, id: todo.id };
				if (applyUserTodo(list, move) === list) return false;
				commit(todo, text);
				onChange(move);
				// The todo renders in another list, which mounts a new input for it.
				return true;
			}
		}
	};

	const draftKey = (draft: Draft, section: Section, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter": {
				const id = add(draft, text);
				setEditing(id ? { ...draft, afterId: id, text: "" } : NOT_EDITING);
				return true;
			}
			case "escape":
			case "erase":
				setEditing(NOT_EDITING);
				return true;
			case "indent": {
				// Under the top-level todo it follows, or the last one to do when it ends them.
				const parentId = draft.parentId === null ? (draft.afterId ?? lastToDo(section.todos)) : null;
				if (parentId === null) return false;
				setEditing({ ...draft, parentId, afterId: null, text });
				return true;
			}
			case "outdent": {
				const parent = draft.parentId === null ? undefined : section.todos.find(todo => todo.id === draft.parentId);
				if (!parent) return false;
				setEditing({ ...draft, parentId: null, afterId: below(parent, section.todos), text });
				return true;
			}
		}
	};

	const draftAt = (section: Section, parentId: string | null, afterId: string | null) => {
		if (disabled || editing.kind !== "draft" || editing.parentId !== parentId || editing.afterId !== afterId || editing.categoryId !== section.categoryId) return null;
		const draft = editing;
		return (
			// A new key per place, so the input starts with the draft's text wherever it moves.
			<li key={`draft:${parentId}:${afterId}`} className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug", parentId !== null && "ml-6")}>
				<Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
				<TodoInput
					initial={draft.text}
					label={parentId === null ? "New todo" : "New todo under it"}
					onKey={(key, text) => draftKey(draft, section, key, text)}
					onLeave={text => {
						add(draft, text);
						setEditing(NOT_EDITING);
					}}
				/>
			</li>
		);
	};

	/** A todo's row, beside `siblings`: a top-level todo's section, or its parent's todos. */
	const row = (section: Section, entry: TodoEntry, siblings: readonly UserTodoLeaf[]) => {
		const { todo } = entry;
		const top = entry.parent === null ? entry.todo : null;
		const children = top?.children ?? [];
		const isEditing = !disabled && editing.kind === "edit" && editing.id === todo.id;
		const done = todo.doneAt !== null;
		const childrenDone = children.filter(child => child.doneAt !== null).length;
		const over = drag.overOf(todo.id);
		const rowProps = drag.rowProps(entry, siblings);
		const check = (
			<button
				type="button"
				role="checkbox"
				aria-checked={done}
				aria-label={todo.text}
				disabled={disabled}
				onClick={() => toggle(todo)}
				className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:pointer-events-none [&>svg]:size-4"
			>
				{done ? <CircleCheck /> : <Circle />}
			</button>
		);
		return (
			<li
				key={todo.id}
				data-todo-id={todo.id}
				{...rowProps}
				draggable={rowProps.draggable && !isEditing}
				className={cn(
					"group/todo relative flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50",
					!top && "ml-6",
					todo.id === openId && "bg-accent",
					drag.draggingId === todo.id && "opacity-50",
					over === "before" && "shadow-[0_-2px_0_0_var(--ring)]",
					over === "after" && "shadow-[0_2px_0_0_var(--ring)]",
				)}
			>
				{rowProps.draggable && !isEditing && (
					<GripVertical aria-hidden className="absolute -left-3 top-1.5 size-3.5 cursor-grab text-muted-foreground/50 opacity-0 group-hover/todo:opacity-100" />
				)}
				<Tooltip content={done ? "Mark not done" : "Mark done"}>
					{disabled ? <span className="inline-flex">{check}</span> : check}
				</Tooltip>
				{isEditing ? (
					<TodoInput
						initial={todo.text}
						label="Todo"
						onKey={(key, text) => editKey(todo, siblings, entry.parent?.id ?? null, section.categoryId, key, text)}
						onLeave={text => {
							commit(todo, text);
							setEditing(NOT_EDITING);
						}}
					/>
				) : (
					<Tooltip content="Open and edit">
						<button
							type="button"
							data-todo-row
							onClick={() => {
								setOpenId(todo.id);
								if (!disabled) setEditing({ kind: "edit", id: todo.id });
							}}
							onKeyDown={event => {
								if (event.key === "Escape") event.currentTarget.blur();
							}}
							className={cn("min-w-0 flex-1 break-words rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", done ? "text-muted-foreground line-through" : "text-foreground")}
						>
							{todo.text}
						</button>
					</Tooltip>
				)}
				{top && !done && <TodoWorkPill state={workStateOf(top, sessions)} />}
				{top?.links.filter(link => link.kind !== "session").map(link => <TodoLinkChip key={JSON.stringify(link)} link={link} sessions={sessions} />)}
				{todo.due && !done && <DueChip due={todo.due} day={day} />}
				{todo.body.trim() && (
					<Tooltip content="Has notes">
						<button
							type="button"
							aria-label={`Open the notes of ${todo.text}`}
							onClick={() => setOpenId(todo.id)}
							className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground [&>svg]:size-3.5"
						>
							<NotebookText />
						</button>
					</Tooltip>
				)}
				{children.length > 0 && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`${childrenDone} of ${children.length} done`}>
						{childrenDone}/{children.length}
					</span>
				)}
				{!disabled && !isEditing && (
					<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
						{top && (
							<Tooltip content="Add a todo under it">
								<button
									type="button"
									aria-label={`Add a todo under ${todo.text}`}
									onClick={() => setEditing({ kind: "draft", parentId: todo.id, afterId: null, categoryId: section.categoryId, text: "" })}
									className="text-muted-foreground hover:text-foreground"
								>
									<Plus />
								</button>
							</Tooltip>
						)}
						<Tooltip content="Delete">
							<button
								type="button"
								aria-label={`Delete ${todo.text}`}
								onClick={() => remove(todo.id, todo.text)}
								className="text-muted-foreground hover:text-foreground"
							>
								<X />
							</button>
						</Tooltip>
					</span>
				)}
			</li>
		);
	};

	/** The rows of `todos`, done ones last, with `end`, the draft that ends the ones to do, between the two. */
	const rowsAround = <T extends UserTodoLeaf>(todos: readonly T[], rowsOf: (todo: T) => ReactNode[], end: ReactNode): ReactNode[] => {
		const done = todos.findIndex(todo => todo.doneAt !== null);
		const at = done < 0 ? todos.length : done;
		return [...todos.slice(0, at).flatMap(rowsOf), end, ...todos.slice(at).flatMap(rowsOf)];
	};

	const sectionView = (section: Section) => {
		const label = section.title ?? title;
		const sectionLeft = section.todos.filter(todo => todo.doneAt === null).length;
		const empty = section.todos.length === 0 ? (query ? `No todo matches “${query}”.` : kind.empty) : null;
		return (
			<section key={section.categoryId ?? ""} aria-label={label} className="space-y-1">
				{section.title !== null && (
					<h3 className="flex items-baseline gap-2 px-2 text-sm font-medium">
						{section.categoryId === null ? (
							section.title
						) : (
							<a href={hashForTodo({ kind: "category", id: section.categoryId })} className="hover:underline">
								{section.title}
							</a>
						)}
						<span className="text-xs tabular-nums text-muted-foreground">{sectionLeft}</span>
					</h3>
				)}
				<ul aria-label={`Todos of ${label}`} className="flex flex-col gap-0.5">
					{rowsAround(
						section.todos,
						todo => [
							row(section, { todo, parent: null }, section.todos),
							...rowsAround(todo.children, child => [row(section, { todo: child, parent: todo }, todo.children), draftAt(section, todo.id, child.id)], draftAt(section, todo.id, null)),
							draftAt(section, null, todo.id),
						],
						draftAt(section, null, null),
					)}
				</ul>
				{empty && <p className="px-2 text-sm text-muted-foreground">{empty}</p>}
				{!disabled && kind.canAdd && (
					<Tooltip content={kind.dueToday ? "Add a todo due today" : "Add a todo at the end of this list"}>
						<button
							type="button"
							onClick={() => setEditing({ kind: "draft", parentId: null, afterId: lastToDo(section.todos), categoryId: section.categoryId, text: "" })}
							className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
						>
							<Plus />
							{kind.addLabel}
						</button>
					</Tooltip>
				)}
			</section>
		);
	};

	const open = openId === null ? null : placeIn([list.todos], openId)?.entry;
	return (
		<PageFrame
			title={title}
			meta={left === 0 ? "Nothing to do" : `${left} to do`}
			actions={
				<>
					<TodoSearch query={query} onQuery={setQuery} />
					{anyDone && !disabled && (
						<Tooltip content="Move checked todos to Done">
							<Button variant="ghost" size="compact" leadingIcon={ListX} onClick={() => onChange({ op: "clear-done", categoryId: view.kind === "category" ? view.id : null })}>
								Clear done
							</Button>
						</Tooltip>
					)}
				</>
			}
		>
			<div className={cn("mx-auto grid w-full gap-8 px-6 py-6", open ? "max-w-6xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : "max-w-3xl")}>
				<div ref={listRef} className="space-y-6">
					{sections.map(sectionView)}
				</div>
				{open && (
					<TodoDetail
						key={open.todo.id}
						list={list}
						open={open}
						readOnly={disabled}
						onChange={onChange}
						onClose={() => setOpenId(null)}
						sessions={sessions}
						newSessionCwd={newSessionCwd}
						linearConnected={linearConnected}
					/>
				)}
			</div>
			{undo.toast}
		</PageFrame>
	);
}
