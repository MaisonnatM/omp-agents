/** Opening a Linear issue from a todo, then linking it to the todo, as one command whose answer says whether the link was saved. */
import { errorText } from "../json";
import type { TicketDraft, TodoTicketAnswer, TodoTicketRequest } from "../shared/tickets";
import type { UserTodoChange, UserTodoList } from "../user-todos-shared";

/** What {@link createTicketForTodo} reads and writes. */
export interface TodoTicketEnv {
	/** The Todo page's list as the server holds it. */
	list(): UserTodoList;
	/** Applies `change` to the list and sends every socket the list after it. */
	change(change: UserTodoChange): void;
	/** Opens `draft` in Linear and answers its identifier; Linear's refusal throws. */
	createTicket(draft: TicketDraft): Promise<{ identifier: string }>;
}

/** The todo cannot take a new issue, so none was opened. */
export class TodoTicketRefused extends Error {}

const holdsTicket = (list: UserTodoList, todoId: string, identifier: string): boolean =>
	list.todos.find(todo => todo.id === todoId)?.links.some(link => link.kind === "ticket" && link.identifier === identifier) ?? false;

/**
 * Opens a Linear issue from top-level todo `todoId`'s title and notes, assigned to the viewer, then links it to the todo.
 * It throws {@link TodoTicketRefused} before opening anything when the todo is not a top-level todo outside the archive, has no title,
 * or already links an issue; once the issue exists it answers, `linked: false` with the reason when the list does not hold its link.
 */
export async function createTicketForTodo(env: TodoTicketEnv, { todoId, team }: TodoTicketRequest): Promise<TodoTicketAnswer> {
	const todo = env.list().todos.find(entry => entry.id === todoId);
	if (!todo) throw new TodoTicketRefused("That todo is not on the list as a top-level todo outside the archive");
	if (!todo.text.trim()) throw new TodoTicketRefused("A todo without a title cannot open a Linear issue");
	const linked = todo.links.find(link => link.kind === "ticket");
	if (linked) throw new TodoTicketRefused(`This todo already links ${linked.identifier}`);
	const { identifier } = await env.createTicket({ title: todo.text.trim(), description: todo.body, team });
	try {
		env.change({ op: "link", id: todoId, link: { kind: "ticket", identifier } });
	} catch (err) {
		return { identifier, linked: false, error: errorText(err) };
	}
	if (holdsTicket(env.list(), todoId, identifier)) return { identifier, linked: true };
	return { identifier, linked: false, error: "The todo was removed, archived, or moved under another while the issue was opened" };
}
