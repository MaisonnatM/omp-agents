import { createTicket } from "../tickets";
import { checked, fail } from "./http";
import { createTicketForTodo, type TodoTicketEnv, TodoTicketRefused } from "./todo-ticket";
import { parseTodoTicket } from "./wire";
import type { RouteKit, Routes } from "./route-kit";

/** What the todo routes read and write: the Todo page's list. */
export type TodoRoutesEnv = Omit<TodoTicketEnv, "createTicket">;

/** The Linear issue a todo opens and links. */
export function todoRoutes({ write }: RouteKit, env: TodoRoutesEnv): Routes {
	/** `PUT /api/todo/ticket`: `TodoTicketRequest`; answers `TodoTicketAnswer` once the todo list holds the issue's link or could not. */
	const todoTicket = write(
		(body) => checked(parseTodoTicket(body), "Expected { todoId, team } naming a todo and a Linear team by id"),
		(request) => createTicketForTodo({ ...env, createTicket }, request),
		(err) => (err instanceof TodoTicketRefused ? fail(409, err.message) : null),
	);
	return { "/api/todo/ticket": { PUT: todoTicket } };
}
