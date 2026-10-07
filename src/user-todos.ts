/** The rules of the Todo page's list, which the server applies to its file and the page to what it shows until the server answers. */
import { isClosed, type UserTodo, type UserTodoChange, type UserTodoLeaf, type UserTodoLink, type UserTodoList } from "./user-todos-shared";

type AddChange = Extract<UserTodoChange, { op: "add" }>;

/**
 * The `add` of a new todo, with a new id unless `id` names it, a Todo with no priority added now; whatever else
 * `fields` leaves out is none, last in the top level.
 */
export function addTodo(fields: Pick<AddChange, "text"> & Partial<Omit<AddChange, "op">>): AddChange {
	const {
		id = crypto.randomUUID(),
		parentId = null,
		afterId = null,
		categoryId = null,
		text,
		body = "",
		due = null,
		links = [],
		addedBy = null,
		status = "todo",
		priority = 0,
		createdAt = new Date().toISOString(),
	} = fields;
	return { op: "add", id, parentId, afterId, categoryId, text, body, due, links, addedBy, status, priority, createdAt };
}

/**
 * The changes that start session `sessionId` for top-level todo `id`: the link to it, then In Progress at `at` when
 * the todo was not started yet (Backlog or Todo), so a started todo reads as being worked on.
 */
export function startChanges(list: UserTodoList, id: string, sessionId: string, at: string): UserTodoChange[] {
	const link: UserTodoChange = { op: "link", id, link: { kind: "session", sessionId } };
	const status = list.todos.find(todo => todo.id === id)?.status;
	return status === "backlog" || status === "todo" ? [link, { op: "set-status", id, status: "in-progress", at }] : [link];
}

/** The changes that touch the list's todos alone, not its categories or its archive. */
type TodoChange = Exclude<
	UserTodoChange,
	{ op: "add" | "restore" | "remove" | "clear-done" | "unarchive" | "empty-archive" | "add-category" | "rename-category" | "remove-category" }
>;

/** Where a todo sits: its top-level todo's index, and its own index under that todo, or `null` when it is the top-level one. */
interface Place {
	top: number;
	child: number | null;
}

function placeOf(todos: readonly UserTodo[], id: string): Place | null {
	for (const [top, todo] of todos.entries()) {
		if (todo.id === id) return { top, child: null };
		const child = todo.children.findIndex(leaf => leaf.id === id);
		if (child >= 0) return { top, child };
	}
	return null;
}

/** `item` after the entry `afterId` names, or last when `afterId` is `null` or names none: another window may have removed it. */
function insertAfter<T extends { id: string }>(list: readonly T[], afterId: string | null, item: T): T[] {
	const at = afterId === null ? -1 : list.findIndex(entry => entry.id === afterId);
	return at < 0 ? [...list, item] : list.toSpliced(at + 1, 0, item);
}

/** `todos` with the todo at `place` passed through `next`. */
function updateAt(todos: UserTodo[], { top, child }: Place, next: (todo: UserTodoLeaf) => UserTodoLeaf): UserTodo[] {
	const parent = todos[top]!;
	if (child === null) return todos.with(top, { ...parent, ...next(parent) });
	return todos.with(top, { ...parent, children: parent.children.with(child, next(parent.children[child]!)) });
}

const leafOf = ({ id, text, body, status, priority, doneAt, due, createdAt }: UserTodoLeaf): UserTodoLeaf => ({ id, text, body, status, priority, doneAt, due, createdAt });

const topOf = (leaf: UserTodoLeaf, categoryId: string | null): UserTodo => ({ ...leafOf(leaf), categoryId, children: [], links: [], addedBy: null });

const validCategory = (categoryId: string | null, isCategory: (id: string) => boolean): string | null =>
	categoryId !== null && isCategory(categoryId) ? categoryId : null;

function sameLink(a: UserTodoLink, b: UserTodoLink): boolean {
	switch (a.kind) {
		case "session":
			return b.kind === "session" && a.sessionId === b.sessionId;
		case "pull-request":
			return b.kind === "pull-request" && a.owner === b.owner && a.repo === b.repo && a.number === b.number;
		case "ticket":
			return b.kind === "ticket" && a.identifier === b.identifier;
		default: {
			const never: never = a;
			return never;
		}
	}
}

/** Each link once, in order. */
const uniqueLinks = (links: readonly UserTodoLink[]): UserTodoLink[] =>
	links.filter((link, index) => links.findIndex(other => sameLink(link, other)) === index);

/** `todos` to do first, then the done ones, each group in its order; `todos` itself when already so. */
function toDoFirst<T extends UserTodoLeaf>(todos: T[]): T[] {
	const sorted = [...todos.filter(todo => todo.doneAt === null), ...todos.filter(todo => todo.doneAt !== null)];
	return sorted.every((todo, index) => todo === todos[index]) ? todos : sorted;
}

/** `todos` with each level to do first, then done, as every list keeps them; `todos` itself when already so. */
export function inStatusOrder(todos: UserTodo[]): UserTodo[] {
	const nested = todos.map(todo => {
		const children = toDoFirst(todo.children);
		return children === todo.children ? todo : { ...todo, children };
	});
	return toDoFirst(nested.every((todo, index) => todo === todos[index]) ? todos : nested);
}

