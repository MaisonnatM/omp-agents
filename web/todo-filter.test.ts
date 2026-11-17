import { describe, expect, test } from "bun:test";
import { NO_CATEGORY, type UserTodo } from "../src/user-todos-shared";
import {
	categoryOptions,
	decodeDisplay,
	decodeFilter,
	DEFAULT_DISPLAY,
	encodeFilter,
	groupTodos,
	keepsTodo,
	linkOptions,
	NO_FILTER,
	soleCategory,
	type TodoFilter,
	withLiveCategories,
} from "./todo-filter";

const todo = (id: string, fields: Partial<UserTodo> = {}): UserTodo => ({
	id,
	text: id,
	body: "",
	status: "todo",
	priority: 0,
	assignee: null,
	doneAt: null,
	due: null,
	createdAt: null,
	categoryId: null,
	workspace: null,
	children: [],
	links: [],
	addedBy: null,
	...fields,
});

const DAY = "2026-11-16";
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const keeps = (item: UserTodo, change: Partial<TodoFilter>): boolean => keepsTodo(item, { ...NO_FILTER, ...change }, DAY, NOW);

describe("keepsTodo", () => {
	test("keeps every todo with no filter", () => {
		expect(keeps(todo("a"), {})).toBe(true);
	});

	test("keeps the checked categories, No category for a todo in none", () => {
		expect(keeps(todo("a", { categoryId: "work" }), { categories: new Set(["work", "home"]) })).toBe(true);
		expect(keeps(todo("a", { categoryId: "home" }), { categories: new Set(["work"]) })).toBe(false);
		expect(keeps(todo("a"), { categories: new Set([NO_CATEGORY]) })).toBe(true);
		expect(keeps(todo("a"), { categories: new Set(["work"]) })).toBe(false);
		expect(keeps(todo("a", { categoryId: "work" }), { categories: new Set([NO_CATEGORY]) })).toBe(false);
	});

	test("keeps the checked priorities and assignees; a todo with no assignee passes no assignee filter", () => {
		expect(keeps(todo("a", { priority: 1 }), { priorities: new Set(["1", "2"]) })).toBe(true);
		expect(keeps(todo("a", { priority: 0 }), { priorities: new Set(["1"]) })).toBe(false);
		expect(keeps(todo("a", { assignee: "agent" }), { assignees: new Set(["agent"]) })).toBe(true);
		expect(keeps(todo("a"), { assignees: new Set(["user", "agent"]) })).toBe(false);
	});

	test("keeps a todo carrying a link of any checked kind", () => {
		const linked = todo("a", { links: [{ kind: "pull-request", owner: "o", repo: "r", number: 1 }] });
		expect(keeps(linked, { links: new Set(["pull-request", "session"]) })).toBe(true);
		expect(keeps(linked, { links: new Set(["session"]) })).toBe(false);
	});

	test("keeps a todo due within the next days, overdue included, by its earliest open due day", () => {
		expect(keeps(todo("a", { due: "2026-11-10" }), { due: 1 })).toBe(true);
		expect(keeps(todo("a", { due: "2026-11-17" }), { due: 1 })).toBe(true);
		expect(keeps(todo("a", { due: "2026-11-18" }), { due: 1 })).toBe(false);
		expect(keeps(todo("a"), { due: 30 })).toBe(false);
		const child = { ...todo("c", { due: "2026-11-17" }) };
		expect(keeps(todo("a", { due: "2026-12-30", children: [child] }), { due: 3 })).toBe(true);
	});

	test("keeps a todo added within the last days; one with no creation time passes no Created", () => {
		expect(keeps(todo("a", { createdAt: "2026-11-14T12:00:00.000Z" }), { created: 3 })).toBe(true);
		expect(keeps(todo("a", { createdAt: "2026-11-12T12:00:00.000Z" }), { created: 3 })).toBe(false);
		expect(keeps(todo("a"), { created: 30 })).toBe(false);
	});
});

describe("stored filter and display", () => {
	test("round-trips a filter", () => {
		const filter: TodoFilter = { categories: new Set(["work", NO_CATEGORY]), priorities: new Set(["1"]), assignees: new Set(["user"]), links: new Set(["session"]), due: 7, created: 3 };
		expect(decodeFilter(encodeFilter(filter))).toEqual(filter);
	});

	test("falls back part by part on unreadable values", () => {
		expect(decodeFilter(null)).toEqual(NO_FILTER);
		expect(decodeFilter("not json")).toEqual(NO_FILTER);
		expect(decodeFilter(JSON.stringify({ categories: ["", "work"], priorities: ["9", "2"], assignees: "user", links: ["ticket"], due: 5, created: 14 }))).toEqual({
			...NO_FILTER,
			categories: new Set(["", "work"]),
			priorities: new Set(["2"]),
			created: 14,
		});
		expect(decodeFilter(JSON.stringify({ categories: "work" }))).toEqual(NO_FILTER);
		expect(decodeFilter(JSON.stringify({ categories: [1, "work"] }))).toEqual(NO_FILTER);
		expect(decodeDisplay(JSON.stringify({ grouping: "label" }))).toEqual(DEFAULT_DISPLAY);
		expect(decodeDisplay(JSON.stringify({ grouping: "priority" }))).toEqual({ grouping: "priority" });
	});
});

