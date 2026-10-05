/** Which todos each of the Todo page's lists holds, shared by the page and the sidebar's counts. */
import type { UserTodo, UserTodoList } from "../src/shared";
import type { TodoListView } from "./routing";

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

/** The top-level todos `view` lists, in its order: the list's, by earliest due day for Today, or the archive's, latest first. */
export function todosOf(list: UserTodoList, view: TodoListView, day: string): UserTodo[] {
	switch (view.kind) {
		case "all":
			return list.todos;
		case "category":
			return list.todos.filter(todo => todo.categoryId === view.id);
		case "today":
			return list.todos.filter(todo => isDueBy(todo, day)).toSorted((a, b) => earliestDue(a)!.localeCompare(earliestDue(b)!));
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
export function leftIn(list: UserTodoList, view: TodoListView, day: string): number {
	const todos = todosOf(list, view, day);
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
