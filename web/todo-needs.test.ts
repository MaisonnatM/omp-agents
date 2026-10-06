import { expect, test } from "bun:test";
import type { UserTodo, UserTodoList } from "../src/user-todos-shared";
import { hashForTodo, routeFromHash } from "./routing";
import { leftIn, todosOf } from "./todo-views";

const todo = (id: string, doneAt: string | null = null): UserTodo => ({
	id, text: id, body: "", doneAt, due: null, categoryId: null, children: [], addedBy: null,
	links: [{ kind: "session", sessionId: id }],
});
const list: UserTodoList = { categories: [], archive: [], todos: [todo("question"), todo("idle"), todo("running"), todo("checked", "2026-10-05T00:00:00Z")] };
const sessions = {
	hosts: [
		{ sessionId: "question", status: "needs-input" as const, requests: [], pullRequests: [], ship: null },
		{ sessionId: "idle", status: "idle" as const, requests: [], pullRequests: [], ship: null },
		{ sessionId: "running", status: "working" as const, requests: [], pullRequests: [], ship: null },
		{ sessionId: "checked", status: "idle" as const, requests: [], pullRequests: [], ship: null },
	],
	past: [],
};

test("Needs you lists only unchecked todos whose latest session waits on the human", () => {
	const view = { kind: "needs" } as const;
	expect(todosOf(list, view, "2026-10-06", sessions).map(todo => todo.id)).toEqual(["question", "idle"]);
	expect(leftIn(list, view, "2026-10-06", sessions)).toBe(2);
	expect(routeFromHash(hashForTodo(view))).toEqual({ kind: "page", page: { kind: "todo", list: view } });
});
