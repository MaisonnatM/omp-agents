import { describe, expect, test } from "bun:test";
import type { UserTodo, UserTodoChange } from "./shared";
import { applyUserTodo } from "./user-todos";

const todo = (id: string, children: string[] = [], done = false): UserTodo => ({
	id,
	text: id,
	done,
	children: children.map(child => ({ id: child, text: child, done: false })),
});

/** The list as `id(child child)` words, which reads its order and nesting at a glance. */
const shape = (todos: UserTodo[]): string =>
	todos.map(({ id, done, children }) => `${id}${done ? "✓" : ""}${children.length ? `(${children.map(child => child.id + (child.done ? "✓" : "")).join(" ")})` : ""}`).join(" ");

const after = (todos: UserTodo[], ...changes: UserTodoChange[]): string => shape(changes.reduce(applyUserTodo, todos));

describe("applyUserTodo", () => {
	test("add places a todo after the one it names, last otherwise, and once per id", () => {
		const list = [todo("a", ["a1"]), todo("b")];
		expect(after(list, { op: "add", id: "n", parentId: null, afterId: "a", text: "n" })).toBe("a(a1) n b");
		expect(after(list, { op: "add", id: "n", parentId: "a", afterId: null, text: "n" })).toBe("a(a1 n) b");
		expect(after(list, { op: "add", id: "n", parentId: null, afterId: "gone", text: "n" })).toBe("a(a1) b n");
		expect(after(list, { op: "add", id: "n", parentId: null, afterId: null, text: "n" }, { op: "add", id: "n", parentId: null, afterId: null, text: "n" })).toBe("a(a1) b n");
		expect(after(list, { op: "add", id: "n", parentId: "a1", afterId: null, text: "n" })).toBe("a(a1) b");
	});

	test("the list never nests three deep: indent refuses a todo with todos, the first one, and one already under another", () => {
		const list = [todo("a"), todo("b", ["b1"]), todo("c")];
		expect(after(list, { op: "indent", id: "c" })).toBe("a b(b1 c)");
		expect(after(list, { op: "indent", id: "b" })).toBe("a b(b1) c");
		expect(after(list, { op: "indent", id: "a" })).toBe("a b(b1) c");
		expect(after(list, { op: "indent", id: "b1" })).toBe("a b(b1) c");
	});

	test("outdent moves a todo right after its parent and takes the todos below it, so the list reads the same", () => {
		const list = [todo("a", ["a1", "a2", "a3"]), todo("b")];
		expect(after(list, { op: "outdent", id: "a2" })).toBe("a(a1) a2(a3) b");
		expect(after(list, { op: "outdent", id: "a" })).toBe("a(a1 a2 a3) b");
	});

	test("checking a top-level todo checks its todos, and unchecking it leaves them", () => {
		const list = [todo("a", ["a1", "a2"])];
		expect(after(list, { op: "toggle", id: "a", done: true })).toBe("a✓(a1✓ a2✓)");
		expect(after(list, { op: "toggle", id: "a", done: true }, { op: "toggle", id: "a", done: false })).toBe("a(a1✓ a2✓)");
		expect(after(list, { op: "toggle", id: "a2", done: true })).toBe("a(a1 a2✓)");
	});

	test("remove takes a todo's todos with it, and clear-done removes every checked todo", () => {
		const list = [todo("a", ["a1"]), todo("b", ["b1", "b2"]), todo("c", [], true)];
		expect(after(list, { op: "remove", id: "a" })).toBe("b(b1 b2) c✓");
		expect(after(list, { op: "remove", id: "b2" })).toBe("a(a1) b(b1) c✓");
		expect(after(list, { op: "toggle", id: "b1", done: true }, { op: "clear-done" })).toBe("a(a1) b(b2)");
	});

	test("a change that changes nothing returns the same list", () => {
		const list = [todo("a", ["a1"])];
		for (const change of [
			{ op: "edit", id: "gone", text: "x" },
			{ op: "indent", id: "a" },
			{ op: "outdent", id: "a" },
			{ op: "clear-done" },
			{ op: "add", id: "a1", parentId: null, afterId: null, text: "again" },
		] satisfies UserTodoChange[])
			expect(applyUserTodo(list, change)).toBe(list);
	});
});