/** `todo` placed after `afterId` among `parentId`'s todos, or `todos` itself when `parentId` names none. */
function insertTodo(todos: UserTodo[], todo: UserTodo, parentId: string | null, afterId: string | null, isCategory: (id: string) => boolean): UserTodo[] {
	if (parentId === null) return insertAfter(todos, afterId, { ...todo, categoryId: validCategory(todo.categoryId, isCategory) });
	const parent = todos.findIndex(entry => entry.id === parentId);
	if (parent < 0) return todos;
	return todos.with(parent, { ...todos[parent]!, children: insertAfter(todos[parent]!.children, afterId, leafOf(todo)) });
}

/**
 * `list` with the entry at `from` taken out and `moved` put back right after `afterId`, or at `first(rest)` for `null`;
 * `null` when that changes nothing or `afterId` names none.
 */
function reorder<T extends { id: string }>(list: readonly T[], from: number, afterId: string | null, first: (rest: T[]) => number, moved: T): T[] | null {
	if (afterId === list[from]!.id) return null;
	const rest = list.toSpliced(from, 1);
	const after = afterId === null ? -1 : rest.findIndex(entry => entry.id === afterId);
	if (afterId !== null && after < 0) return null;
	const at = afterId === null ? first(rest) : after + 1;
	return at === from && moved === list[from] ? null : rest.toSpliced(at, 0, moved);
}

/** `todos` after `change`, or `todos` itself when the change changes nothing; `isCategory` tells which categories exist. */
function applyToTodos(todos: UserTodo[], change: TodoChange, isCategory: (id: string) => boolean): UserTodo[] {
	const place = placeOf(todos, change.id);
	if (!place) return todos;
	const parent = todos[place.top]!;
	const target = place.child === null ? parent : parent.children[place.child]!;
	switch (change.op) {
		case "edit":
			return target.text === change.text ? todos : updateAt(todos, place, todo => ({ ...todo, text: change.text }));
		case "edit-body":
			return target.body === change.body ? todos : updateAt(todos, place, todo => ({ ...todo, body: change.body }));
		case "set-due":
			return target.due === change.due ? todos : updateAt(todos, place, todo => ({ ...todo, due: change.due }));
		case "set-status": {
			const { status, at } = change;
			if (target.status === status) return todos;
			const doneAt = isClosed(status) ? at : null;
			const set = <T extends UserTodoLeaf>(leaf: T): T => ({ ...leaf, status, doneAt });
			if (place.child !== null || doneAt === null) return updateAt(todos, place, set);
			return todos.with(place.top, { ...set(parent), children: parent.children.map(child => (child.doneAt === null ? set(child) : child)) });
		}
		case "set-priority":
			return target.priority === change.priority ? todos : updateAt(todos, place, todo => ({ ...todo, priority: change.priority }));
		case "move": {
			if (place.child === null) {
				const { categoryId } = change;
				if (categoryId !== null && !isCategory(categoryId)) return todos;
				const firstInCategory = (rest: UserTodo[]): number => {
					const first = rest.findIndex(todo => todo.categoryId === categoryId);
					return first < 0 ? rest.length : first;
				};
				return reorder(todos, place.top, change.afterId, firstInCategory, parent.categoryId === categoryId ? parent : { ...parent, categoryId }) ?? todos;
			}
			const children = reorder(parent.children, place.child, change.afterId, () => 0, target);
			return children ? todos.with(place.top, { ...parent, children }) : todos;
		}
		case "link":
			if (place.child !== null || parent.links.some(link => sameLink(link, change.link))) return todos;
			return todos.with(place.top, { ...parent, links: [...parent.links, change.link] });
		case "unlink": {
			if (place.child !== null) return todos;
			const links = parent.links.filter(link => !sameLink(link, change.link));
			return links.length === parent.links.length ? todos : todos.with(place.top, { ...parent, links });
		}
		case "indent": {
			// A todo with its own todos would put them three deep, and a todo under another holds no links.
			if (place.child !== null || parent.children.length > 0 || parent.links.length > 0) return todos;
			const above = todos.findLastIndex((todo, index) => index < place.top && todo.categoryId === parent.categoryId);
			if (above < 0) return todos;
			const into = todos[above]!;
			return todos.toSpliced(place.top, 1).with(above, { ...into, children: [...into.children, leafOf(parent)] });
		}
		case "outdent": {
			if (place.child === null) return todos;
			const moved: UserTodo = { ...topOf(target, parent.categoryId), children: parent.children.slice(place.child + 1) };
			return todos.toSpliced(place.top, 1, { ...parent, children: parent.children.slice(0, place.child) }, moved);
		}
		case "categorize": {
			const { categoryId } = change;
			if (place.child !== null || parent.categoryId === categoryId || (categoryId !== null && !isCategory(categoryId))) return todos;
			// Last, so it ends the category it joins.
			return [...todos.toSpliced(place.top, 1), { ...parent, categoryId }];
		}
		default: {
			const never: never = change;
			return never;
		}
	}
}

