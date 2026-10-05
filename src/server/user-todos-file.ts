/** The Todo page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { JsonFile } from "../fs";
import { isObject } from "../json";
import type { UserTodo, UserTodoCategory, UserTodoChange, UserTodoLeaf, UserTodoLink, UserTodoList } from "../shared";
import { applyUserTodo } from "../user-todos";

const EMPTY: UserTodoList = { categories: [], todos: [], archive: [] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isOptional = (value: unknown, is: (value: unknown) => boolean): boolean => value === null || is(value);
const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value);
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseTodoLink(value: unknown): UserTodoLink | null {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "session":
			return isString(value.sessionId) ? { kind: "session", sessionId: value.sessionId } : null;
		case "pull-request": {
			const { owner, repo, number } = value;
			return isString(owner) && isString(repo) && typeof number === "number" && Number.isSafeInteger(number) && number > 0
				? { kind: "pull-request", owner, repo, number }
				: null;
		}
		case "ticket":
			return isString(value.identifier) ? { kind: "ticket", identifier: value.identifier } : null;
		default:
			return null;
	}
}

/**
 * A file written before todos had a body, a due day, or a check time reads each as having none; a todo checked then
 * reads as checked at `loadedAt`.
 */
function parseLeaf(value: unknown, loadedAt: string): UserTodoLeaf | null {
	if (!isObject(value)) return null;
	const { id, text, body = "", due = null } = value;
	const doneAt = "doneAt" in value ? value.doneAt : value.done === true ? loadedAt : value.done === false ? null : undefined;
	if (typeof id !== "string" || typeof text !== "string" || typeof body !== "string" || !isOptional(due, isDay) || !isOptional(doneAt, isTime)) return null;
	return { id, text, body, doneAt: doneAt as string | null, due: due as string | null };
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

/** A top-level todo, as the file or a `restore` holds one; one from before categories, links, or agents has none of them. */
export function parseTodo(raw: unknown, loadedAt = new Date().toISOString()): UserTodo | null {
	const todo = parseLeaf(raw, loadedAt);
	if (!todo || !isObject(raw)) return null;
	const children = parseAll(raw.children, child => parseLeaf(child, loadedAt));
	const links = parseAll(raw.links ?? [], parseTodoLink);
	const { categoryId = null, addedBy = null } = raw;
	if (!children || !links || !isOptional(categoryId, isString) || !isOptional(addedBy, isString)) return null;
	return { ...todo, categoryId: categoryId as string | null, children, links, addedBy: addedBy as string | null };
}

/** The list a file holds, `null` when it holds none. A file written before categories or the archive reads as having none of either. */
export function parseUserTodoList(value: unknown): UserTodoList | null {
	if (!isObject(value)) return null;
	const categories = parseAll(value.categories ?? [], parseCategory);
	if (!categories) return null;
	const known = new Set(categories.map(category => category.id));
	const loadedAt = new Date().toISOString();
	const parseKnown = (raw: unknown): UserTodo | null => {
		const todo = parseTodo(raw, loadedAt);
		return todo && { ...todo, categoryId: todo.categoryId !== null && known.has(todo.categoryId) ? todo.categoryId : null };
	};
	const todos = parseAll(value.todos, parseKnown);
	const archive = parseAll(value.archive ?? [], parseKnown);
	return todos && archive && { categories, todos, archive };
}

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
