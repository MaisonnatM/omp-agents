import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from "react";

/** A point in the viewport, or how far the pointer moved since its press. */
export interface Point {
	x: number;
	y: number;
}

interface PointerDragOptions {
	/** How far the pointer moves before a press becomes a drag, so a click still clicks. */
	liftDistance: number;
	/** The element the pointer scrolls sideways while it nears the element's left or right edge. */
	scroller: RefObject<HTMLElement | null>;
	/** Whether the press may become a drag; the caller notes what was pressed. */
	onPress: (event: ReactPointerEvent<HTMLElement>) => boolean;
	/** The press became a drag. */
	onLift: () => void;
	/** The pointer moved to `point`, `moved` from where it pressed, or the scroller scrolled under it. */
	onMove: (point: Point, moved: Point) => void;
	/** The pointer let go. */
	onDrop: () => void;
	/** The browser cancelled the pointer, or Esc did. */
	onCancel: () => void;
}

/** How close to the scroller's left or right edge the pointer scrolls it, and by how much a frame. */
const EDGE = 64;
const EDGE_STEP = 14;

/**
 * A mouse or pen drag by the pointer, which the caller's handlers turn into what is dragged and where it lands. While it
 * drags, the cursor grabs, nothing is selected, the scroller scrolls near its edges, and Esc cancels it; the click its
 * release makes is swallowed. Spread its handlers on the element whose presses may drag.
 */
export function usePointerDrag(options: PointerDragOptions): { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void; onClickCapture: (event: ReactMouseEvent) => void } {
	// The listeners outlive the render that added them, so they call the latest handlers.
	const latest = useRef(options);
	latest.current = options;
	/** Ends the press in progress, if any. */
	const end = useRef<(() => void) | null>(null);
	/** Whether a drag just ended, so the click its release makes does not reach what it was dropped on. */
	const dropped = useRef(false);
	useEffect(() => () => end.current?.(), []);

	const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
		if (event.button !== 0 || event.pointerType === "touch" || end.current || !latest.current.onPress(event)) return;
		const start = { x: event.clientX, y: event.clientY };
		let pointer = start;
		let lifted = false;
		let frame = 0;
		const moved = (): Point => ({ x: pointer.x - start.x, y: pointer.y - start.y });
		const edgeScroll = (): void => {
			const scroller = latest.current.scroller.current;
			if (scroller) {
				const { left, right } = scroller.getBoundingClientRect();
				const by = pointer.x < left + EDGE ? -EDGE_STEP : pointer.x > right - EDGE ? EDGE_STEP : 0;
				if (by !== 0 && scroller.scrollWidth > scroller.clientWidth) {
					scroller.scrollLeft += by;
					latest.current.onMove(pointer, moved());
				}
			}
			frame = requestAnimationFrame(edgeScroll);
		};
		const stop = (): void => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", escape, true);
			cancelAnimationFrame(frame);
			document.body.style.removeProperty("cursor");
			end.current = null;
		};
		function move(next: PointerEvent): void {
			pointer = { x: next.clientX, y: next.clientY };
			if (!lifted) {
				if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < latest.current.liftDistance) return;
				lifted = true;
				window.getSelection()?.removeAllRanges();
				document.body.style.cursor = "grabbing";
				latest.current.onLift();
				frame = requestAnimationFrame(edgeScroll);
			}
			latest.current.onMove(pointer, moved());
		}
		function up(): void {
			stop();
			if (!lifted) return;
			dropped.current = true;
			// The click follows the release in the same task, so one released off the element, which never reaches it, is forgotten after.
			setTimeout(() => {
				dropped.current = false;
			});
			latest.current.onDrop();
		}
		function cancel(): void {
			stop();
			if (lifted) latest.current.onCancel();
		}
		function escape(key: KeyboardEvent): void {
			if (key.key !== "Escape" || !lifted) return;
			key.preventDefault();
			key.stopPropagation();
			cancel();
		}
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", escape, true);
		end.current = stop;
	};

	const onClickCapture = (event: ReactMouseEvent): void => {
		if (!dropped.current) return;
		dropped.current = false;
		event.preventDefault();
		event.stopPropagation();
	};

	return { onPointerDown, onClickCapture };
}
