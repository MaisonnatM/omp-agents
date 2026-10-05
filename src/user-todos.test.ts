import { describe, expect, test } from "bun:test";
import type { UserTodo, UserTodoChange, UserTodoList } from "./shared";
import { applyUserTodo } from "./user-todos";

const todo = (id: string, children: string[] = [], { done = false, categoryId = null }: { done?: boolean; categoryId?: string | null } = {}): UserTodo => ({
	id,
	text: id,
	body: "",
	done,
	categoryId,
	children: children.map(child => ({ id: child, text: child, body: "", done: false })),
});

/** A list with categories named after their ids. */
const listOf = (categories: string[], ...todos: UserTodo[]): UserTodoList => ({ categories: categories.map(id => ({ id, name: id })), todos });

/** The todos as `id@category(child child)` words, which reads their order, nesting, and categories at a glance. */
const shape = ({ todos }: UserTodoList): string =>
	todos
		.map(({ id, done, categoryId, children }) => {
			const kids = children.map(child => child.id + (child.done ? "✓" : "")).join(" ");
			return `${id}${done ? "✓" : ""}${categoryId ? `@${categoryId}` : ""}${kids ? `(${kids})` : ""}`;
		})
		.join(" ");

const after = (list: UserTodoList, ...changes: UserTodoChange[]): UserTodoList => changes.reduce(applyUserTodo, list);

const add = (id: string, parentId: string | null, afterId: string | null, categoryId: string | null = null): UserTodoChange => ({
	op: "add",
	id,
	parentId,
	afterId,
	categoryId,
	text: id,
});

