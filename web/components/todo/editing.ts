import { useState } from "react";
import { applyUserTodo } from "../../../src/user-todos";
import type { TodoStatus, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../../src/user-todos-shared";
import { hashForNewSession } from "../../routing";
import { quickAddTodo } from "../../todo-quick-add";
import { type ListKind, lastOf, restoreOf, type Section } from "../../todo-views";
import { toasts } from "../toaster";
import type { TodoKey } from "./input";

/** How long **Undo** stays after a todo is deleted. */
const UNDO_MS = 8000;
const UNDO_TOAST = "todo-undo";

/** **Undo** for the last delete, for {@link UNDO_MS}; a later delete takes its place. */
function offerUndo(text: string, undo: () => void): void {
	toasts.add({
		id: UNDO_TOAST,
		title: `Deleted “${text}”`,
		timeout: UNDO_MS,
		actionProps: {
			children: "Undo",
			onClick: () => {
				undo();
				toasts.close(UNDO_TOAST);
			},
		},
	});
}

/** What the Todo page types into: a todo's title, or a todo not added yet, at its place in the list, with what it holds so far. */
type Editing =
	| { kind: "none" }
	| { kind: "edit"; id: string }
	| {
			kind: "draft";
			parentId: string | null;
			afterId: string | null;
			categoryId: string | null;
			/** The status the new todo gets: the group it is typed in. */
			status: TodoStatus;
			text: string;
			/** The todo this draft last added. A todo its title moved elsewhere leaves the draft in place, and this still gives it a fresh input. */
			addedId?: string;
	  };

/** A todo not added yet. */
export type Draft = Extract<Editing, { kind: "draft" }>;

const NOT_EDITING: Editing = { kind: "none" };

interface TodoEditingOptions {
	list: UserTodoList;
	kind: ListKind;
	/** Today, which a todo added to Today is due. */
	day: string;
	/** The list cannot be changed here: the server is out of reach, or the list is the archive. */
	frozen: boolean;
	onChange: (change: UserTodoChange) => void;
	/** Todo `id` was deleted. */
	onRemoved: (id: string) => void;
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
}

/** Where a todo added right below `todo` goes, and its status: after it, in its status, as Linear adds one within a group. */
const below = (todo: UserTodoLeaf): Pick<Draft, "afterId" | "status"> => ({ afterId: todo.id, status: todo.status });

/** What the page's rows and drafts ask of its typing. */
export interface TodoEditing {
	/** The todo whose title is being typed. */
	editingId: string | null;
	/** The draft at this place of `section`, if the new todo being typed goes there. */
	draftAt(section: Section, parentId: string | null, afterId: string | null): Draft | null;
	remove(id: string, text: string): void;
	/** Starts typing todo `id`'s title. */
	edit(id: string): void;
	/** Starts a new todo with an empty title. */
	startDraft(place: Pick<Draft, "parentId" | "afterId" | "categoryId" | "status">): void;
	/** Focus left the input of todo `todo` with `text` in it. */
	leaveEdit(todo: UserTodoLeaf, text: string): void;
	leaveDraft(draft: Draft, text: string): void;
	/** What `key` does in the input of todo `todo` under `parentId`; whether the input goes away. */
	editKey(todo: UserTodoLeaf, parentId: string | null, categoryId: string | null, key: TodoKey, text: string): boolean;
	/** What `key` does in the input of the new todo `draft` of `section`; whether the input goes away. */
	draftKey(draft: Draft, section: Section, key: TodoKey, text: string): boolean;
}

/** The page's typing: which title or new todo has the input, what its keys do, and deleting with **Undo**. */
export function useTodoEditing({ list, kind, day, frozen, onChange, onRemoved, newSessionCwd }: TodoEditingOptions): TodoEditing {
	const [editing, setEditing] = useState<Editing>(NOT_EDITING);

	/** Deletes todo `id` with the todos under it, and offers **Undo**, which puts it back where it was. */
	const remove = (id: string, text: string): void => {
		const restore = restoreOf(list, id);
		onChange({ op: "remove", id });
		onRemoved(id);
		if (restore) offerUndo(text, () => onChange(restore));
	};
	/** Saves `text` as todo `todo`'s title; an empty one removes the todo. */
	const commit = (todo: UserTodoLeaf, text: string): void => {
		const trimmed = text.trim();
		if (!trimmed) remove(todo.id, todo.text);
		else if (trimmed !== todo.text) onChange({ op: "edit", id: todo.id, text: trimmed });
	};
	/**
	 * Adds `text` as a todo; a trailing due day or `#category` sets that field instead of staying in the title. Returns
	 * where the next draft goes: after the new todo, or in its place when the parsed fields move the todo out of this list.
	 */
	const add = (draft: Draft, text: string): { id: string; afterId: string | null } | null => {
		const { parentId, afterId, categoryId, status } = draft;
		const dueToday = parentId === null && kind.add?.dueToday === true;
		const change = quickAddTodo(text, list.categories, day, { parentId, afterId, categoryId, status, due: dueToday ? day : null });
		if (!change) return null;
		onChange(change);
		const leaves = change.categoryId !== categoryId || (dueToday && change.due !== null && change.due > day);
		return { id: change.id, afterId: leaves ? afterId : change.id };
	};

	return {
		editingId: !frozen && editing.kind === "edit" ? editing.id : null,
		draftAt: (section, parentId, afterId) =>
			!frozen && editing.kind === "draft" && editing.parentId === parentId && editing.afterId === afterId && editing.categoryId === section.categoryId ? editing : null,
		remove,
		edit: id => setEditing({ kind: "edit", id }),
		startDraft: place => setEditing({ kind: "draft", ...place, text: "" }),
		leaveEdit: (todo, text) => {
			commit(todo, text);
			setEditing(NOT_EDITING);
		},
		leaveDraft: (draft, text) => {
			add(draft, text);
			setEditing(NOT_EDITING);
		},
		editKey: (todo, parentId, categoryId, key, text) => {
			switch (key) {
				case "enter":
					commit(todo, text);
					setEditing(text.trim() && kind.add ? { kind: "draft", parentId, ...below(todo), categoryId, text: "" } : NOT_EDITING);
					return true;
				case "start":
					if (parentId !== null || !text.trim()) return false;
					commit(todo, text);
					location.hash = hashForNewSession(newSessionCwd, todo.id);
					return true;
				case "escape":
					setEditing(NOT_EDITING);
					return true;
				case "erase":
					remove(todo.id, todo.text);
					setEditing(NOT_EDITING);
					return true;
				case "indent":
				case "outdent": {
					const move: UserTodoChange = { op: key, id: todo.id };
					if (applyUserTodo(list, move) === list) return false;
					commit(todo, text);
					onChange(move);
					// The todo renders in another list, which mounts a new input for it.
					return true;
				}
			}
		},
		draftKey: (draft, section, key, text) => {
			switch (key) {
				case "enter": {
					const added = add(draft, text);
					setEditing(added ? { ...draft, afterId: added.afterId, addedId: added.id, text: "" } : NOT_EDITING);
					return true;
				}
				case "start": {
					if (draft.parentId !== null) return false;
					const added = add(draft, text);
					if (!added) return false;
					setEditing(NOT_EDITING);
					location.hash = hashForNewSession(newSessionCwd, added.id);
					return true;
				}
				case "escape":
				case "erase":
					setEditing(NOT_EDITING);
					return true;
				case "indent": {
					// Under the top-level todo it follows, or the last one of its status when it ends them.
					const parentId = draft.parentId === null ? (draft.afterId ?? lastOf(section.todos, draft.status)) : null;
					if (parentId === null) return false;
					setEditing({ ...draft, parentId, afterId: null, text });
					return true;
				}
				case "outdent": {
					const parent = draft.parentId === null ? undefined : section.todos.find(todo => todo.id === draft.parentId);
					if (!parent) return false;
					setEditing({ ...draft, parentId: null, ...below(parent), text });
					return true;
				}
			}
		},
	};
}
