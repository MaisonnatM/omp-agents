import { type DragEvent, useCallback, useRef, useState } from "react";
import type { Where } from "./pull-requests-model";

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

/** What an item keeps across renders: the same handlers, which call the `onDrop` of the latest render. */
interface Held {
	handle: DragItem["handle"];
	target: DragItem["target"];
	onDrop: (dragged: string, where: Where) => void;
}

/**
 * Dragging an item among the others of its `scope`, such as the inbox's repositories, its sections, or one section's
 * pull requests. An item takes a drop only from its own scope; `onDrop` gets the dragged key and the side of `key` it lands on.
 * An item's `handle` and `target` stay the same across renders, so a memoized row that holds them is drawn again only
 * when its `dropAt` or `dragging` changes. The returned function changes when the drag does.
 */
export function useDragOrder(): (scope: string, key: string, onDrop: (dragged: string, where: Where) => void) => DragItem {
	const [drag, setDrag] = useState<Drag | null>(null);
	// The drag the handlers read, which a handler's own change reaches before the render does.
	const current = useRef<Drag | null>(null);
	const [held] = useState(() => new Map<string, Held>());
	const change = useCallback((next: Drag | null): void => {
		current.current = next;
		setDrag(next);
	}, []);
	return useCallback(
		(scope, key, onDrop) => {
			const id = `${scope}\0${key}`;
			let item = held.get(id);
			if (!item) {
				const kept: Held = {
					onDrop,
					handle: {
						draggable: true,
						onDragStart: event => {
							// A row inside a draggable group starts its own drag, not the group's.
							event.stopPropagation();
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData("text/plain", key);
							change({ scope, key, over: null });
						},
						onDragEnd: () => change(null),
					},
					target: {
						onDragOver: event => {
							const now = current.current;
							// Another scope's drag passes up to the group that takes it.
							if (now?.scope !== scope) return;
							event.preventDefault();
							event.stopPropagation();
							const box = event.currentTarget.getBoundingClientRect();
							const where: Where = event.clientY < box.top + box.height / 2 ? "before" : "after";
							const over = now.key === key ? null : { key, where };
							if (now.over?.key !== over?.key || now.over?.where !== over?.where) change({ ...now, over });
						},
						onDrop: event => {
							const now = current.current;
							if (now?.scope !== scope) return;
							event.preventDefault();
							event.stopPropagation();
							if (now.over?.key === key) kept.onDrop(now.key, now.over.where);
							change(null);
						},
					},
				};
				item = kept;
				held.set(id, kept);
			}
			item.onDrop = onDrop;
			return {
				handle: item.handle,
				target: item.target,
				dropAt: drag?.scope === scope && drag.over?.key === key ? drag.over.where : null,
				dragging: drag?.scope === scope && drag.key === key,
			};
		},
		[drag, held, change],
	);
}
