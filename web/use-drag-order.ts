import { type DragEvent, useState } from "react";
import type { Where } from "./inbox-model";

/** The item being dragged within its `scope`, and where a drop on the item under the pointer would put it. */
interface Drag {
	scope: string;
	key: string;
	over: { key: string; where: Where } | null;
}

/** The line that shows where a dragged item would land, on an element that is `relative`. */
export const DROP_LINE: Record<Where, string> = {
	before: "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-ring",
	after: "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ring",
};

/** One draggable item: the element you grab, the element that takes a drop, where a drop would land, and whether it is the one dragged. */
export interface DragItem {
	handle: {
		draggable: true;
		onDragStart: (event: DragEvent<HTMLElement>) => void;
		onDragEnd: () => void;
	};
	target: {
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
	dropAt: Where | null;
	dragging: boolean;
}

/**
 * Dragging an item among the others of its `scope`, such as the inbox's repositories, its sections, or one section's
 * pull requests. An item takes a drop only from its own scope; `onDrop` gets the dragged key and the side of `key` it lands on.
 */
export function useDragOrder(): (scope: string, key: string, onDrop: (dragged: string, where: Where) => void) => DragItem {
	const [drag, setDrag] = useState<Drag | null>(null);
	return (scope, key, onDrop) => ({
		handle: {
			draggable: true,
			onDragStart: event => {
				// A row inside a draggable group starts its own drag, not the group's.
				event.stopPropagation();
				event.dataTransfer.effectAllowed = "move";
				event.dataTransfer.setData("text/plain", key);
				setDrag({ scope, key, over: null });
			},
			onDragEnd: () => setDrag(null),
		},
		target: {
			onDragOver: event => {
				// Another scope's drag passes up to the group that takes it.
				if (drag?.scope !== scope) return;
				event.preventDefault();
				event.stopPropagation();
				const box = event.currentTarget.getBoundingClientRect();
				const where: Where = event.clientY < box.top + box.height / 2 ? "before" : "after";
				const over = drag.key === key ? null : { key, where };
				if (drag.over?.key !== over?.key || drag.over?.where !== over?.where) setDrag({ ...drag, over });
			},
			onDrop: event => {
				if (drag?.scope !== scope) return;
				event.preventDefault();
				event.stopPropagation();
				if (drag.over?.key === key) onDrop(drag.key, drag.over.where);
				setDrag(null);
			},
		},
		dropAt: drag?.scope === scope && drag.over?.key === key ? drag.over.where : null,
		dragging: drag?.scope === scope && drag.key === key,
	});
}
