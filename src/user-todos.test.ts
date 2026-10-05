import { describe, expect, test } from "bun:test";
import type { UserTodo, UserTodoChange, UserTodoList } from "./shared";
import { applyUserTodo } from "./user-todos";

const AT = "2026-10-05T09:00:00.000Z";

const todo = (id: string, children: string[] = [], { done = false, categoryId = null }: { done?: boolean; categoryId?: string | null } = {}): UserTodo => ({
	id,
	text: id,
	body: "",
	doneAt: done ? AT : null,
	due: null,
	categoryId,
	children: children.map(child => ({ id: child, text: child, body: "", doneAt: null, due: null })),
	links: [],
	addedBy: null,
});

/** A list with categories named after their ids. */
const listOf = (categories: string[], ...todos: UserTodo[]): UserTodoList => ({ categories: categories.map(id => ({ id, name: id })), todos, archive: [] });

/** The todos as `id@category(child child)` words, which reads their order, nesting, and categories at a glance. */
const words = (todos: UserTodo[]): string =>
	todos
		.map(({ id, doneAt, categoryId, children }) => {
			const kids = children.map(child => child.id + (child.doneAt ? "✓" : "")).join(" ");
			return `${id}${doneAt ? "✓" : ""}${categoryId ? `@${categoryId}` : ""}${kids ? `(${kids})` : ""}`;
		})
		.join(" ");
const shape = ({ todos }: UserTodoList): string => words(todos);
const archived = ({ archive }: UserTodoList): string => words(archive);

const after = (list: UserTodoList, ...changes: UserTodoChange[]): UserTodoList => changes.reduce(applyUserTodo, list);

const add = (id: string, parentId: string | null, afterId: string | null, categoryId: string | null = null): UserTodoChange => ({
	op: "add",
	id,
	parentId,
	afterId,
	categoryId,
	text: id,
});