describe("applyUserTodo", () => {
	test("add places a todo after the one it names, last otherwise, and once per id", () => {
		const list = listOf([], todo("a", ["a1"]), todo("b"));
		expect(shape(after(list, add("n", null, "a")))).toBe("a(a1) n b");
		expect(shape(after(list, add("n", "a", null)))).toBe("a(a1 n) b");
		expect(shape(after(list, add("n", null, "gone")))).toBe("a(a1) b n");
		expect(shape(after(list, add("n", null, null), add("n", null, null)))).toBe("a(a1) b n");
		expect(shape(after(list, add("n", "a1", null)))).toBe("a(a1) b");
	});

	test("a new top-level todo goes in the category it names, or in none once that category is gone", () => {
		const list = listOf(["work"], todo("a", [], { categoryId: "work" }));
		expect(shape(after(list, add("n", null, "a", "work")))).toBe("a@work n@work");
		expect(shape(after(list, add("n", null, null, "gone")))).toBe("a@work n");
		expect(shape(after(list, add("n", "a", null, null)))).toBe("a@work(n)");
	});

	test("the list never nests three deep: indent refuses a todo with todos, the first one, and one already under another", () => {
		const list = listOf([], todo("a"), todo("b", ["b1"]), todo("c"));
		expect(shape(after(list, { op: "indent", id: "c" }))).toBe("a b(b1 c)");
		expect(shape(after(list, { op: "indent", id: "b" }))).toBe("a b(b1) c");
		expect(shape(after(list, { op: "indent", id: "a" }))).toBe("a b(b1) c");
		expect(shape(after(list, { op: "indent", id: "b1" }))).toBe("a b(b1) c");
	});

	test("indent goes under the todo above in the same category, skipping todos of other categories", () => {
		const list = listOf(["home", "work"], todo("w1", [], { categoryId: "work" }), todo("h1", [], { categoryId: "home" }), todo("w2", [], { categoryId: "work" }));
		expect(shape(after(list, { op: "indent", id: "w2" }))).toBe("w1@work(w2) h1@home");
		expect(shape(after(list, { op: "indent", id: "h1" }))).toBe("w1@work h1@home w2@work");
	});

	test("outdent moves a todo right after its parent, in its parent's category, and takes the todos below it", () => {
		const list = listOf(["work"], todo("a", ["a1", "a2", "a3"], { categoryId: "work" }), todo("b"));
		expect(shape(after(list, { op: "outdent", id: "a2" }))).toBe("a@work(a1) a2@work(a3) b");
		expect(shape(after(list, { op: "outdent", id: "a" }))).toBe("a@work(a1 a2 a3) b");
	});

	test("a todo's body stays with it through edits, indent, and outdent", () => {
		const list = listOf([], todo("a"), todo("b"));
		const edited = after(list, { op: "edit-body", id: "b", body: "# Notes\n\n- one" }, { op: "edit", id: "b", text: "Bee" }, { op: "indent", id: "b" });
		expect(edited.todos[0]!.children).toEqual([{ id: "b", text: "Bee", body: "# Notes\n\n- one", done: false }]);
		expect(after(edited, { op: "outdent", id: "b" }).todos[1]).toEqual({ id: "b", text: "Bee", body: "# Notes\n\n- one", done: false, categoryId: null, children: [] });
	});

	test("checking a top-level todo checks its todos, and unchecking it leaves them", () => {
		const list = listOf([], todo("a", ["a1", "a2"]));
		expect(shape(after(list, { op: "toggle", id: "a", done: true }))).toBe("a✓(a1✓ a2✓)");
		expect(shape(after(list, { op: "toggle", id: "a", done: true }, { op: "toggle", id: "a", done: false }))).toBe("a(a1✓ a2✓)");
		expect(shape(after(list, { op: "toggle", id: "a2", done: true }))).toBe("a(a1 a2✓)");
	});

	test("remove takes a todo's todos with it, and clear-done removes the checked todos of one category or of all", () => {
		const list = listOf(["work"], todo("a", ["a1"]), todo("b", ["b1", "b2"], { categoryId: "work" }), todo("c", [], { done: true }));
		expect(shape(after(list, { op: "remove", id: "a" }))).toBe("b@work(b1 b2) c✓");
		expect(shape(after(list, { op: "remove", id: "b2" }))).toBe("a(a1) b@work(b1) c✓");
		expect(shape(after(list, { op: "toggle", id: "b1", done: true }, { op: "clear-done", categoryId: "work" }))).toBe("a(a1) b@work(b2) c✓");
		expect(shape(after(list, { op: "toggle", id: "b1", done: true }, { op: "clear-done", categoryId: null }))).toBe("a(a1) b@work(b2)");
	});

	test("categorize moves a top-level todo, with its todos, to the end of the category it joins", () => {
		const list = listOf(["home", "work"], todo("a", ["a1"]), todo("b", [], { categoryId: "work" }), todo("c"));
		expect(shape(after(list, { op: "categorize", id: "a", categoryId: "work" }))).toBe("b@work c a@work(a1)");
		expect(shape(after(list, { op: "categorize", id: "b", categoryId: null }))).toBe("a(a1) c b");
		expect(shape(after(list, { op: "categorize", id: "a1", categoryId: "work" }))).toBe("a(a1) b@work c");
		expect(shape(after(list, { op: "categorize", id: "a", categoryId: "gone" }))).toBe("a(a1) b@work c");
	});

	test("categories are added once per id and renamed, and removing one leaves its todos in no category", () => {
		const list = listOf(["work"], todo("a", [], { categoryId: "work" }), todo("b"));
		const added = after(list, { op: "add-category", id: "home", name: "Home" }, { op: "add-category", id: "home", name: "Again" });
		expect(added.categories).toEqual([
			{ id: "work", name: "work" },
			{ id: "home", name: "Home" },
		]);
		expect(after(added, { op: "rename-category", id: "work", name: "Job" }).categories[0]).toEqual({ id: "work", name: "Job" });
		const removed = after(added, { op: "remove-category", id: "work" });
		expect(removed.categories).toEqual([{ id: "home", name: "Home" }]);
		expect(shape(removed)).toBe("a b");
	});

	test("a change that changes nothing returns the same list", () => {
		const list = listOf(["work"], todo("a", ["a1"], { categoryId: "work" }));
		for (const change of [
			{ op: "edit", id: "gone", text: "x" },
			{ op: "edit-body", id: "gone", body: "x" },
			{ op: "indent", id: "a" },
			{ op: "outdent", id: "a" },
			{ op: "clear-done", categoryId: null },
			{ op: "categorize", id: "a", categoryId: "work" },
			{ op: "add", id: "a1", parentId: null, afterId: null, categoryId: null, text: "again" },
			{ op: "add-category", id: "work", name: "again" },
			{ op: "rename-category", id: "work", name: "work" },
			{ op: "rename-category", id: "gone", name: "x" },
			{ op: "remove-category", id: "gone" },
		] satisfies UserTodoChange[])
			expect(applyUserTodo(list, change)).toBe(list);
	});
});
