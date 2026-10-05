import type { RefObject } from "react";
import type { UserTodo, UserTodoChange, UserTodoLeaf } from "../src/shared";
import { useShortcuts } from "./shortcuts";
import { moveTo, placeIn } from "./todo-views";

interface TodoKeysOptions {
	/** The element that holds the list's rows. */
	listRef: RefObject<HTMLElement | null>;
	/** The top-level todos the list shows, a group per section. */
	groups: readonly (readonly UserTodo[])[];
	/** The todo whose title is being typed, which the keys act on before the focused row. */
	editingId: string | null;
	canMove: boolean;
	/** Changes would not reach the server, so X and the moves do nothing. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	onToggle: (todo: UserTodoLeaf) => void;
}

/** J and K focus the next and previous todo, X checks the focused one, and Alt+Shift+↑ and ↓ move it a place. */
export function useTodoKeys({ listRef, groups, editingId, canMove, disabled, onChange, onToggle }: TodoKeysOptions): void {
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
	useShortcuts({
		todoNext: () => focusStep(1),
		todoPrevious: () => focusStep(-1),
		todoCheck: () => {
			const place = disabled ? null : focused();
			if (!place) return false;
			onToggle(place.entry.todo);
		},
		todoMoveUp: () => moveBy(-1),
		todoMoveDown: () => moveBy(1),
	});
}
