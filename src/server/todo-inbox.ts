/**
 * The changes omp's `user_todo` tool leaves for the Todo page's list, one JSON file each in a directory, so the server
 * stays the only writer of `todos.json` and a session can file a todo while the dashboard is down. An agent may add a
 * todo or check one; the inbox drops any other change, so it cannot remove what you wrote.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch } from "node:fs";
import { join } from "node:path";
import { errorText } from "../json";
import type { UserTodoChange } from "../shared";
import { parseTodoChange } from "./wire";

const AGENT_OPS: Partial<Record<UserTodoChange["op"], true>> = { add: true, toggle: true };

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
			try {
				const parsed = parseTodoChange(JSON.parse(readFileSync(path, "utf8")));
				change = parsed && AGENT_OPS[parsed.ok.op] ? parsed.ok : null;
			} catch (err) {
				console.error(`omp-agents: cannot read ${path}: ${errorText(err)}`);
			}
			if (change) {
				this.#apply(change);
				rmSync(path, { force: true });
			} else renameSync(path, `${path}.invalid`);
		}
	}

	/** Drains now and on every change to the directory, which it creates. */
	watch(): void {
		mkdirSync(this.#dir, { recursive: true });
		watch(this.#dir, () => this.drain());
		this.drain();
	}
}
