/** The Todo page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { ReducerFile } from "../fs";
import { applyUserTodo } from "../user-todos";
import { parseUserTodoList } from "../user-todos-parse";
import type { UserTodoChange, UserTodoList } from "../user-todos-shared";

export class UserTodosFile extends ReducerFile<UserTodoList, [UserTodoChange]> {
	constructor(path: string) {
		super(path, { parse: parseUserTodoList, holds: "a todo list", empty: { categories: [], todos: [], archive: [] }, reduce: applyUserTodo });
	}
}
