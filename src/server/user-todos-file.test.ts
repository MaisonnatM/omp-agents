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

describe("UserTodosFile", () => {
	test("the next server reads the list the last one saved", () => {
		const path = todosPath();
		const first = new UserTodosFile(path);
		expect(first.apply({ op: "add", id: "a", parentId: null, afterId: null, text: "Ship it" })).toBe(true);
		expect(first.apply({ op: "add", id: "b", parentId: "a", afterId: null, text: "Write the docs" })).toBe(true);
		expect(first.apply({ op: "indent", id: "a" })).toBe(false);
		expect(new UserTodosFile(path).todos).toEqual([
			{ id: "a", text: "Ship it", done: false, children: [{ id: "b", text: "Write the docs", done: false }] },
		]);
	});

	test("a file that is not a todo list moves aside instead of being written over", () => {
		const path = todosPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, '{"todos": [{"id": "a", "text": "kept"}]}');
		const file = new UserTodosFile(path);
		expect(file.todos).toEqual([]);
		expect(readFileSync(`${path}.invalid`, "utf8")).toBe('{"todos": [{"id": "a", "text": "kept"}]}');
		expect(existsSync(path)).toBe(false);
	});
});
