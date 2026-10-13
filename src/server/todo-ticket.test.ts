import { describe, expect, test } from "bun:test";
import type { TicketDraft } from "../shared/tickets";
import { addTodo, applyUserTodo } from "../user-todos";
import type { UserTodoChange, UserTodoList } from "../user-todos-shared";
import { createTicketForTodo, type TodoTicketEnv, TodoTicketRefused } from "./todo-ticket";

const TEAM = "6f1c2c8e-3b1a-4f4e-9d3e-0a2b4c6d8e10";

function fakeEnv(changes: UserTodoChange[], options: { during?: UserTodoChange; failChange?: boolean } = {}) {
	let list: UserTodoList = changes.reduce(applyUserTodo, { categories: [], todos: [], archive: [] });
	const drafts: TicketDraft[] = [];
	const env: TodoTicketEnv = {
		list: () => list,
		change: change => {
			if (options.failChange) throw new Error("injected");
			list = applyUserTodo(list, change);
		},
		createTicket: async draft => {
			drafts.push(draft);
			if (options.during) list = applyUserTodo(list, options.during);
			return { identifier: "ENG-7" };
		},
	};
	return { env, drafts, list: () => list };
}

describe("createTicketForTodo", () => {
	test("opens the issue from the todo's title and notes and answers only after the list holds its link", async () => {
		const fake = fakeEnv([addTodo({ id: "a", text: " Ship it ", body: "# Notes\n" })]);
		expect(await createTicketForTodo(fake.env, { todoId: "a", team: TEAM })).toEqual({ identifier: "ENG-7", linked: true });
		expect(fake.drafts).toEqual([{ title: "Ship it", description: "# Notes\n", team: TEAM }]);
		expect(fake.list().todos[0]!.links).toEqual([{ kind: "ticket", identifier: "ENG-7" }]);
	});

	test("answers the issue unlinked when the todo is removed while Linear opens it", async () => {
		const fake = fakeEnv([addTodo({ id: "a", text: "Ship it" })], { during: { op: "remove", id: "a" } });
		const answer = await createTicketForTodo(fake.env, { todoId: "a", team: TEAM });
		expect(answer).toMatchObject({ identifier: "ENG-7", linked: false });
		expect(fake.drafts).toHaveLength(1);
	});

	test("answers the issue unlinked, with the reason, when the list refuses the link", async () => {
		const fake = fakeEnv([addTodo({ id: "a", text: "Ship it" })], { failChange: true });
		expect(await createTicketForTodo(fake.env, { todoId: "a", team: TEAM })).toEqual({ identifier: "ENG-7", linked: false, error: "injected" });
	});

	test("refuses before opening an issue for a missing, sub-, untitled, or already linked todo", async () => {
		const fake = fakeEnv([
			addTodo({ id: "a", text: "Parent" }),
			addTodo({ id: "a1", parentId: "a", text: "Child" }),
			addTodo({ id: "blank", text: "  " }),
			addTodo({ id: "linked", text: "Linked", links: [{ kind: "ticket", identifier: "ENG-1" }] }),
		]);
		for (const todoId of ["missing", "a1", "blank", "linked"]) {
			await expect(createTicketForTodo(fake.env, { todoId, team: TEAM })).rejects.toBeInstanceOf(TodoTicketRefused);
		}
		expect(fake.drafts).toEqual([]);
	});

	test("Linear's refusal throws, and nothing links", async () => {
		const fake = fakeEnv([addTodo({ id: "a", text: "Ship it" })]);
		fake.env.createTicket = () => Promise.reject(new Error("Linear says no"));
		await expect(createTicketForTodo(fake.env, { todoId: "a", team: TEAM })).rejects.toThrow("Linear says no");
		expect(fake.list().todos[0]!.links).toEqual([]);
	});
});
