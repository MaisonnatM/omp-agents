/** The Todo page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { JsonFile } from "../fs";
import { isObject } from "../json";
import type { UserTodo, UserTodoCategory, UserTodoChange, UserTodoLeaf, UserTodoList } from "../shared";
import { applyUserTodo } from "../user-todos";

const EMPTY: UserTodoList = { categories: [], todos: [] };

/** A file written before todos had a body reads each as having none. */
function parseLeaf(value: unknown): UserTodoLeaf | null {
	if (!isObject(value)) return null;
	const { id, text, done, body = "" } = value;
	return typeof id === "string" && typeof text === "string" && typeof done === "boolean" && typeof body === "string" ? { id, text, body, done } : null;
}

function parseCategory(value: unknown): UserTodoCategory | null {
	if (!isObject(value)) return null;
	const { id, name } = value;
	return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}

/** Every entry of `values` through `parse`, or `null` when one does not parse. */
function parseAll<T>(values: unknown, parse: (value: unknown) => T | null): T[] | null {
	if (!Array.isArray(values)) return null;
	const parsed: T[] = [];
	for (const value of values) {
		const entry = parse(value);
		if (entry === null) return null;
		parsed.push(entry);
	}
	return parsed;
}

/** The list a file holds, `null` when it holds none. A file written before categories reads as having none, with every todo in none. */
function parseList(value: unknown): UserTodoList | null {
	if (!isObject(value)) return null;
	const categories = parseAll(value.categories ?? [], parseCategory);
	if (!categories) return null;
	const known = new Set(categories.map(category => category.id));
	const todos = parseAll(value.todos, (raw): UserTodo | null => {
		const todo = parseLeaf(raw);
		if (!todo || !isObject(raw)) return null;
		const children = parseAll(raw.children, parseLeaf);
		const { categoryId = null } = raw;
		if (!children || !(categoryId === null || typeof categoryId === "string")) return null;
		return { ...todo, categoryId: categoryId !== null && known.has(categoryId) ? categoryId : null, children };
	});
	return todos && { categories, todos };
}

export class UserTodosFile {
	readonly #file: JsonFile<UserTodoList>;
	#list: UserTodoList;

	constructor(path: string) {
		// The file holds what someone typed, so a file that is not a list moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseList, holds: "a todo list", onInvalid: "aside", indent: "\t" });
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
