import { describe, expect, test } from "bun:test";
import type { TodoStatus, UserTodo } from "../src/user-todos-shared";
import { latestTodo, moveTo } from "./todo-views";

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

describe("latestTodo", () => {
	const added = (id: string, status: TodoStatus, createdAt: string | null): UserTodo => ({ ...todo(id, status), createdAt });

	test("opens the open todo added last, past a closed one added later and one with no date", () => {
		const todos = [
			added("old", "todo", "2026-10-01T09:00:00.000Z"),
			added("closed", "done", "2026-10-09T09:00:00.000Z"),
			added("undated", "todo", null),
			added("new", "in-progress", "2026-10-05T09:00:00.000Z"),
			added("canceled", "canceled", "2026-10-08T09:00:00.000Z"),
		];
		expect(latestTodo(todos)?.id).toBe("new");
	});

	test("opens the first todo when no open one has a date, and nothing in an empty list", () => {
		expect(latestTodo([added("closed", "done", "2026-10-09T09:00:00.000Z"), added("undated", "todo", null)])?.id).toBe("closed");
		expect(latestTodo([])).toBeUndefined();
	});
});
