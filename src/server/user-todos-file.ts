/** The Todo page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { JsonFile } from "../fs";
import type { UserTodoChange, UserTodoList } from "../shared";
import { applyUserTodo } from "../user-todos";
import { parseUserTodoList } from "../user-todos-parse";

const EMPTY: UserTodoList = { categories: [], todos: [], archive: [] };

export class UserTodosFile {
	readonly #file: JsonFile<UserTodoList>;
	#list: UserTodoList;

	constructor(path: string) {
		// The file holds what someone typed, so a file that is not a list moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseUserTodoList, holds: "a todo list", onInvalid: "aside", indent: "\t" });
		this.#list = this.#file.load() ?? EMPTY;
	}

	get list(): UserTodoList {
		return this.#list;
	}

	/** Applies `change` and saves the list; whether it changed. */
	apply(change: UserTodoChange): boolean {
		const next = applyUserTodo(this.#list, change);
		if (next === this.#list) return false;
		this.#list = next;
		this.#save();
		return true;
	}

	#save(): void {
		this.#file.save(this.#list);
	}
}