describe("linkOptions", () => {
	test("offers the kinds the todos carry, with counts, and a checked kind none carries", () => {
		const todos = [todo("a", { links: [{ kind: "session", sessionId: "s" }] }), todo("b", { links: [{ kind: "session", sessionId: "t" }] })];
		expect(linkOptions(todos, new Set(["pull-request"]))).toEqual([
			{ key: "session", label: "Session", count: 2 },
			{ key: "pull-request", label: "Pull request", count: 0 },
		]);
	});
});

describe("categories", () => {
	const categories = [
		{ id: "work", name: "Work" },
		{ id: "home", name: "Home" },
	];
	const only = (keys: string[]): TodoFilter => ({ ...NO_FILTER, categories: new Set(keys) });

	test("offers No category first, then each category with its todos counted, empty ones too, and nothing while there is no category", () => {
		const todos = [todo("a", { categoryId: "work" }), todo("b"), todo("c", { categoryId: "work" })];
		expect(categoryOptions(todos, categories)).toEqual([
			{ key: NO_CATEGORY, label: "No category", count: 1 },
			{ key: "work", label: "Work", count: 2 },
			{ key: "home", label: "Home", count: 0 },
		]);
		expect(categoryOptions(todos, [])).toEqual([]);
	});

	test("a deleted category, and No category once none is left, leave the filter, so it never empties the list", () => {
		expect(withLiveCategories(only(["work", "gone"]), categories).categories).toEqual(new Set(["work"]));
		expect(withLiveCategories(only(["gone"]), categories)).toEqual(NO_FILTER);
		expect(withLiveCategories(only([NO_CATEGORY]), categories).categories).toEqual(new Set([NO_CATEGORY]));
		expect(withLiveCategories(only([NO_CATEGORY]), [])).toEqual(NO_FILTER);
		const live = only(["home"]);
		expect(withLiveCategories(live, categories)).toBe(live);
	});

	test("a todo added to the list joins the one category the filter keeps, and none under several or No category", () => {
		expect(soleCategory(new Set(["work"]))).toBe("work");
		expect(soleCategory(new Set())).toBeNull();
		expect(soleCategory(new Set(["work", "home"]))).toBeNull();
		expect(soleCategory(new Set([NO_CATEGORY]))).toBeNull();
		expect(soleCategory(new Set([NO_CATEGORY, "work"]))).toBeNull();
	});
});

describe("groupTodos", () => {
	const todos = [todo("a", { priority: 3, assignee: "agent" }), todo("b", { priority: 1, status: "done" }), todo("c", { priority: 3, assignee: "user" })];

	test("by status keeps every status, empty ones too, in list order", () => {
		const groups = groupTodos("status", todos);
		expect(groups.map(group => group.key)).toEqual(["in-progress", "todo", "backlog", "done", "canceled"]);
		expect(groups[1]!.todos.map(item => item.id)).toEqual(["a", "c"]);
	});

	test("by priority puts Urgent first and leaves out empty priorities", () => {
		expect(groupTodos("priority", todos).map(group => [group.key, group.todos.map(item => item.id)])).toEqual([
			[1, ["b"]],
			[3, ["a", "c"]],
		]);
	});

	test("by assignee lists You, Agent, then no one", () => {
		expect(groupTodos("assignee", todos).map(group => group.key)).toEqual(["user", "agent", null]);
	});

	test("no grouping is one group, and none for no todo", () => {
		expect(groupTodos("none", todos).map(group => group.todos.length)).toEqual([3]);
		expect(groupTodos("none", [])).toEqual([]);
	});

	test("fold keys keep a status's own key and never collide across groupings", () => {
		const keys = [...groupTodos("status", todos), ...groupTodos("priority", todos), ...groupTodos("assignee", todos)].map(({ foldKey }) => foldKey);
		expect(keys).toContain("done");
		expect(keys).toContain("priority:1");
		expect(keys).toContain("assignee:none");
		expect(new Set(keys).size).toBe(keys.length);
	});
});
