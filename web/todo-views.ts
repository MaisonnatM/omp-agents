/** Which todos each of the Todo page's lists holds and what it lets you do, shared by the page and the sidebar. */
import { Archive, Bot, CalendarClock, ListTodo, type LucideIcon, MessageCircleQuestionMark } from "lucide-react";
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../src/user-todos-shared";
import { localDay } from "./days";
import type { TodoListView } from "./routing";
import { workStateOf, type TodoSessions } from "./todo-work-state";

/** What a list shows and lets you do. A category's title is its own name. */
export interface ListKind {
	/** The page's title. */
	title: string;
	/** What adding a todo here offers; `null` for a list that takes none. */
	add: { label: string; dueToday: boolean } | null;
	/** Today sorts by due day and Done by when it was cleared, so neither moves todos. */
	canMove: boolean;
	/** Done lists the archive: its todos can be opened, put back, or deleted, not changed. */
	readOnly: boolean;
	/** What the list says while it holds nothing to show and no search is typed. */
	empty: string | null;
}

export const LIST_KINDS: Record<TodoListView["kind"], ListKind> = {
	all: { title: "Todo", add: { label: "Add a todo", dueToday: false }, canMove: true, readOnly: false, empty: null },
	today: { title: "Today", add: { label: "Add a todo due today", dueToday: true }, canMove: false, readOnly: false, empty: "Nothing is due today." },
	needs: { title: "Needs you", add: null, canMove: false, readOnly: false, empty: "No todo is waiting on you." },
	agents: { title: "From agents", add: null, canMove: true, readOnly: false, empty: "No agent has added a todo. An omp session adds one with its `user_todo` tool." },
	done: { title: "Done", add: null, canMove: false, readOnly: true, empty: "Clear done puts checked todos here." },
	category: { title: "Todo", add: { label: "Add a todo", dueToday: false }, canMove: true, readOnly: false, empty: null },
};

/** The lists the sidebar shows above the categories, in its order, each with its name and icon. */
export const SIDEBAR_LISTS: { view: Exclude<TodoListView, { kind: "category" }>; name: string; icon: LucideIcon }[] = [
	{ view: { kind: "all" }, name: "All", icon: ListTodo },
	{ view: { kind: "today" }, name: "Today", icon: CalendarClock },
	{ view: { kind: "needs" }, name: "Needs you", icon: MessageCircleQuestionMark },
	{ view: { kind: "agents" }, name: "From agents", icon: Bot },
	{ view: { kind: "done" }, name: "Done", icon: Archive },
];

export const titleOf = (list: UserTodoList, view: TodoListView): string =>
	view.kind === "category" ? (list.categories.find(({ id }) => id === view.id)?.name ?? LIST_KINDS.category.title) : LIST_KINDS[view.kind].title;

/** A day as the lists show it: `Oct 5`. */
export const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A due day as the lists read it, and whether it has passed; `day` is today. */
export function dueLabel(due: string, day: string): { text: string; overdue: boolean } {
	if (due === day) return { text: "Today", overdue: false };
	const [y, m, d] = due.split("-").map(Number);
	const overdue = due < day;
	if (!overdue) {
		const [ty, tm, td] = day.split("-").map(Number);
		if (due === localDay(new Date(ty!, tm! - 1, td! + 1))) return { text: "Tomorrow", overdue };
	}
	const date = DAY_FORMAT.format(new Date(y!, m! - 1, d!));
	return { text: overdue ? `Overdue · ${date}` : date, overdue };
}
/** A top-level todo the Today list shows: it, or a todo under it, is to do and due by `day`. */
export const isDueBy = (todo: UserTodo, day: string): boolean =>
	[todo, ...todo.children].some(leaf => leaf.doneAt === null && leaf.due !== null && leaf.due <= day);

/** The earliest day a top-level todo, or a todo under it still to do, is due; `null` for none. */
export function earliestDue(todo: UserTodo): string | null {
	const days = [todo, ...todo.children].filter(leaf => leaf.doneAt === null && leaf.due !== null).map(leaf => leaf.due!);
	return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}

/** The top-level todos `view` lists, in its order: the list's, to do first then by earliest due day for Today, or the archive's, latest first. */
export function todosOf(list: UserTodoList, view: TodoListView, day: string, sessions: TodoSessions): UserTodo[] {
	switch (view.kind) {
		case "all":
			return list.todos;
		case "category":
			return list.todos.filter(todo => todo.categoryId === view.id);
		case "today":
			return list.todos
				.filter(todo => isDueBy(todo, day))
				.toSorted((a, b) => Number(a.doneAt !== null) - Number(b.doneAt !== null) || earliestDue(a)!.localeCompare(earliestDue(b)!));
		case "needs":
			return list.todos.filter(todo => todo.doneAt === null && workStateOf(todo, sessions).kind === "needs-you");
		case "agents":
			return list.todos.filter(todo => todo.addedBy !== null);
		case "done":
			return list.archive;
		default: {
			const never: never = view;
			return never;
		}
	}
}

