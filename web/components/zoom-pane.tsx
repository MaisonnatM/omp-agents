/** `ZoomPane`, what a viewer dialog shows zoomed in or out as a browser zooms a page, and `ZoomControls`, its −, level, and + buttons. */
import { Minus, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";

/** The zoom levels the buttons and keys step through, as a browser's: 1 shows the content fitted to the pane. */
const LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 8] as const;
const MIN = LEVELS[0];
const MAX = LEVELS[LEVELS.length - 1];

/** The level after `zoom` in direction `by`, so a pinch's in-between level still steps to the next listed one. */
export function stepped(zoom: number, by: 1 | -1): number {
	const next = by === 1 ? LEVELS.find(level => level > zoom + 0.001) : LEVELS.findLast(level => level < zoom - 0.001);
	return next ?? zoom;
}

export interface Zoom {
	level: number;
	set: (level: number) => void;
	step: (by: 1 | -1) => void;
}

/** A zoom level that starts fitted and goes back to it when `resetKey` changes, such as when the viewer shows another image. */
export function useZoom(resetKey: unknown): Zoom {
	const [level, setLevel] = useState(1);
	const [key, setKey] = useState(resetKey);
	if (key !== resetKey) {
		setKey(resetKey);
		setLevel(1);
	}
	return { level, set: next => setLevel(Math.min(MAX, Math.max(MIN, next))), step: by => setLevel(current => stepped(current, by)) };
}

/** Zooms on +, −, and 0 like a browser's ⌘+, ⌘−, and ⌘0, which the desktop menu keeps for the whole window; `true` when it took the key. */
export function zoomKey(zoom: Zoom, event: KeyboardEvent): boolean {
	if (event.altKey || event.metaKey || event.ctrlKey) return false;
	if (event.key === "+" || event.key === "=") zoom.step(1);
	else if (event.key === "-" || event.key === "_") zoom.step(-1);
	else if (event.key === "0") zoom.set(1);
	else return false;
	event.preventDefault();
	return true;
}

/** The zoom buttons for a viewer's header: zoom out, the level, which resets it, and zoom in. */
export function ZoomControls({ zoom }: { zoom: Zoom }) {
	return (
		<div className="flex items-center">
			<span role="status" className="sr-only">
				Zoom {Math.round(zoom.level * 100)}%
			</span>
			<Tooltip content="Zoom out" shortcut={["−"]} disabled={zoom.level <= MIN}>
				<Button {...activityControl("viewer.zoom")} variant="ghost" size="icon-compact" aria-label="Zoom out" disabled={zoom.level <= MIN} onClick={() => zoom.step(-1)}>
					<Minus />
				</Button>
			</Tooltip>
			<Tooltip content="Fit to the window" shortcut={["0"]}>
				<Button {...activityControl("viewer.zoom")} variant="ghost" size="compact" aria-label={`Zoom ${Math.round(zoom.level * 100)}%, fit to the window`} className="min-w-14 tabular-nums" onClick={() => zoom.set(1)}>
					{Math.round(zoom.level * 100)}%
				</Button>
			</Tooltip>
			<Tooltip content="Zoom in" shortcut={["+"]} disabled={zoom.level >= MAX}>
				<Button {...activityControl("viewer.zoom")} variant="ghost" size="icon-compact" aria-label="Zoom in" disabled={zoom.level >= MAX} onClick={() => zoom.step(1)}>
					<Plus />
				</Button>
			</Tooltip>
		</div>
	);
}

/**
 * `children` laid out in the pane's box and scaled from there, as a browser zooms a page, scrolling when larger. A pinch
 * or ⌘/Ctrl+wheel zooms around the pointer, and a drag pans. `children` sizes itself to that box, such as `max-h-full max-w-full`.
 */
export function ZoomPane({ zoom, children, className }: { zoom: Zoom; children: ReactNode; className?: string }) {
	const pane = useRef<HTMLDivElement>(null);
	const [box, setBox] = useState<{ width: number; height: number } | null>(null);
	// Where the pointer was, in the content's fraction and the pane's pixels, for the zoom it asked for to keep it there.
	const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
	const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	useEffect(() => {
		const element = pane.current!;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
		});
		observer.observe(element);
		// React's wheel listener is passive, so it cannot stop the browser's own pinch zoom of the whole page.
		const wheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			const px = event.clientX - rect.left;
			const py = event.clientY - rect.top;
			anchor.current = { x: (element.scrollLeft + px) / element.scrollWidth, y: (element.scrollTop + py) / element.scrollHeight, px, py };
			// A trackpad pinch sends small steps; a mouse wheel notch, about 100, zooms by at most a quarter.
			zoomRef.current.set(zoomRef.current.level * Math.exp(-Math.max(-25, Math.min(25, event.deltaY)) / 100));
		};
		element.addEventListener("wheel", wheel, { passive: false });
		return () => {
			observer.disconnect();
			element.removeEventListener("wheel", wheel);
		};
	}, []);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;

	useEffect(() => {
		const element = pane.current!;
		const at = anchor.current;
		anchor.current = null;
		if (at) {
			element.scrollLeft = at.x * element.scrollWidth - at.px;
			element.scrollTop = at.y * element.scrollHeight - at.py;
		} else {
			element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
			element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
		}
	}, [zoom.level]);

	const pannable = zoom.level > 1;
	return (
		<div
			ref={pane}
			// Focusable while zoomed in, so the arrow keys and Page keys pan it as the drag does.
			tabIndex={pannable ? 0 : undefined}
			className={cn(
				"min-h-0 min-w-0 flex-1 overflow-auto outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
				pannable && (dragging ? "cursor-grabbing" : "cursor-grab"),
				className,
			)}
			onPointerDown={event => {
				if (!pannable || event.button !== 0) return;
				const element = event.currentTarget;
				drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
				element.setPointerCapture(event.pointerId);
				setDragging(true);
				event.preventDefault();
			}}
			onPointerMove={event => {
				const from = drag.current;
				if (!from) return;
				event.currentTarget.scrollLeft = from.left - (event.clientX - from.x);
				event.currentTarget.scrollTop = from.top - (event.clientY - from.y);
			}}
			onPointerUp={() => {
				drag.current = null;
				setDragging(false);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setDragging(false);
			}}
		>
			{box && (
				<div className="flex items-center justify-center" style={{ width: Math.max(box.width, box.width * zoom.level), height: Math.max(box.height, box.height * zoom.level) }}>
					<div className="shrink-0" style={{ width: box.width * zoom.level, height: box.height * zoom.level }}>
						<div className="flex origin-top-left items-center justify-center" style={{ width: box.width, height: box.height, transform: `scale(${zoom.level})` }}>
							{children}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
