import type { RefObject } from "react";
import type { UserTodo, UserTodoChange, UserTodoLeaf } from "../src/user-todos-shared";
import { useShortcuts } from "./shortcuts";
import { moveTo, placeIn } from "./todo-views";

/** A todo's property that a key opens the picker of. */
export type TodoField = "status" | "priority" | "due";

/** The picker a key opened: todo `id`'s `field`, on its row in the list, or in the open todo's details. */
export interface OpenPicker {
	id: string;
	field: TodoField;
	inRow: boolean;
}

interface TodoKeysOptions {
	/** The element that holds the list's rows. */
	listRef: RefObject<HTMLElement | null>;
	/** The top-level todos the list shows, a group per section. */
	groups: readonly (readonly UserTodo[])[];
	/** The todo whose title is being typed, which the keys act on before the focused row. */
	editingId: string | null;
	canMove: boolean;
	/** Changes would not reach the server, so X, the pickers, C, and the moves do nothing. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	onToggle: (todo: UserTodoLeaf) => void;
	/** S, P, or Shift+D opened a picker. */
	onPicker: (picker: OpenPicker) => void;
	/** C starts a new todo in the Todo group; `null` in a list that takes none. */
	onNew: (() => void) | null;
	/** The todo the page shows beside the list, `null` for none. */
	openId: string | null;
	/** Every todo whose row shows, in the list's order: what J and K open while a todo is open. */
	openOrder: readonly string[];
	onOpen: (id: string | null) => void;
}

/**
 * J and K focus the next and previous todo, or, while one is open, open the next or previous one and focus its row.
 * Esc closes the open todo, X marks the focused todo, or else the open one, Done or a closed one Todo, S, P, and
 * Shift+D open the status, priority, and due day pickers of the focused todo or else the open one, C starts a new
 * todo, and Alt+Shift+↑ and ↓ move the focused todo a place. Returns that opening step for the open todo's own
 * buttons; `false` at either end of the list.
 */
export function useTodoKeys({ listRef, groups, editingId, canMove, disabled, onChange, onToggle, onPicker, onNew, openId, openOrder, onOpen }: TodoKeysOptions): (step: 1 | -1) => boolean {
	const focused = () => {
		const id = editingId ?? (document.activeElement as HTMLElement | null)?.closest("[data-todo-id]")?.getAttribute("data-todo-id") ?? null;
		return id === null ? null : placeIn(groups, id);
	};
	const focusStep = (step: 1 | -1): boolean => {
		const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-todo-row]") ?? [])];
		if (rows.length === 0) return false;
		const at = rows.findIndex(row => row === document.activeElement);
		rows[at < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + step))]!.focus();
		return true;
	};
	const openStep = (step: 1 | -1): boolean => {
		const at = openId === null ? -1 : openOrder.indexOf(openId);
		const id = at < 0 ? undefined : openOrder[at + step];
		if (id === undefined) return false;
		onOpen(id);
		listRef.current?.querySelector<HTMLElement>(`[data-todo-id="${CSS.escape(id)}"] [data-todo-row]`)?.focus();
		return true;
	};
	const moveBy = (step: 1 | -1): boolean => {
		const place = canMove && !disabled ? focused() : null;
		if (!place) return false;
		const { entry, siblings } = place;
		const at = siblings.findIndex(todo => todo.id === entry.todo.id);
		const change = moveTo(entry, siblings, at + step, entry.parent === null ? entry.todo.categoryId : null);
		if (!change) return false;
		onChange(change);
		return true;
	};
	const pickerFor = (field: TodoField): boolean => {
		if (disabled) return false;
		const place = focused();
		const id = place?.entry.todo.id ?? openId;
		if (id === null) return false;
		onPicker({ id, field, inRow: place !== null });
		return true;
	};
	useShortcuts({
		todoNext: () => (openId === null ? focusStep(1) : openStep(1)),
		todoPrevious: () => (openId === null ? focusStep(-1) : openStep(-1)),
		todoCheck: () => {
			const place = disabled ? null : (focused() ?? (openId === null ? null : placeIn(groups, openId)));
			if (!place) return false;
			onToggle(place.entry.todo);
		},
		todoStatus: () => pickerFor("status"),
		todoPriority: () => pickerFor("priority"),
		todoDue: () => pickerFor("due"),
		// Claims C even when it adds nothing, so the page's own key never falls through to the App's Create ticket.
		todoNew: () => {
			if (!disabled && onNew !== null) onNew();
		},
		todoClose: () => {
			if (openId === null) return false;
			onOpen(null);
		},
		moveUp: () => moveBy(-1),
		moveDown: () => moveBy(1),
	});
	return openStep;
}