/** How long a closed todo stays in the list before the server moves it to the archive. */
export const DONE_KEPT_HOURS = 24;

/**
 * The list once every closed todo of category `categoryId` (any for `null`), closed before `before` when given, moved
 * to the archive, latest first; `list` itself when none is.
 */
function clearDone(list: UserTodoList, categoryId: string | null, before: string | undefined): UserTodoList {
	const cutoff = before === undefined ? Infinity : Date.parse(before);
	const cleared = (leaf: UserTodoLeaf): boolean => leaf.doneAt !== null && Date.parse(leaf.doneAt) < cutoff;
	const archived: UserTodo[] = [];
	const todos = list.todos.flatMap(todo => {
		if (categoryId !== null && todo.categoryId !== categoryId) return [todo];
		if (cleared(todo)) {
			archived.push(todo);
			return [];
		}
		const done = todo.children.filter(cleared);
		if (done.length === 0) return [todo];
		archived.push(...done.map(child => topOf(child, todo.categoryId)));
		return [{ ...todo, children: todo.children.filter(child => !cleared(child)) }];
	});
	return archived.length === 0 ? list : { ...list, todos, archive: [...archived.reverse(), ...list.archive] };
}

/** `list` after `change`, or `list` itself when the change changes nothing. */
export function applyUserTodo(list: UserTodoList, change: UserTodoChange): UserTodoList {
	const next = applyChange(list, change);
	const todos = inStatusOrder(next.todos);
	return todos === next.todos ? next : { ...next, todos };
}

function applyChange(list: UserTodoList, change: UserTodoChange): UserTodoList {
	const { categories, todos, archive } = list;
	const indexOf = (id: string): number => categories.findIndex(category => category.id === id);
	const isCategory = (id: string): boolean => indexOf(id) >= 0;
	const known = (id: string): boolean => placeOf(todos, id) !== null || archive.some(todo => todo.id === id);
	const withTodos = (next: UserTodo[]): UserTodoList => (next === todos ? list : { ...list, todos: next });
	switch (change.op) {
		case "add": {
			if (known(change.id)) return list;
			// A closed todo closes when it is added; one with no time to close at reads as Todo, as the file does.
			const closedAt = isClosed(change.status) ? change.createdAt : null;
			const status = isClosed(change.status) && closedAt === null ? "todo" : change.status;
			const added: UserTodo = {
				id: change.id,
				text: change.text,
				body: change.body,
				status,
				priority: change.priority,
				doneAt: closedAt,
				due: change.due,
				createdAt: change.createdAt,
				categoryId: change.categoryId,
				children: [],
				links: uniqueLinks(change.links),
				addedBy: change.addedBy,
			};
			return withTodos(insertTodo(todos, added, change.parentId, change.afterId, isCategory));
		}
		case "restore": {
			if (known(change.todo.id)) return list;
			if (change.parentId === null) {
				return withTodos(todos.toSpliced(change.index, 0, { ...change.todo, categoryId: validCategory(change.todo.categoryId, isCategory) }));
			}
			const { parentId } = change;
			const at = todos.findIndex(todo => todo.id === parentId);
			if (at < 0) return list;
			return withTodos(todos.with(at, { ...todos[at]!, children: todos[at]!.children.toSpliced(change.index, 0, leafOf(change.todo)) }));
		}
		case "remove": {
			const at = placeOf(todos, change.id);
			if (at) {
				const parent = todos[at.top]!;
				return withTodos(at.child === null ? todos.toSpliced(at.top, 1) : todos.with(at.top, { ...parent, children: parent.children.toSpliced(at.child, 1) }));
			}
			const archived = archive.findIndex(todo => todo.id === change.id);
			return archived < 0 ? list : { ...list, archive: archive.toSpliced(archived, 1) };
		}
		case "clear-done":
			return clearDone(list, change.categoryId, change.before);
		case "unarchive": {
			const at = archive.findIndex(todo => todo.id === change.id);
			if (at < 0) return list;
			const todo = archive[at]!;
			return { ...list, todos: [...todos, { ...todo, categoryId: validCategory(todo.categoryId, isCategory) }], archive: archive.toSpliced(at, 1) };
		}
		case "empty-archive":
			return archive.length === 0 ? list : { ...list, archive: [] };
		case "add-category":
			return isCategory(change.id) ? list : { ...list, categories: [...categories, { id: change.id, name: change.name }] };
		case "rename-category": {
			const at = indexOf(change.id);
			if (at < 0 || categories[at]!.name === change.name) return list;
			return { ...list, categories: categories.with(at, { id: change.id, name: change.name }) };
		}
		case "remove-category": {
			const at = indexOf(change.id);
			if (at < 0) return list;
			const uncategorize = (todo: UserTodo): UserTodo => (todo.categoryId === change.id ? { ...todo, categoryId: null } : todo);
			return { categories: categories.toSpliced(at, 1), todos: todos.map(uncategorize), archive: archive.map(uncategorize) };
		}
		default:
			return withTodos(applyToTodos(todos, change, isCategory));
	}
}
