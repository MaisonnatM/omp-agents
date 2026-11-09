import { describe, expect, test } from "bun:test";
import type { TodoStatus, UserTodo, UserTodoList } from "../src/user-todos-shared";
import { spaces } from "../src/shared/workspaces";
import { inScope, leftIn, moveTo, type TodoScope, todosOf } from "./todo-views";

const todo = (id: string, status: TodoStatus): UserTodo => ({
	id,
	text: id,
	body: "",
	status,
	priority: 0,
	assignee: null,
	doneAt: status === "done" ? "2026-10-05T09:00:00.000Z" : null,
	due: null,
	createdAt: null,
	categoryId: null,
	workspace: null,
	children: [],
	links: [],
	addedBy: null,
});

describe("moveTo", () => {
	const siblings = [todo("a", "todo"), todo("b", "in-progress"), todo("c", "todo"), todo("d", "done")];
	const move = (id: string, position: number) => moveTo({ todo: siblings.find(sibling => sibling.id === id)!, parent: null }, siblings, position, "work");

	test("moves a todo to a place beside one of its own status", () => {
		expect(move("c", 0)).toEqual({ op: "move", id: "c", afterId: null, categoryId: "work" });
		expect(move("a", 2)).toEqual({ op: "move", id: "a", afterId: "c", categoryId: "work" });
	});

	test("refuses a place with no todo of its status on either side", () => {
		expect(move("b", 2)).toBeNull();
		expect(move("d", 1)).toBeNull();
		expect(move("b", 0)).toBeNull();
	});
});

describe("inScope", () => {
	const at = (id: string, workspace: string | null, categoryId: string | null = null): UserTodo => ({ ...todo(id, "todo"), workspace, categoryId });
	const list: UserTodoList = {
		categories: [{ id: "work", name: "Work" }],
		todos: [at("yampa", "/code/yampa", "work"), at("agents", "/code/omp-agents", "work"), at("none", null), at("life", "/home/me/personal"), at("garden", "/code/garden")],
		archive: [at("old-yampa", "/code/yampa"), at("old-none", null), at("old-life", "/home/me/personal")],
	};
	const sessions = { hosts: [], past: [] };
	const placed = spaces(["/code/garden"], { cwd: "/home/me/personal", cwdDisplay: "~/personal" });
	const work = (workspace: string | null): TodoScope => ({ workspace, space: "work", spaces: placed });
	const ids = (view: Parameters<typeof todosOf>[1], scope: TodoScope) => inScope(todosOf(list, view, "2026-10-30", sessions, new Set()), scope).map(({ id }) => id);

	test("a selected workspace keeps only the todos naming it, in every list and the archive", () => {
		expect(ids({ kind: "all" }, work("/code/yampa"))).toEqual(["yampa"]);
		expect(ids({ kind: "category", id: "work" }, work("/code/omp-agents"))).toEqual(["agents"]);
		expect(ids({ kind: "archive" }, work("/code/yampa"))).toEqual(["old-yampa"]);
		expect(leftIn(list, { kind: "all" }, "2026-10-30", sessions, new Set(), work("/code/yampa"))).toBe(1);
		expect(leftIn(list, { kind: "archive" }, "2026-10-30", sessions, new Set(), work("/code/yampa"))).toBe(1);
	});

	test("All of Work shows every Work todo, those naming no workspace included", () => {
		expect(ids({ kind: "all" }, work(null))).toEqual(["yampa", "agents", "none"]);
		expect(ids({ kind: "archive" }, work(null))).toEqual(["old-yampa", "old-none"]);
	});

	test("All of Personal shows the todos of the personal directory and the Personal workspaces", () => {
		const personal: TodoScope = { workspace: null, space: "personal", spaces: placed };
		expect(ids({ kind: "all" }, personal)).toEqual(["life", "garden"]);
		expect(ids({ kind: "archive" }, personal)).toEqual(["old-life"]);
		expect(leftIn(list, { kind: "all" }, "2026-10-30", sessions, new Set(), personal)).toBe(2);
	});
});
