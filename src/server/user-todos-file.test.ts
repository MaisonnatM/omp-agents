import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { UserTodosFile } from "./user-todos-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
		expect(first.apply({ op: "add", id: "a", parentId: null, afterId: null, categoryId: "w", text: "Ship it" })).toBe(true);
		expect(first.apply({ op: "add", id: "b", parentId: "a", afterId: null, categoryId: null, text: "Write the docs" })).toBe(true);
		expect(first.apply({ op: "edit-body", id: "a", body: "**Friday**" })).toBe(true);
		expect(first.apply({ op: "indent", id: "a" })).toBe(false);
		expect(new UserTodosFile(path).list).toEqual({
			categories: [{ id: "w", name: "Work" }],
			todos: [
				{ id: "a", text: "Ship it", body: "**Friday**", done: false, categoryId: "w", children: [{ id: "b", text: "Write the docs", body: "", done: false }] },
			],
		});
	});

	test("a list saved before bodies and categories reads with no body and no category, and a missing category reads as none", () => {
		const path = todosPath();
		writeTodos(path, '{"todos": [{"id": "a", "text": "Old", "done": true, "children": [{"id": "a1", "text": "Older", "done": false}]}, {"id": "b", "text": "Lost", "done": false, "categoryId": "gone", "children": []}]}');
		expect(new UserTodosFile(path).list).toEqual({
			categories: [],
			todos: [
				{ id: "a", text: "Old", body: "", done: true, categoryId: null, children: [{ id: "a1", text: "Older", body: "", done: false }] },
				{ id: "b", text: "Lost", body: "", done: false, categoryId: null, children: [] },
			],
		});
		expect(existsSync(`${path}.invalid`)).toBe(false);
	});

	test("a file that is not a todo list moves aside instead of being written over", () => {
		const path = todosPath();
		writeTodos(path, '{"todos": [{"id": "a", "text": "kept"}]}');
		const file = new UserTodosFile(path);
		expect(file.list).toEqual({ categories: [], todos: [] });
		expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"todos": [{"id": "a", "text": "kept"}]}');
		expect(existsSync(path)).toBe(false);
	});
});
