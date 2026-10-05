/** The rules of the Todo page's list, which the server applies to its file and the page to what it shows until the server answers. */
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoLink, UserTodoList } from "./shared";

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

/** `item` after the entry `afterId` names, or `atNull` (first or last) when `afterId` is `null`, and last when it names none: another window may have removed it. */
function insertAfter<T extends { id: string }>(list: readonly T[], afterId: string | null, item: T, atNull: "first" | "last" = "last"): T[] {
	if (afterId === null && atNull === "first") return [item, ...list];
	const at = afterId === null ? -1 : list.findIndex(entry => entry.id === afterId);
	return at < 0 ? [...list, item] : list.toSpliced(at + 1, 0, item);
}

/** `todos` with the todo at `place` passed through `next`. */
function updateAt(todos: UserTodo[], { top, child }: Place, next: (todo: UserTodoLeaf) => UserTodoLeaf): UserTodo[] {
	const parent = todos[top]!;
	if (child === null) return todos.with(top, { ...parent, ...next(parent) });
	return todos.with(top, { ...parent, children: parent.children.with(child, next(parent.children[child]!)) });
}

const leafOf = ({ id, text, body, doneAt, due }: UserTodoLeaf): UserTodoLeaf => ({ id, text, body, doneAt, due });

const topOf = (leaf: UserTodoLeaf, categoryId: string | null): UserTodo => ({ ...leafOf(leaf), categoryId, children: [], links: [], addedBy: null });

export function sameLink(a: UserTodoLink, b: UserTodoLink): boolean {
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

/** `todo` placed after `afterId` among `parentId`'s todos, `atNull` for `null`, or `todos` itself when `parentId` names none. */
function insertTodo(todos: UserTodo[], todo: UserTodo, parentId: string | null, afterId: string | null, atNull: "first" | "last", isCategory: (id: string) => boolean): UserTodo[] {
	if (parentId === null) {
		const categoryId = todo.categoryId !== null && isCategory(todo.categoryId) ? todo.categoryId : null;
		return insertAfter(todos, afterId, { ...todo, categoryId }, atNull);
	}
	const parent = todos.findIndex(entry => entry.id === parentId);
	if (parent < 0) return todos;
	return todos.with(parent, { ...todos[parent]!, children: insertAfter(todos[parent]!.children, afterId, leafOf(todo), atNull) });
}

/** `todos` with top-level todo `top` moved after top-level todo `afterId`, or first in `categoryId`, joining `categoryId`. */
function moveTop(todos: UserTodo[], top: number, afterId: string | null, categoryId: string | null): UserTodo[] {
	const moved = todos[top]!;
	if (afterId === moved.id) return todos;
	const rest = todos.toSpliced(top, 1);
	let at: number;
	if (afterId === null) {
		const first = rest.findIndex(todo => todo.categoryId === categoryId);
		at = first < 0 ? rest.length : first;
	} else {
		const after = rest.findIndex(todo => todo.id === afterId);
		if (after < 0) return todos;
		at = after + 1;
	}
	if (at === top && moved.categoryId === categoryId) return todos;
	return rest.toSpliced(at, 0, { ...moved, categoryId });
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
		case "toggle": {
			const { doneAt } = change;
			if (place.child !== null) return updateAt(todos, place, todo => ({ ...todo, doneAt }));
			return todos.with(place.top, {
				...parent,
				doneAt,
				children: doneAt === null ? parent.children : parent.children.map(child => (child.doneAt === null ? { ...child, doneAt } : child)),
			});
		}
		case "move": {
			if (place.child === null) {
				if (change.categoryId !== null && !isCategory(change.categoryId)) return todos;
				return moveTop(todos, place.top, change.afterId, change.categoryId);
			}
			if (change.afterId === change.id) return todos;
			const rest = parent.children.toSpliced(place.child, 1);
			const after = change.afterId === null ? -1 : rest.findIndex(child => child.id === change.afterId);
			if (change.afterId !== null && after < 0) return todos;
			if (after + 1 === place.child) return todos;
			return todos.with(place.top, { ...parent, children: rest.toSpliced(after + 1, 0, target) });
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

/** The list once every checked todo of category `categoryId` (any for `null`) moved to the archive, latest first; `list` itself when none is checked. */
function clearDone(list: UserTodoList, categoryId: string | null): UserTodoList {
	const archived: UserTodo[] = [];
	const todos = list.todos.flatMap(todo => {
		if (categoryId !== null && todo.categoryId !== categoryId) return [todo];
		if (todo.doneAt !== null) {
			archived.push(todo);
			return [];
		}
		const done = todo.children.filter(child => child.doneAt !== null);
		if (done.length === 0) return [todo];
		archived.push(...done.map(child => topOf(child, todo.categoryId)));
		return [{ ...todo, children: todo.children.filter(child => child.doneAt === null) }];
	});
	return archived.length === 0 ? list : { ...list, todos, archive: [...archived.reverse(), ...list.archive] };
}

/** `list` after `change`, or `list` itself when the change changes nothing. */
export function applyUserTodo(list: UserTodoList, change: UserTodoChange): UserTodoList {
	const { categories, todos, archive } = list;
	const indexOf = (id: string): number => categories.findIndex(category => category.id === id);
	const isCategory = (id: string): boolean => indexOf(id) >= 0;
	const known = (id: string): boolean => placeOf(todos, id) !== null || archive.some(todo => todo.id === id);
	const withTodos = (next: UserTodo[]): UserTodoList => (next === todos ? list : { ...list, todos: next });
	switch (change.op) {
		case "add": {
			if (known(change.id)) return list;
			const added: UserTodo = {
				id: change.id,
				text: change.text,
				body: change.body ?? "",
				doneAt: null,
				due: change.due ?? null,
				categoryId: change.categoryId,
				children: [],
				links: uniqueLinks(change.links ?? []),
				addedBy: change.addedBy ?? null,
			};
			return withTodos(insertTodo(todos, added, change.parentId, change.afterId, "last", isCategory));
		}
		case "restore":
			if (known(change.todo.id)) return list;
			return withTodos(insertTodo(todos, change.todo, change.parentId, change.afterId, "first", isCategory));
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
			return clearDone(list, change.categoryId);
		case "unarchive": {
			const at = archive.findIndex(todo => todo.id === change.id);
			if (at < 0) return list;
			const todo = archive[at]!;
			const categoryId = todo.categoryId !== null && isCategory(todo.categoryId) ? todo.categoryId : null;
			return { ...list, todos: [...todos, { ...todo, categoryId }], archive: archive.toSpliced(at, 1) };
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
