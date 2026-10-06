import { type DragEvent, useState } from "react";
import type { UserTodoChange, UserTodoLeaf } from "../src/shared";
import { moveTo, sameStatus, type TodoEntry } from "./todo-views";

/** The row being dragged, and where a drop on the row under the pointer would put it. */
interface Drag {
	entry: TodoEntry;
	over: { id: string; where: "before" | "after" } | null;
}

/**
 * Dragging a todo among the todos beside it of its status: a top-level one among top-level ones, joining the category
 * of the todo it drops beside, and one under another among its parent's. `rowProps` goes on each row's `<li>`.
 */
export function useTodoDrag(enabled: boolean, onMove: (change: UserTodoChange) => void) {
	const [drag, setDrag] = useState<Drag | null>(null);
	const rowProps = (entry: TodoEntry, siblings: readonly UserTodoLeaf[]) => ({
		draggable: enabled,
		onDragStart: (event: DragEvent<HTMLLIElement>) => {
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", entry.todo.text);
			setDrag({ entry, over: null });
		},
		onDragEnd: () => setDrag(null),
		onDragOver: (event: DragEvent<HTMLLIElement>) => {
			if (!drag || (drag.entry.parent?.id ?? null) !== (entry.parent?.id ?? null) || drag.entry.todo.id === entry.todo.id || !sameStatus(drag.entry.todo, entry.todo)) return;
			event.preventDefault();
			const box = event.currentTarget.getBoundingClientRect();
			const where = event.clientY < box.top + box.height / 2 ? "before" : "after";
			if (drag.over?.id !== entry.todo.id || drag.over.where !== where) setDrag({ ...drag, over: { id: entry.todo.id, where } });
		},
		onDrop: (event: DragEvent<HTMLLIElement>) => {
			event.preventDefault();
			if (drag?.over?.id === entry.todo.id) {
				const at = siblings.filter(todo => todo.id !== drag.entry.todo.id).findIndex(todo => todo.id === entry.todo.id);
				const categoryId = entry.parent === null ? entry.todo.categoryId : null;
				const change = moveTo(drag.entry, siblings, drag.over.where === "after" ? at + 1 : at, categoryId);
				if (change) onMove(change);
			}
			setDrag(null);
		},
	});
	return {
		draggingId: drag?.entry.todo.id ?? null,
		overOf: (id: string) => (drag?.over?.id === id ? drag.over.where : null),
		rowProps,
	};
}
