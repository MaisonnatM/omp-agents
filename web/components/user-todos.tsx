import { Archive, CalendarClock, Circle, CircleCheck, GripVertical, ListX, NotebookText, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { PastSession, RosterHost, UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../src/shared";
import { applyUserTodo } from "../../src/user-todos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hashForTodo, type TodoListView } from "../routing";
import { useShortcuts } from "../shortcuts";
import { earliestDue, leftIn, matches, todosOf, today } from "../todo-views";
import { PageFrame } from "./list-sheet-page";
import { openIn, TodoDetail } from "./todo-detail";
import { AddedByChip, type KnownSessions, TodoLinkChip } from "./todo-links";

/** What the Todo page types into: a todo's title, or a todo not added yet, at its place in the list, with what it holds so far. */
type Editing =
	| { kind: "none" }
	| { kind: "edit"; id: string }
	| { kind: "draft"; parentId: string | null; afterId: string | null; categoryId: string | null; text: string };

type Draft = Extract<Editing, { kind: "draft" }>;

const NOT_EDITING: Editing = { kind: "none" };

/** How long **Undo** stays after a todo is deleted. */
const UNDO_MS = 8000;

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

/** What a list lets you do: add a todo, due that day for Today, and reorder its todos, which Today sorts by due day instead. */
interface ListRules {
	canAdd: boolean;
	canMove: boolean;
	/** The due day a todo added here gets. */
	addDue: string | null;
}

const rulesOf = (view: TodoListView, day: string): ListRules => ({
	canAdd: view.kind !== "agents" && view.kind !== "done",
	canMove: view.kind !== "today" && view.kind !== "done",
	addDue: view.kind === "today" ? day : null,
});

/** For every todo, the todos of no category first, then each category with todos, in its order; any other list is one section. */
function sectionsOf(list: UserTodoList, view: TodoListView, day: string): Section[] {
	if (view.kind !== "all") return [{ categoryId: view.kind === "category" ? view.id : null, title: null, todos: todosOf(list, view, day) }];
	const inCategory = (categoryId: string | null) => list.todos.filter(todo => todo.categoryId === categoryId);
	const named = list.categories.map(({ id, name }) => ({ categoryId: id, title: name, todos: inCategory(id) })).filter(section => section.todos.length > 0);
	return [{ categoryId: null, title: named.length > 0 ? "No category" : null, todos: inCategory(null) }, ...named];
}

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A due day as the list reads it, and whether it has passed. */
function dueLabel(due: string, day: string): { text: string; overdue: boolean } {
	const [y, m, d] = due.split("-").map(Number);
	const date = new Date(y!, m! - 1, d!);
	const tomorrow = new Date();
	tomorrow.setDate(tomorrow.getDate() + 1);
	if (due === day) return { text: "Today", overdue: false };
	if (due === today(tomorrow)) return { text: "Tomorrow", overdue: false };
	return { text: due < day ? `Overdue · ${DAY_FORMAT.format(date)}` : DAY_FORMAT.format(date), overdue: due < day };
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

/** Where a todo sits, to put it back after a delete: its top-level todo when it is under one, and the todo before it. */
function restoreOf(list: UserTodoList, id: string): Extract<UserTodoChange, { op: "restore" }> | null {
	for (const [index, todo] of list.todos.entries()) {
		if (todo.id === id) return { op: "restore", todo, parentId: null, afterId: list.todos[index - 1]?.id ?? null };
		const child = todo.children.findIndex(leaf => leaf.id === id);
		if (child < 0) continue;
		const leaf = todo.children[child]!;
		return {
			op: "restore",
			todo: { ...leaf, categoryId: todo.categoryId, children: [], links: [], addedBy: null },
			parentId: todo.id,
			afterId: todo.children[child - 1]?.id ?? null,
		};
	}
	return null;
}

/** The row being dragged, and where a drop on the row under the pointer would put it. */
interface Drag {
	id: string;
	parentId: string | null;
	over: { id: string; where: "before" | "after" } | null;
}

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
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
	const [drag, setDrag] = useState<Drag | null>(null);
	const [undo, setUndo] = useState<{ text: string; change: UserTodoChange } | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const day = today();
	const rules = rulesOf(view, day);
	const sections = list === null ? [] : sectionsOf(list, view, day).map(section => ({ ...section, todos: section.todos.filter(todo => matches(todo, query)) }));

	useEffect(() => {
		if (!undo) return;
		const timer = setTimeout(() => setUndo(null), UNDO_MS);
		return () => clearTimeout(timer);
	}, [undo]);

	useEffect(() => {
		if (!quickTodo || list === null || disabled) return;
		onQuickTodo();
		const section = sections[0];
		if (section && rules.canAdd) setEditing({ kind: "draft", parentId: null, afterId: section.todos.at(-1)?.id ?? null, categoryId: section.categoryId, text: "" });
	}, [quickTodo, list === null, disabled]);

	/** The todo a key acts on: the one being typed into, else the one whose row has focus. */
	const focusedId = (): string | null =>
		editing.kind === "edit" ? editing.id : ((document.activeElement as HTMLElement | null)?.closest("[data-todo-id]")?.getAttribute("data-todo-id") ?? null);

	const rows = (): HTMLElement[] => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-todo-row]") ?? [])];

	const focusStep = (step: 1 | -1): boolean => {
		const all = rows();
		if (all.length === 0) return false;
		const at = all.findIndex(row => row === document.activeElement);
		all[at < 0 ? (step > 0 ? 0 : all.length - 1) : Math.min(all.length - 1, Math.max(0, at + step))]!.focus();
		return true;
	};

	/** Moves todo `id` one place among the todos shown beside it; whether it moved. */
	const moveBy = (id: string, step: 1 | -1): boolean => {
		if (!rules.canMove || disabled) return false;
		for (const { todos } of sections) {
			const at = todos.findIndex(todo => todo.id === id);
			if (at >= 0) {
				const to = at + step;
				if (to < 0 || to >= todos.length) return false;
				const afterId = step < 0 ? (todos[to - 1]?.id ?? null) : todos[to]!.id;
				onChange({ op: "move", id, afterId, categoryId: todos[at]!.categoryId });
				return true;
			}
			for (const parent of todos) {
				const child = parent.children.findIndex(leaf => leaf.id === id);
				if (child < 0) continue;
				const to = child + step;
				if (to < 0 || to >= parent.children.length) return false;
				const afterId = step < 0 ? (parent.children[to - 1]?.id ?? null) : parent.children[to]!.id;
				onChange({ op: "move", id, afterId, categoryId: null });
				return true;
			}
		}
		return false;
	};

	const toggle = (todo: UserTodoLeaf): void => onChange({ op: "toggle", id: todo.id, doneAt: todo.doneAt === null ? new Date().toISOString() : null });

	/** Deletes todo `id` with the todos under it, and offers **Undo**, which puts it back where it was. */
	const remove = (id: string, text: string): void => {
		const restore = list && restoreOf(list, id);
		onChange({ op: "remove", id });
		if (openId === id) setOpenId(null);
		if (restore) setUndo({ text, change: restore });
	};

	useShortcuts({
		todoSearch: () => {
			searchRef.current?.focus();
		},
		todoNext: () => focusStep(1),
		todoPrevious: () => focusStep(-1),
		todoCheck: () => {
			const id = focusedId();
			const found = id && list ? openIn([...list.todos, ...list.archive], id) : null;
			if (!found || disabled || view.kind === "done") return false;
			toggle(found.todo);
		},
		todoMoveUp: () => {
			const id = focusedId();
			return id !== null && moveBy(id, -1);
		},
		todoMoveDown: () => {
			const id = focusedId();
			return id !== null && moveBy(id, 1);
		},
	});

	if (list === null) {
		return (
			<PageFrame title="Todo" meta="Your own todo list">
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your todos…</p>
			</PageFrame>
		);
	}

	const title = view.kind === "category" ? (list.categories.find(({ id }) => id === view.id)?.name ?? "Todo") : { all: "Todo", today: "Today", agents: "From agents", done: "Done" }[view.kind];
	const left = leftIn(list, view, day);
	const shownTodos = sections.flatMap(section => section.todos);
	const anyDone = view.kind !== "done" && shownTodos.some(todo => todo.doneAt !== null || todo.children.some(child => child.doneAt !== null));
	const sessions: KnownSessions = { hosts, past };

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
		onChange({ op: "add", id, parentId, afterId, categoryId, text: trimmed, due: parentId === null ? rules.addDue : null });
		return id;
	};

	const editKey = (todo: UserTodoLeaf, parentId: string | null, categoryId: string | null, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter":
				commit(todo, text);
				setEditing(text.trim() && rules.canAdd ? { kind: "draft", parentId, afterId: todo.id, categoryId, text: "" } : NOT_EDITING);
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
				// Under the top-level todo it follows, or the section's last one when it ends the section.
				const parentId = draft.parentId === null ? (draft.afterId ?? section.todos.at(-1)?.id ?? null) : null;
				if (parentId === null) return false;
				setEditing({ ...draft, parentId, afterId: null, text });
				return true;
			}
			case "outdent":
				if (draft.parentId === null) return false;
				setEditing({ ...draft, parentId: null, afterId: draft.parentId, text });
				return true;
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

	/** Drops the dragged todo before or after `target`, among the todos `siblings` shows beside it. */
	const drop = (target: UserTodoLeaf, siblings: UserTodoLeaf[], categoryId: string | null): void => {
		if (!drag?.over || drag.over.id !== target.id) return;
		const rest = siblings.filter(todo => todo.id !== drag.id);
		const at = rest.findIndex(todo => todo.id === target.id);
		const afterId = drag.over.where === "after" ? target.id : (rest[at - 1]?.id ?? null);
		onChange({ op: "move", id: drag.id, afterId, categoryId });
	};

	/** The drag handlers of a row that `parentId`'s todos `siblings` show, in category `categoryId`. */
	const dropTarget = (todo: UserTodoLeaf, parentId: string | null, siblings: UserTodoLeaf[], categoryId: string | null) => ({
		onDragOver: (event: DragEvent<HTMLLIElement>) => {
			if (!drag || drag.parentId !== parentId || drag.id === todo.id) return;
			event.preventDefault();
			const box = event.currentTarget.getBoundingClientRect();
			const where = event.clientY < box.top + box.height / 2 ? "before" : "after";
			if (drag.over?.id !== todo.id || drag.over.where !== where) setDrag({ ...drag, over: { id: todo.id, where } });
		},
		onDrop: (event: DragEvent<HTMLLIElement>) => {
			event.preventDefault();
			drop(todo, siblings, categoryId);
			setDrag(null);
		},
	});

	/** A todo's row; `parent` is the top-level todo it is under, and `children` its own todos when it is a top-level one. */
	const row = (section: Section, todo: UserTodoLeaf, parent: UserTodo | null, children: UserTodoLeaf[]) => {
		const isEditing = !disabled && editing.kind === "edit" && editing.id === todo.id;
		const done = todo.doneAt !== null;
		const childrenDone = children.filter(child => child.doneAt !== null).length;
		const top = parent === null ? (todo as UserTodo) : null;
		const draggable = rules.canMove && !disabled && !isEditing;
		const over = drag?.over?.id === todo.id ? drag.over.where : null;
		const siblings = parent ? parent.children : section.todos;
		return (
			<li
				key={todo.id}
				data-todo-id={todo.id}
				draggable={draggable}
				onDragStart={event => {
					event.dataTransfer.effectAllowed = "move";
					event.dataTransfer.setData("text/plain", todo.text);
					setDrag({ id: todo.id, parentId: parent?.id ?? null, over: null });
				}}
				onDragEnd={() => setDrag(null)}
				{...dropTarget(todo, parent?.id ?? null, siblings, top ? (todo as UserTodo).categoryId : null)}
				className={cn(
					"group/todo relative flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50",
					parent !== null && "ml-6",
					todo.id === openId && "bg-accent",
					drag?.id === todo.id && "opacity-50",
					over === "before" && "shadow-[0_-2px_0_0_var(--ring)]",
					over === "after" && "shadow-[0_2px_0_0_var(--ring)]",
				)}
			>
				{draggable && (
					<GripVertical aria-hidden className="absolute -left-3 top-1.5 size-3.5 cursor-grab text-muted-foreground/50 opacity-0 group-hover/todo:opacity-100" />
				)}
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
				{isEditing ? (
					<TodoInput
						initial={todo.text}
						label="Todo"
						onKey={(key, text) => editKey(todo, parent?.id ?? null, section.categoryId, key, text)}
						onLeave={text => {
							commit(todo, text);
							setEditing(NOT_EDITING);
						}}
					/>
				) : (
					<button
						type="button"
						data-todo-row
						title="Open and edit"
						onClick={() => {
							setOpenId(todo.id);
							if (!disabled) setEditing({ kind: "edit", id: todo.id });
						}}
						onKeyDown={event => {
							if (event.key === "Enter" || event.key === " ") return;
							if (event.key === "Escape") event.currentTarget.blur();
						}}
						className={cn("min-w-0 flex-1 break-words rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", done ? "text-muted-foreground line-through" : "text-foreground")}
					>
						{todo.text}
					</button>
				)}
				{top?.addedBy && <AddedByChip sessionId={top.addedBy} sessions={sessions} />}
				{top?.links.map(link => <TodoLinkChip key={JSON.stringify(link)} link={link} sessions={sessions} />)}
				{todo.due && !done && <DueChip due={todo.due} day={day} />}
				{todo.body.trim() && (
					<button
						type="button"
						title="Has notes"
						aria-label={`Open the notes of ${todo.text}`}
						onClick={() => setOpenId(todo.id)}
						className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground [&>svg]:size-3.5"
					>
						<NotebookText />
					</button>
				)}
				{children.length > 0 && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`${childrenDone} of ${children.length} done`}>
						{childrenDone}/{children.length}
					</span>
				)}
				{!disabled && !isEditing && (
					<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
						{parent === null && (
							<button
								type="button"
								title="Add a todo under it"
								aria-label={`Add a todo under ${todo.text}`}
								onClick={() => setEditing({ kind: "draft", parentId: todo.id, afterId: null, categoryId: section.categoryId, text: "" })}
								className="text-muted-foreground hover:text-foreground"
							>
								<Plus />
							</button>
						)}
						<button
							type="button"
							title="Delete"
							aria-label={`Delete ${todo.text}`}
							onClick={() => remove(todo.id, todo.text)}
							className="text-muted-foreground hover:text-foreground"
						>
							<X />
						</button>
					</span>
				)}
			</li>
		);
	};

	const sectionView = (section: Section) => {
		const label = section.title ?? title;
		const sectionLeft = section.todos.filter(todo => todo.doneAt === null).length;
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
					{section.todos.flatMap(todo => [
						row(section, todo, null, todo.children),
						...todo.children.flatMap(child => [row(section, child, todo, []), draftAt(section, todo.id, child.id)]),
						draftAt(section, todo.id, null),
						draftAt(section, null, todo.id),
					])}
					{draftAt(section, null, null)}
				</ul>
				{section.todos.length === 0 && query && <p className="px-2 text-sm text-muted-foreground">No todo matches “{query}”.</p>}
				{section.todos.length === 0 && !query && view.kind === "today" && <p className="px-2 text-sm text-muted-foreground">Nothing is due today.</p>}
				{section.todos.length === 0 && !query && view.kind === "agents" && (
					<p className="px-2 text-sm text-muted-foreground">No agent has added a todo. An omp session adds one with its `user_todo` tool.</p>
				)}
				{!disabled && rules.canAdd && (
					<button
						type="button"
						onClick={() => setEditing({ kind: "draft", parentId: null, afterId: section.todos.at(-1)?.id ?? null, categoryId: section.categoryId, text: "" })}
						className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
					>
						<Plus />
						{view.kind === "today" ? "Add a todo due today" : "Add a todo"}
					</button>
				)}
			</section>
		);
	};

	const archiveView = () => (
		<section aria-label="Done" className="space-y-1">
			<ul aria-label="Archived todos" className="flex flex-col gap-0.5">
				{shownTodos.map(todo => (
					<li key={todo.id} className={cn("group/todo flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50", todo.id === openId && "bg-accent")}>
						<Archive aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
						<button type="button" data-todo-row data-todo-id={todo.id} onClick={() => setOpenId(todo.id)} className="min-w-0 flex-1 break-words text-left text-muted-foreground">
							{todo.text}
							{todo.children.length > 0 && <span className="ml-2 text-xs tabular-nums">{todo.children.length} under it</span>}
						</button>
						{todo.doneAt && <span className="shrink-0 text-xs text-muted-foreground">{DAY_FORMAT.format(new Date(todo.doneAt))}</span>}
						{!disabled && (
							<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
								<button type="button" title="Put back in the list" aria-label={`Put ${todo.text} back`} onClick={() => onChange({ op: "unarchive", id: todo.id })} className="text-muted-foreground hover:text-foreground">
									<RotateCcw />
								</button>
								<button type="button" title="Delete for good" aria-label={`Delete ${todo.text} for good`} onClick={() => onChange({ op: "remove", id: todo.id })} className="text-muted-foreground hover:text-foreground">
									<Trash2 />
								</button>
							</span>
						)}
					</li>
				))}
			</ul>
			{shownTodos.length === 0 && <p className="px-2 text-sm text-muted-foreground">{query ? `No todo matches “${query}”.` : "Clear done puts checked todos here."}</p>}
		</section>
	);

	const archived = view.kind === "done";
	const open = openIn(archived ? list.archive : list.todos, openId);
	return (
		<PageFrame
			title={title}
			meta={archived ? `${left} done` : left === 0 ? "Nothing to do" : `${left} to do`}
			actions={
				<>
					<label className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring [&>svg]:size-3.5">
						<Search aria-hidden />
						<input
							ref={searchRef}
							type="search"
							aria-label="Search todos"
							placeholder="Search"
							value={query}
							onChange={event => setQuery(event.target.value)}
							onKeyDown={event => {
								if (event.key !== "Escape") return;
								setQuery("");
								event.currentTarget.blur();
							}}
							className="w-32 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
						/>
					</label>
					{anyDone && !disabled && (
						<Button variant="ghost" size="compact" leadingIcon={ListX} onClick={() => onChange({ op: "clear-done", categoryId: view.kind === "category" ? view.id : null })}>
							Clear done
						</Button>
					)}
					{archived && list.archive.length > 0 && !disabled && (
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
					)}
				</>
			}
		>
			<div className={cn("mx-auto grid w-full gap-8 px-6 py-6", open ? "max-w-6xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : "max-w-3xl")}>
				<div ref={listRef} className="space-y-6">
					{archived ? archiveView() : sections.map(sectionView)}
				</div>
				{open && (
					<TodoDetail
						key={open.todo.id}
						list={list}
						open={open}
						archived={archived}
						disabled={disabled}
						onChange={onChange}
						onClose={() => setOpenId(null)}
						sessions={sessions}
						newSessionCwd={newSessionCwd}
						linearConnected={linearConnected}
					/>
				)}
			</div>
			{undo && (
				<div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lg">
					<span className="max-w-72 truncate">Deleted “{undo.text}”</span>
					<Button
						variant="secondary"
						size="compact"
						onClick={() => {
							onChange(undo.change);
							setUndo(null);
						}}
					>
						Undo
					</Button>
				</div>
			)}
		</PageFrame>
	);
}
