import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { addTodo } from "../user-todos";
import { UserTodosFile } from "./user-todos-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const CREATED = "2026-10-01T08:00:00.000Z";

function todosPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-todos-"));
	dirs.push(dir);
	return join(dir, "omp-agents", "todos.json");
}

function writeTodos(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

describe("UserTodosFile", () => {
	test("the next server reads the list the last one saved", () => {
		const path = todosPath();
		const first = new UserTodosFile(path);
		expect(first.apply({ op: "add-category", id: "w", name: "Work" })).toBe(true);
		expect(first.apply(addTodo({ id: "a", categoryId: "w", text: "Ship it", createdAt: CREATED }))).toBe(true);
		expect(first.apply(addTodo({ id: "b", parentId: "a", text: "Write the docs", priority: 3, createdAt: CREATED }))).toBe(true);
		expect(first.apply({ op: "edit-body", id: "a", body: "**Friday**" })).toBe(true);
		expect(first.apply({ op: "indent", id: "a" })).toBe(false);
		expect(new UserTodosFile(path).list).toEqual({
			categories: [{ id: "w", name: "Work" }],
			todos: [
				{
					id: "a",
					text: "Ship it",
					body: "**Friday**",
					status: "todo",
					priority: 0,
					doneAt: null,
					due: null,
					createdAt: CREATED,
					categoryId: "w",
					children: [{ id: "b", text: "Write the docs", body: "", status: "todo", priority: 3, doneAt: null, due: null, createdAt: CREATED }],
					links: [],
					addedBy: null,
				},
			],
			archive: [],
		});
	});

	test("a list saved before bodies, categories, dates, links, statuses, priorities, and the archive reads with none, a checked todo as Done", () => {
		const path = todosPath();
		writeTodos(
			path,
			'{"todos": [{"id": "a", "text": "Old", "children": [{"id": "a1", "text": "Older", "doneAt": "2026-10-05T09:00:00.000Z"}]}, {"id": "b", "text": "Lost", "categoryId": "gone", "children": []}]}',
		);
		const old = { body: "", priority: 0 as const, due: null, createdAt: null };
		expect(new UserTodosFile(path).list).toEqual({
			categories: [],
			todos: [
				{
					id: "a",
					text: "Old",
					...old,
					status: "todo",
					doneAt: null,
					categoryId: null,
					children: [{ id: "a1", text: "Older", ...old, status: "done", doneAt: "2026-10-05T09:00:00.000Z" }],
					links: [],
					addedBy: null,
				},
				{ id: "b", text: "Lost", ...old, status: "todo", doneAt: null, categoryId: null, children: [], links: [], addedBy: null },
			],
			archive: [],
		});
	});

	test("a status that disagrees with doneAt reads the way doneAt says: an open one drops it, a closed one without it is Todo", () => {
		const path = todosPath();
		const at = "2026-10-05T09:00:00.000Z";
		const stored = [
			{ id: "a", text: "a", status: "in-progress", doneAt: at, children: [] },
			{ id: "b", text: "b", status: "canceled", doneAt: null, children: [] },
			{ id: "c", text: "c", status: "canceled", doneAt: at, priority: 2, createdAt: at, children: [] },
		];
		writeTodos(path, JSON.stringify({ todos: stored }));
		expect(new UserTodosFile(path).list.todos.map(({ id, status, doneAt, priority, createdAt }) => ({ id, status, doneAt, priority, createdAt }))).toEqual([
			{ id: "a", status: "in-progress", doneAt: null, priority: 0, createdAt: null },
			{ id: "b", status: "todo", doneAt: null, priority: 0, createdAt: null },
			{ id: "c", status: "canceled", doneAt: at, priority: 2, createdAt: at },
		]);
		expect(existsSync(`${path}.invalid`)).toBe(false);
	});

	test("a file that is not a todo list moves aside instead of being written over", () => {
		const path = todosPath();
		writeTodos(path, '{"todos": [{"id": "a", "text": "kept"}]}');
		const file = new UserTodosFile(path);
		expect(file.list).toEqual({ categories: [], todos: [], archive: [] });
		expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"todos": [{"id": "a", "text": "kept"}]}');
		expect(existsSync(path)).toBe(false);
	});
});
