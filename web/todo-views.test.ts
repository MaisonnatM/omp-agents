import { describe, expect, test } from "bun:test";
import type { TodoStatus, UserTodo } from "../src/user-todos-shared";
import { moveTo } from "./todo-views";

const todo = (id: string, status: TodoStatus): UserTodo => ({
	id,
	text: id,
	body: "",
	status,
	priority: 0,
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
