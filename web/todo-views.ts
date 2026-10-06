/** Which todos each of the Todo page's lists holds and what it lets you do, shared by the page and the sidebar. */
import { Archive, Bot, CalendarClock, ListTodo, MessageCircleQuestionMark, type LucideIcon } from "lucide-react";
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../src/shared";
import type { TodoListView } from "./routing";
import { workStateOf, type TodoSessions } from "./todo-work-state";

/** What a list is called and lets you do. A category's own name replaces its `title`. */
interface ListKind {
	/** What the sidebar calls it. */
	name: string;
	/** The page's title. */
	title: string;
	/** The sidebar's icon; a category has none. */
	icon: LucideIcon | null;
	canAdd: boolean;
	/** Today sorts by due day and Done by when it was cleared, so neither moves todos. */
	canMove: boolean;
	/** A todo added here is due today. */
	dueToday: boolean;
	addLabel: string;
	/** What the list says while it holds nothing to show and no search is typed. */
	empty: string | null;
}

export const LIST_KINDS: Record<TodoListView["kind"], ListKind> = {
	all: { name: "All", title: "Todo", icon: ListTodo, canAdd: true, canMove: true, dueToday: false, addLabel: "Add a todo", empty: null },
	today: { name: "Today", title: "Today", icon: CalendarClock, canAdd: true, canMove: false, dueToday: true, addLabel: "Add a todo due today", empty: "Nothing is due today." },
	needs: { name: "Needs you", title: "Needs you", icon: MessageCircleQuestionMark, canAdd: false, canMove: false, dueToday: false, addLabel: "", empty: "No todo is waiting on you." },
	agents: {
		name: "From agents",
		title: "From agents",
		icon: Bot,
		canAdd: false,
		canMove: true,
		dueToday: false,
		addLabel: "",
		empty: "No agent has added a todo. An omp session adds one with its `user_todo` tool.",
	},
	done: { name: "Done", title: "Done", icon: Archive, canAdd: false, canMove: false, dueToday: false, addLabel: "", empty: "Clear done puts checked todos here." },
	category: { name: "", title: "Todo", icon: null, canAdd: true, canMove: true, dueToday: false, addLabel: "Add a todo", empty: null },
};

/** The lists the sidebar shows above the categories, in its order. */
export const SIDEBAR_LISTS: Exclude<TodoListView, { kind: "category" }>[] = [{ kind: "all" }, { kind: "today" }, { kind: "needs" }, { kind: "agents" }, { kind: "done" }];

export const titleOf = (list: UserTodoList, view: TodoListView): string =>
	view.kind === "category" ? (list.categories.find(({ id }) => id === view.id)?.name ?? LIST_KINDS.category.title) : LIST_KINDS[view.kind].title;

/** A day as the lists show it: `Oct 5`. */
export const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Today in the browser's time zone, as a todo's `due` names a day: `YYYY-MM-DD`. */
export function today(now = new Date()): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
