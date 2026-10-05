/** The Todo tab's list, kept in a file so that every window of the dashboard, and the next server, shows the same one. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { errorText, isObject } from "../json";
import type { UserTodo, UserTodoChange, UserTodoLeaf } from "../shared";
import { applyUserTodo } from "../user-todos";

const isLeaf = (value: unknown): value is UserTodoLeaf =>
	isObject(value) && typeof value.id === "string" && typeof value.text === "string" && typeof value.done === "boolean";

const isTodos = (value: unknown): value is UserTodo[] =>
	Array.isArray(value) && value.every((todo: unknown) => isObject(todo) && Array.isArray(todo.children) && todo.children.every(isLeaf) && isLeaf(todo));

function load(path: string): UserTodo[] {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		if (!(isObject(err) && err.code === "ENOENT")) console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
		return [];
	}
	try {
		const value: unknown = JSON.parse(text);
		if (isObject(value) && isTodos(value.todos)) return value.todos;
	} catch {}
	// The file holds what someone typed, so it moves aside rather than being written over.
	const aside = `${path}.invalid`;
	try {
		renameSync(path, aside);
		console.error(`omp-agents: ${path} is not a todo list; moved it to ${aside}`);
	} catch (err) {
		console.error(`omp-agents: ${path} is not a todo list, and cannot move it aside: ${errorText(err)}`);
	}
	return [];
}

export class UserTodosFile {
	readonly #path: string;
	#todos: UserTodo[];

	constructor(path: string) {
		this.#path = path;
		this.#todos = load(path);
	}

	get todos(): UserTodo[] {
		return this.#todos;
	}

	/** Applies `change` and saves the list; whether it changed. */
	apply(change: UserTodoChange): boolean {
		const next = applyUserTodo(this.#todos, change);
		if (next === this.#todos) return false;
		this.#todos = next;
		this.#save();
		return true;
	}

	/** Written beside and renamed over the file, so a crash mid-write leaves the last complete list. */
	#save(): void {
		const temp = `${this.#path}.tmp`;
		try {
			mkdirSync(dirname(this.#path), { recursive: true });
			writeFileSync(temp, `${JSON.stringify({ todos: this.#todos }, null, "\t")}\n`);
			renameSync(temp, this.#path);
		} catch (err) {
			console.error(`omp-agents: cannot write ${this.#path}: ${errorText(err)}`);
		}
	}
}
