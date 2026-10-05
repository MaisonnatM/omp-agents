/** The Todo page's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";
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

function load(path: string): UserTodoList {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
		return EMPTY;
	}
	try {
		const list = parseList(JSON.parse(text));
		if (list) return list;
	} catch {}
	// The file holds what someone typed, so it moves aside rather than being written over.
	const aside = `${path}.invalid`;
	try {
		renameSync(path, aside);
		console.error(`omp-agents: ${path} is not a todo list; moved it to ${aside}`);
	} catch (err) {
		console.error(`omp-agents: ${path} is not a todo list, and cannot move it aside: ${errorText(err)}`);
	}
	return EMPTY;
}

export class UserTodosFile {
	readonly #path: string;
	#list: UserTodoList;

	constructor(path: string) {
		this.#path = path;
		this.#list = load(path);
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

	/** Written beside and renamed over the file, so a crash mid-write leaves the last complete list. */
	#save(): void {
		const temp = `${this.#path}.tmp`;
		try {
			mkdirSync(dirname(this.#path), { recursive: true });
			writeFileSync(temp, `${JSON.stringify(this.#list, null, "\t")}\n`);
			renameSync(temp, this.#path);
		} catch (err) {
			console.error(`omp-agents: cannot write ${this.#path}: ${errorText(err)}`);
		}
	}
}
