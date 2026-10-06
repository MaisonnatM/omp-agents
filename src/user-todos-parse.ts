/**
 * Reading the Todo page's list and its changes from untyped JSON: `todos.json`, the page's `user-todo` messages, and
 * the files omp's `user_todo` tool leaves. It uses no Bun API, so the desktop shell bundles it too.
 */
import { isObject } from "./json";
import { inStatusOrder } from "./user-todos";
import type { UserTodo, UserTodoCategory, UserTodoChange, UserTodoLeaf, UserTodoLink, UserTodoList } from "./user-todos-shared";

/** The longest todo title, category name, and id the server takes in a change, and the longest todo body. */
export const MAX_TODO_TEXT = 2000;
export const MAX_TODO_ID = 64;
export const MAX_TODO_BODY = 100_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day as `YYYY-MM-DD`, as a todo's `due`, a Linear issue's `dueDate`, and an all-day Google event name one, that the calendar has. */
export const isDay = (value: unknown): value is string => {
	if (typeof value !== "string" || !DAY.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
};

const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function isOptional<T>(value: unknown, is: (value: unknown) => value is T): value is T | null {
	return value === null || is(value);
}

/** What a todo's strings must be. The file takes any it holds; a change from a page or an agent is held to the limits. */
interface Fields {
	id: (value: unknown) => value is string;
	text: (value: unknown) => value is string;
	body: (value: unknown) => value is string;
}

const isString = (value: unknown): value is string => typeof value === "string";

const STORED: Fields = { id: isString, text: isString, body: isString };

/** A todo or category id a change names: not blank, within `MAX_TODO_ID`. */
export const isTodoId = (value: unknown): value is string => isNonEmpty(value) && value.length <= MAX_TODO_ID;

const SENT: Fields = {
	id: isTodoId,
	text: (value): value is string => typeof value === "string" && value.length <= MAX_TODO_TEXT,
	body: (value): value is string => typeof value === "string" && value.length <= MAX_TODO_BODY,
};

export function parseTodoLink(value: unknown): UserTodoLink | null {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "session":
			return isNonEmpty(value.sessionId) ? { kind: "session", sessionId: value.sessionId } : null;
		case "pull-request": {
			const { owner, repo, number } = value;
			return isNonEmpty(owner) && isNonEmpty(repo) && typeof number === "number" && Number.isSafeInteger(number) && number > 0
				? { kind: "pull-request", owner, repo, number }
				: null;
		}
		case "ticket":
			return isNonEmpty(value.identifier) ? { kind: "ticket", identifier: value.identifier } : null;
		default:
			return null;
	}
}

/** Every entry of `values` through `parse`, or `null` when one does not parse. */
function parseAll<T>(values: unknown, parse: (value: unknown) => T | null): T[] | null {
	if (!Array.isArray(values)) return null;
	const parsed: T[] = [];
	for (const value of values) {
		const entry = parse(value);
		if (entry === null) return null;
		parsed.push(entry);
	}
	return parsed;
}

/** A file written before todos had a body or a due day reads each as having none. */
function parseLeaf(value: unknown, fields: Fields): UserTodoLeaf | null {
	if (!isObject(value)) return null;
	const { id, text, body = "", due = null, doneAt = null } = value;
	if (!fields.id(id) || !fields.text(text) || !fields.body(body) || !isOptional(due, isDay) || !isOptional(doneAt, isTime)) return null;
	return { id, text, body, doneAt, due };
}

/** A top-level todo; one from before categories, links, or agents has none of them. */
function parseTodo(raw: unknown, fields: Fields): UserTodo | null {
	const todo = parseLeaf(raw, fields);
	if (!todo || !isObject(raw)) return null;
	const children = parseAll(raw.children, child => parseLeaf(child, fields));
	const links = parseAll(raw.links ?? [], parseTodoLink);
	const { categoryId = null, addedBy = null } = raw;
	if (!children || !links || !isOptional(categoryId, fields.id) || !isOptional(addedBy, fields.id)) return null;
	return { ...todo, categoryId, children, links, addedBy };
}

function parseCategory(value: unknown): UserTodoCategory | null {
	if (!isObject(value)) return null;
	const { id, name } = value;
	return typeof id === "string" && typeof name === "string" ? { id, name } : null;
}

/** The list `todos.json` holds, to do before done, `null` when it holds none. A file written before categories or the archive reads as having none of either. */
export function parseUserTodoList(value: unknown): UserTodoList | null {
	if (!isObject(value)) return null;
	const categories = parseAll(value.categories ?? [], parseCategory);
	if (!categories) return null;
	const known = new Set(categories.map(category => category.id));
	const parseKnown = (raw: unknown): UserTodo | null => {
		const todo = parseTodo(raw, STORED);
		return todo && { ...todo, categoryId: todo.categoryId !== null && known.has(todo.categoryId) ? todo.categoryId : null };
	};
	const todos = parseAll(value.todos, parseKnown);
	const archive = parseAll(value.archive ?? [], parseKnown);
	return todos && archive && { categories, todos: inStatusOrder(todos), archive };
}

/** One change to the list, from a page or an agent, each string within its limit; `null` for anything else. */
export function parseTodoChange(value: unknown): UserTodoChange | null {
	if (!isObject(value)) return null;
	const isId = SENT.id;
	const isOptionalId = (id: unknown): id is string | null => isOptional(id, isId);
	const { op, id, text, name, categoryId, afterId } = value;
	if (op === "clear-done") return isOptionalId(categoryId) ? { op, categoryId } : null;
	if (op === "empty-archive") return { op };
	if (op === "restore") {
		const { parentId, index } = value;
		if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return null;
		if (parentId === null) {
			const todo = parseTodo(value.todo, SENT);
			return todo && { op, parentId, todo, index };
		}
		if (!isId(parentId)) return null;
		const leaf = parseLeaf(value.todo, SENT);
		return leaf && { op, parentId, todo: leaf, index };
	}
	if (!isId(id)) return null;
	switch (op) {
		case "add": {
			const { parentId, body = "", due = null, links = [], addedBy = null } = value;
			const parsed = parseAll(links, parseTodoLink);
			if (!SENT.text(text) || !isOptionalId(parentId) || !isOptionalId(afterId) || !isOptionalId(categoryId) || !SENT.body(body)) return null;
			if (!isOptional(due, isDay) || !isOptionalId(addedBy) || !parsed) return null;
			return { op, id, parentId, afterId, categoryId, text, body, due, links: parsed, addedBy };
		}
		case "edit":
			return SENT.text(text) ? { op, id, text } : null;
		case "edit-body":
			return SENT.body(value.body) ? { op, id, body: value.body } : null;
		case "toggle":
			return isOptional(value.doneAt, isTime) ? { op, id, doneAt: value.doneAt } : null;
		case "move":
			return isOptionalId(afterId) && isOptionalId(categoryId) ? { op, id, afterId, categoryId } : null;
		case "set-due":
			return isOptional(value.due, isDay) ? { op, id, due: value.due } : null;
		case "link":
		case "unlink": {
			const link = parseTodoLink(value.link);
			return link && { op, id, link };
		}
		case "categorize":
			return isOptionalId(categoryId) ? { op, id, categoryId } : null;
		case "add-category":
		case "rename-category":
			return isNonEmpty(name) && SENT.text(name) ? { op, id, name } : null;
		case "remove":
		case "indent":
		case "outdent":
		case "unarchive":
		case "remove-category":
			return { op, id };
		default:
			return null;
	}
}
