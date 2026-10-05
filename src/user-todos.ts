/** The rules of the Todo page's list, which the server applies to its file and the page to what it shows until the server answers. */
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "./shared";

/** The changes that touch the todos alone. */
type TodoChange = Exclude<UserTodoChange, { op: "add-category" | "rename-category" | "remove-category" }>;

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

/** `todos` after `change`, or `todos` itself when the change changes nothing; `isCategory` tells which categories exist. */
function applyToTodos(todos: UserTodo[], change: TodoChange, isCategory: (id: string) => boolean): UserTodo[] {
	if (change.op === "clear-done") {
		let removed = false;
		const kept = todos.flatMap(todo => {
			if (change.categoryId !== null && todo.categoryId !== change.categoryId) return [todo];
			if (todo.done) {
				removed = true;
				return [];
			}
			const children = todo.children.filter(child => !child.done);
			removed ||= children.length < todo.children.length;
			return [{ ...todo, children }];
		});
		return removed ? kept : todos;
	}
	const place = placeOf(todos, change.id);
	if (change.op === "add") {
		if (place) return todos;
		const added: UserTodoLeaf = { id: change.id, text: change.text, body: "", done: false };
		if (change.parentId === null) {
			const categoryId = change.categoryId !== null && isCategory(change.categoryId) ? change.categoryId : null;
			return insertAfter(todos, change.afterId, { ...added, categoryId, children: [] });
		}
		const parent = todos.findIndex(todo => todo.id === change.parentId);
		if (parent < 0) return todos;
		return todos.with(parent, { ...todos[parent]!, children: insertAfter(todos[parent]!.children, change.afterId, added) });
	}
	if (!place) return todos;
	const parent = todos[place.top]!;
	switch (change.op) {
		case "edit":
			return updateAt(todos, place, todo => ({ ...todo, text: change.text }));
		case "edit-body":
			return updateAt(todos, place, todo => ({ ...todo, body: change.body }));
		case "toggle":
			if (place.child !== null) return updateAt(todos, place, todo => ({ ...todo, done: change.done }));
			return todos.with(place.top, {
				...parent,
				done: change.done,
				children: change.done ? parent.children.map(child => ({ ...child, done: true })) : parent.children,
			});
		case "remove":
			if (place.child === null) return todos.toSpliced(place.top, 1);
			return todos.with(place.top, { ...parent, children: parent.children.toSpliced(place.child, 1) });
		case "indent": {
			// A todo with its own todos would put them three deep.
			if (place.child !== null || parent.children.length > 0) return todos;
			const above = todos.findLastIndex((todo, index) => index < place.top && todo.categoryId === parent.categoryId);
			if (above < 0) return todos;
			const target = todos[above]!;
			const { id, text, body, done } = parent;
			return todos.toSpliced(place.top, 1).with(above, { ...target, children: [...target.children, { id, text, body, done }] });
		}
		case "outdent": {
			if (place.child === null) return todos;
			const moved: UserTodo = { ...parent.children[place.child]!, categoryId: parent.categoryId, children: parent.children.slice(place.child + 1) };
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

/** `list` after `change`, or `list` itself when the change changes nothing. */
export function applyUserTodo(list: UserTodoList, change: UserTodoChange): UserTodoList {
	const { categories, todos } = list;
	const indexOf = (id: string): number => categories.findIndex(category => category.id === id);
	switch (change.op) {
		case "add-category":
			return indexOf(change.id) >= 0 ? list : { ...list, categories: [...categories, { id: change.id, name: change.name }] };
		case "rename-category": {
			const at = indexOf(change.id);
			if (at < 0 || categories[at]!.name === change.name) return list;
			return { ...list, categories: categories.with(at, { id: change.id, name: change.name }) };
		}
		case "remove-category": {
			const at = indexOf(change.id);
			if (at < 0) return list;
			return {
				categories: categories.toSpliced(at, 1),
				todos: todos.map(todo => (todo.categoryId === change.id ? { ...todo, categoryId: null } : todo)),
			};
		}
		default: {
			const next = applyToTodos(todos, change, id => indexOf(id) >= 0);
			return next === todos ? list : { ...list, todos: next };
		}
	}
}