const check = (id: string): UserTodoChange => ({ op: "toggle", id, doneAt: AT });

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

	test("add keeps the notes, due day, links, and agent it is given, each link once, and none on a todo under another", () => {
		const pr = { kind: "pull-request", owner: "o", repo: "r", number: 7 } as const;
		const list = after(listOf([]), {
			op: "add",
			id: "a",
			parentId: null,
			afterId: null,
			categoryId: null,
			text: "Review",
			body: "See PR",
			due: "2026-10-06",
			links: [pr, { ...pr }],
			addedBy: "s1",
		});
		expect(list.todos[0]).toEqual({ ...todo("a"), text: "Review", body: "See PR", due: "2026-10-06", links: [pr], addedBy: "s1" });
		const child = after(list, { op: "add", id: "c", parentId: "a", afterId: null, categoryId: null, text: "c", links: [pr], addedBy: "s1" });
		expect(child.todos[0]!.children).toEqual([{ id: "c", text: "c", body: "", doneAt: null, due: null }]);
	});

	test("the list never nests three deep: indent refuses a todo with todos, the first one, and one already under another", () => {
		const list = listOf([], todo("a"), todo("b", ["b1"]), todo("c"));
		expect(shape(after(list, { op: "indent", id: "c" }))).toBe("a b(b1 c)");
		expect(shape(after(list, { op: "indent", id: "b" }))).toBe("a b(b1) c");
		expect(shape(after(list, { op: "indent", id: "a" }))).toBe("a b(b1) c");
		expect(shape(after(list, { op: "indent", id: "b1" }))).toBe("a b(b1) c");
	});

	test("indent refuses a todo with links, which a todo under another cannot hold", () => {
		const list = after(listOf([], todo("a"), todo("b")), { op: "link", id: "b", link: { kind: "ticket", identifier: "ENG-1" } });
		expect(shape(after(list, { op: "indent", id: "b" }))).toBe("a b");
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

	test("a todo's body and due day stay with it through edits, indent, and outdent", () => {
		const list = listOf([], todo("a"), todo("b"));
		const edited = after(
			list,
			{ op: "edit-body", id: "b", body: "# Notes\n\n- one" },
			{ op: "edit", id: "b", text: "Bee" },
			{ op: "set-due", id: "b", due: "2026-10-09" },
			{ op: "indent", id: "b" },
		);
		const leaf = { id: "b", text: "Bee", body: "# Notes\n\n- one", doneAt: null, due: "2026-10-09" };
		expect(edited.todos[0]!.children).toEqual([leaf]);
		expect(after(edited, { op: "outdent", id: "b" }).todos[1]).toEqual({ ...leaf, categoryId: null, children: [], links: [], addedBy: null });
	});

	test("checking a top-level todo checks its todos at that time, keeps an earlier check, and unchecking it leaves them", () => {
		const list = after(listOf([], todo("a", ["a1", "a2"])), { op: "toggle", id: "a2", doneAt: "2026-10-01T00:00:00.000Z" });
		const checked = after(list, check("a"));
		expect(shape(checked)).toBe("a✓(a1✓ a2✓)");
		expect(checked.todos[0]!.children.map(child => child.doneAt)).toEqual([AT, "2026-10-01T00:00:00.000Z"]);
		expect(shape(after(checked, { op: "toggle", id: "a", doneAt: null }))).toBe("a(a1✓ a2✓)");
	});

	test("move puts a top-level todo after another, joining its category, or first in a category", () => {
		const list = listOf(["work"], todo("a"), todo("b", [], { categoryId: "work" }), todo("c"), todo("d", [], { categoryId: "work" }));
		expect(shape(after(list, { op: "move", id: "c", afterId: null, categoryId: null }))).toBe("c a b@work d@work");
		expect(shape(after(list, { op: "move", id: "a", afterId: "c", categoryId: null }))).toBe("b@work c a d@work");
		expect(shape(after(list, { op: "move", id: "a", afterId: "b", categoryId: "work" }))).toBe("b@work a@work c d@work");
		expect(shape(after(list, { op: "move", id: "c", afterId: null, categoryId: "work" }))).toBe("a c@work b@work d@work");
	});

	test("move reorders a todo among its parent's todos only", () => {
		const list = listOf([], todo("a", ["a1", "a2", "a3"]), todo("b", ["b1"]));
		expect(shape(after(list, { op: "move", id: "a3", afterId: null, categoryId: null }))).toBe("a(a3 a1 a2) b(b1)");
		expect(shape(after(list, { op: "move", id: "a1", afterId: "a2", categoryId: null }))).toBe("a(a2 a1 a3) b(b1)");
		expect(shape(after(list, { op: "move", id: "a1", afterId: "b1", categoryId: null }))).toBe("a(a1 a2 a3) b(b1)");
	});

	test("restore puts a removed todo back where it was, with its todos, links, and notes", () => {
		const list = after(listOf([], todo("a", ["a1"]), todo("b")), { op: "link", id: "a", link: { kind: "session", sessionId: "s1" } });
		const taken = list.todos[0]!;
		const removed = after(list, { op: "remove", id: "a" });
		expect(after(removed, { op: "restore", todo: taken, parentId: null, afterId: null }).todos).toEqual(list.todos);
		expect(after(removed, { op: "restore", todo: taken, parentId: null, afterId: "b" }).todos).toEqual([list.todos[1]!, taken]);
		const childBack = after(list, { op: "remove", id: "a1" }, { op: "restore", todo: { ...todo("a1"), body: "x" }, parentId: "a", afterId: null });
		expect(childBack.todos[0]!.children).toEqual([{ id: "a1", text: "a1", body: "x", doneAt: null, due: null }]);
		expect(after(list, { op: "restore", todo: taken, parentId: null, afterId: null })).toBe(list);
	});

	test("clear-done archives the checked todos of one category or of all, latest first, a checked child as its own todo", () => {
		const list = listOf(["work"], todo("a", ["a1"]), todo("b", ["b1", "b2"], { categoryId: "work" }), todo("c", [], { done: true }));
		const work = after(list, check("b1"), { op: "clear-done", categoryId: "work" });
		expect(shape(work)).toBe("a(a1) b@work(b2) c✓");
		expect(archived(work)).toBe("b1✓@work");
		const all = after(work, check("a"), { op: "clear-done", categoryId: null });
		expect(shape(all)).toBe("b@work(b2)");
		expect(archived(all)).toBe("c✓ a✓(a1✓) b1✓@work");
	});

	test("an archived todo comes back last, removes on its own, and empty-archive drops them all", () => {
		const list = after(listOf(["work"], todo("a", [], { done: true, categoryId: "work" }), todo("b", [], { done: true }), todo("c")), { op: "clear-done", categoryId: null });
		expect(shape(after(list, { op: "unarchive", id: "a" }))).toBe("c a✓@work");
		expect(shape(after(list, { op: "remove-category", id: "work" }, { op: "unarchive", id: "a" }))).toBe("c a✓");
		expect(archived(after(list, { op: "remove", id: "b" }))).toBe("a✓@work");
		expect(after(list, { op: "empty-archive" }).archive).toEqual([]);
		expect(shape(after(list, add("a", null, null)))).toBe("c");
	});

	test("links stay once each on a top-level todo, and unlink takes one off", () => {
		const ticket = { kind: "ticket", identifier: "ENG-1" } as const;
		const session = { kind: "session", sessionId: "s1" } as const;
		const list = after(listOf([], todo("a", ["a1"])), { op: "link", id: "a", link: ticket }, { op: "link", id: "a", link: session }, { op: "link", id: "a", link: ticket });
		expect(list.todos[0]!.links).toEqual([ticket, session]);
		expect(after(list, { op: "unlink", id: "a", link: ticket }).todos[0]!.links).toEqual([session]);
		expect(after(list, { op: "link", id: "a1", link: ticket })).toBe(list);
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
		const list = listOf(["work"], todo("a", ["a1"], { categoryId: "work" }), todo("b", [], { categoryId: "work" }));
		for (const change of [
			{ op: "edit", id: "gone", text: "x" },
			{ op: "edit", id: "a", text: "a" },
			{ op: "edit-body", id: "gone", body: "x" },
			{ op: "set-due", id: "a", due: null },
			{ op: "indent", id: "a" },
			{ op: "outdent", id: "a" },
			{ op: "clear-done", categoryId: null },
			{ op: "categorize", id: "a", categoryId: "work" },
			{ op: "move", id: "a", afterId: null, categoryId: "work" },
			{ op: "move", id: "b", afterId: "a", categoryId: "work" },
			{ op: "move", id: "a", afterId: "gone", categoryId: "work" },
			{ op: "move", id: "a", afterId: null, categoryId: "gone" },
			{ op: "move", id: "a1", afterId: null, categoryId: null },
			{ op: "unlink", id: "a", link: { kind: "ticket", identifier: "ENG-1" } },
			{ op: "unarchive", id: "a" },
			{ op: "empty-archive" },
			{ op: "add", id: "a1", parentId: null, afterId: null, categoryId: null, text: "again" },
			{ op: "add-category", id: "work", name: "again" },
			{ op: "rename-category", id: "work", name: "work" },
			{ op: "rename-category", id: "gone", name: "x" },
			{ op: "remove-category", id: "gone" },
		] satisfies UserTodoChange[])
			expect(applyUserTodo(list, change)).toBe(list);
	});
});
