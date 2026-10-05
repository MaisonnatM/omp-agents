/**
 * The changes omp's `user_todo` tool leaves for the Todo page's list, one JSON file each in a directory, so the server
 * stays the only writer of `todos.json` and a session can file a todo while the dashboard is down. An agent may add a
 * todo or check one; the inbox sets aside any other change, unchecking included, so it cannot undo what you did.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { errorText } from "../json";
import type { UserTodoChange } from "../shared";
import { parseTodoChange } from "../user-todos-parse";

export class TodoInbox {
	readonly #dir: string;
	readonly #apply: (change: UserTodoChange) => void;

	constructor(dir: string, apply: (change: UserTodoChange) => void) {
		this.#dir = dir;
		this.#apply = apply;
	}

	/** Applies every change waiting, oldest name first, and deletes its file; one that is not a change an agent may make moves to `<name>.invalid`. */
	drain(): void {
		let names: string[];
		try {
			names = readdirSync(this.#dir).filter(name => name.endsWith(".json")).sort();
		} catch {
			return;
		}
		for (const name of names) {
			const path = join(this.#dir, name);
			let change: UserTodoChange | null = null;
			let why = "it is not a change to the todo list";
			try {
				change = parseTodoChange(JSON.parse(readFileSync(path, "utf8")));
			} catch (err) {
				why = errorText(err);
			}
			if (change && (change.op === "add" || (change.op === "toggle" && change.doneAt !== null))) {
				this.#apply(change);
				rmSync(path, { force: true });
				continue;
			}
			if (change) why = `an agent may only add or check a todo, not ${change.op === "toggle" ? "uncheck one" : change.op}`;
			console.error(`omp-agents: set aside ${path}: ${why}`);
			renameSync(path, `${path}.invalid`);
		}
	}

	/** Drains now and on every change to the directory, which it creates. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		watch(this.#dir, () => this.drain());
		this.drain();
	}
}