/** How many top-level todos `view` lists still to do; for Done, how many it holds. */
export function leftIn(list: UserTodoList, view: TodoListView, day: string, sessions: TodoSessions): number {
	const todos = todosOf(list, view, day, sessions);
	return view.kind === "done" ? todos.length : todos.filter(todo => todo.doneAt === null).length;
}

/** The todos a list shows under one heading: those of one category, of none, or of a list that is not a category. */
export interface Section {
	/** The category a todo added here joins. */
	categoryId: string | null;
	/** `null` for the only section, which the page's title already names. */
	title: string | null;
	todos: UserTodo[];
}

/** For every todo, the todos of no category first, then each category with todos, in its order; any other list is one section. */
export function sectionsOf(list: UserTodoList, view: TodoListView, day: string, sessions: TodoSessions): Section[] {
	if (view.kind !== "all") return [{ categoryId: view.kind === "category" ? view.id : null, title: null, todos: todosOf(list, view, day, sessions) }];
	const inCategory = (categoryId: string | null) => list.todos.filter(todo => todo.categoryId === categoryId);
	const named = list.categories.map(({ id, name }) => ({ categoryId: id, title: name, todos: inCategory(id) })).filter(section => section.todos.length > 0);
	return [{ categoryId: null, title: named.length > 0 ? "No category" : null, todos: inCategory(null) }, ...named];
}

export const sameTodoView = (a: TodoListView, b: TodoListView): boolean =>
	a.kind === b.kind && (a.kind !== "category" || (b.kind === "category" && a.id === b.id));

/** Whether a todo's title or notes, or one under it, holds every word of `query`, ignoring case. */
export function matches(todo: UserTodo, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return true;
	const text = [todo, ...todo.children].map(leaf => `${leaf.text}\n${leaf.body}`).join("\n").toLowerCase();
	return words.every(word => text.includes(word));
}

/** Whether two todos sit on the same side of a list, which keeps the ones to do before the done ones. */
export const sameStatus = (a: UserTodoLeaf, b: UserTodoLeaf): boolean => (a.doneAt === null) === (b.doneAt === null);

/** The last of `todos` still to do, after which a new todo ends them; `null` for none, which adds it last, still before the done ones. */
export const lastToDo = (todos: readonly UserTodoLeaf[]): string | null => todos.findLast(todo => todo.doneAt === null)?.id ?? null;

/** A todo as a list shows it: a top-level one, or one under top-level todo `parent`. */
export type TodoEntry = { todo: UserTodo; parent: null } | { todo: UserTodoLeaf; parent: UserTodo };

/**
 * The `move` that puts `entry` at `position` among `siblings`, the todos a list shows beside it, counted once `entry`
 * is out of them; a top-level todo joins `categoryId`. `null` when that is where it is, or among the todos of the other status.
 */
export function moveTo(entry: TodoEntry, siblings: readonly UserTodoLeaf[], position: number, categoryId: string | null): Extract<UserTodoChange, { op: "move" }> | null {
	const { id } = entry.todo;
	const rest = siblings.filter(todo => todo.id !== id);
	if (position < 0 || position > rest.length || siblings[position]?.id === id) return null;
	const before = rest[position - 1];
	const after = rest[position];
	const crosses = entry.todo.doneAt === null ? before !== undefined && before.doneAt !== null : after !== undefined && after.doneAt === null;
	if (crosses) return null;
	return { op: "move", id, afterId: before?.id ?? null, categoryId: entry.parent === null ? categoryId : null };
}

/** Where todo `id` sits among the lists' `groups` of top-level todos: as an entry, with the todos shown beside it. */
export function placeIn(groups: readonly (readonly UserTodo[])[], id: string): { entry: TodoEntry; siblings: readonly UserTodoLeaf[] } | null {
	for (const todos of groups) {
		for (const todo of todos) {
			if (todo.id === id) return { entry: { todo, parent: null }, siblings: todos };
			const child = todo.children.find(leaf => leaf.id === id);
			if (child) return { entry: { todo: child, parent: todo }, siblings: todo.children };
		}
	}
	return null;
}

/** The `restore` that puts todo `id` back where it is now, after a `remove`; `null` when the list does not hold it. */
export function restoreOf(list: UserTodoList, id: string): Extract<UserTodoChange, { op: "restore" }> | null {
	for (const [index, todo] of list.todos.entries()) {
		if (todo.id === id) return { op: "restore", parentId: null, todo, index };
		const child = todo.children.findIndex(leaf => leaf.id === id);
		if (child >= 0) return { op: "restore", parentId: todo.id, todo: todo.children[child]!, index: child };
	}
	return null;
}
