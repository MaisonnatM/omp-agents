/** The rules of the Todo tab's list, which the server applies to its file and the page to what it shows until the server answers. */
import type { UserTodo, UserTodoChange, UserTodoLeaf } from "./shared";

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

/** `todos` after `change`, or `todos` itself when the change changes nothing. */
export function applyUserTodo(todos: UserTodo[], change: UserTodoChange): UserTodo[] {
	if (change.op === "clear-done") {
		const kept = todos.filter(todo => !todo.done).map(todo => ({ ...todo, children: todo.children.filter(child => !child.done) }));
		const removed = kept.length < todos.length || kept.some((todo, index) => todo.children.length < todos[index]!.children.length);
		return removed ? kept : todos;
	}
	const place = placeOf(todos, change.id);
	if (change.op === "add") {
		if (place) return todos;
		const added: UserTodoLeaf = { id: change.id, text: change.text, done: false };
		if (change.parentId === null) return insertAfter(todos, change.afterId, { ...added, children: [] });
		const parent = todos.findIndex(todo => todo.id === change.parentId);
		if (parent < 0) return todos;
		return todos.with(parent, { ...todos[parent]!, children: insertAfter(todos[parent]!.children, change.afterId, added) });
	}
	if (!place) return todos;
	const parent = todos[place.top]!;
	switch (change.op) {
		case "edit":
			return updateAt(todos, place, todo => ({ ...todo, text: change.text }));
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
			if (place.child !== null || place.top === 0 || parent.children.length > 0) return todos;
			const above = todos[place.top - 1]!;
			return todos.toSpliced(place.top - 1, 2, { ...above, children: [...above.children, { id: parent.id, text: parent.text, done: parent.done }] });
		}
		case "outdent": {
			if (place.child === null) return todos;
			const moved: UserTodo = { ...parent.children[place.child]!, children: parent.children.slice(place.child + 1) };
			return todos.toSpliced(place.top, 1, { ...parent, children: parent.children.slice(0, place.child) }, moved);
		}
		default: {
			const never: never = change;
			return never;
		}
	}
}
