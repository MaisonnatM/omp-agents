import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { cn } from "@/lib/utils";
import { useStoredState } from "../stored-state";

/**
 * The line between split panes, as a separator laid over the grid's 1px gap: pointer drag, arrow keys,
 * double-click to reset, and the ratio stored in localStorage at every change, drag moves included, like the
 * sidebar's handle. The ratio is the first column's share of the width, or the first row's share of the height.
 */
export type SplitAxis = "columns" | "rows";

/** Narrowest pane, in px, that a drag or key leaves on either side. */
const MIN_PANE: Record<SplitAxis, number> = { columns: 320, rows: 160 };
const DEFAULT_RATIO = 0.5;
const STEP = 0.02;
const STORAGE_KEYS: Record<SplitAxis, string> = {
	columns: "omp-agents.split-columns",
	rows: "omp-agents.split-rows",
};

/** `ratio` of a `size`-px grid, kept so both sides get {@link MIN_PANE}, or an even split when they cannot. */
function clamp(ratio: number, axis: SplitAxis, size: number): number {
	const min = Math.min(DEFAULT_RATIO, MIN_PANE[axis] / size);
	return Math.min(1 - min, Math.max(min, ratio));
}

/** The ratio of `axis` that localStorage keeps, and its setter. */
export const useSplitRatio = (axis: SplitAxis): [number, (ratio: number) => void] =>
	useStoredState(STORAGE_KEYS[axis], raw => {
		const stored = Number(raw);
		return stored > 0 && stored < 1 ? stored : DEFAULT_RATIO;
	});

/** Where a track boundary sits in a grid with a 1px gap, `ratio` of the way along it. */
export const splitAt = (ratio: number): string => `calc((100% - 1px) * ${ratio})`;

interface SplitResizeHandleProps {
	axis: SplitAxis;
	ratio: number;
	onRatio: (ratio: number) => void;
	/** Share of the cross axis the line runs along from the start: the top row only, when one pane spans the bottom. */
	span?: number;
}

/** Where a drag started along the axis, the ratio then, and the grid's size along the axis. */
interface Drag {
	start: number;
	startRatio: number;
	size: number;
}

export function SplitResizeHandle({ axis, ratio, onRatio, span = 1 }: SplitResizeHandleProps) {
	const columns = axis === "columns";
	const drag = useRef<Drag | null>(null);
	const gridSize = (element: HTMLElement): number => {
		const rect = (element.parentElement as HTMLElement).getBoundingClientRect();
		return columns ? rect.width : rect.height;
	};
	const pointer = (event: PointerEvent<HTMLDivElement>): number => (columns ? event.clientX : event.clientY);
	const dragged = (event: PointerEvent<HTMLDivElement>, { start, startRatio, size }: Drag): number =>
		clamp(startRatio + (pointer(event) - start) / (size - 1), axis, size);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
		drag.current = { start: pointer(event), startRatio: ratio, size: gridSize(event.currentTarget) };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
		if (drag.current) onRatio(dragged(event, drag.current));
	};
	const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
		if (!drag.current) return;
		onRatio(dragged(event, drag.current));
		drag.current = null;
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const step = event.shiftKey ? STEP * 5 : STEP;
		const next: Record<string, number> = columns
			? { ArrowLeft: ratio - step, ArrowRight: ratio + step, Home: 0, End: 1 }
			: { ArrowUp: ratio - step, ArrowDown: ratio + step, Home: 0, End: 1 };
		const target = next[event.key];
		if (target === undefined) return;
		event.preventDefault();
		onRatio(clamp(target, axis, gridSize(event.currentTarget)));
	};

	const along = `calc(${splitAt(ratio)} + 0.5px)`;
	const across = span === 1 ? "100%" : splitAt(span);
	return (
		<div
			role="separator"
			aria-orientation={columns ? "vertical" : "horizontal"}
			aria-label={columns ? "Resize columns" : "Resize rows"}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(ratio * 100)}
			title="Drag or use arrow keys to resize. Double-click to reset."
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={onKeyDown}
			onDoubleClick={() => onRatio(DEFAULT_RATIO)}
			style={columns ? { left: along, height: across } : { top: along, width: across }}
			className={cn(
				"group absolute z-30 flex touch-none select-none justify-center outline-none",
				columns ? "top-0 w-3 -translate-x-1/2 cursor-col-resize" : "left-0 h-3 -translate-y-1/2 cursor-row-resize flex-col",
			)}
		>
			<span
				className={cn(
					"bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-ring group-active:bg-foreground/40",
					columns ? "h-full w-px" : "h-px w-full",
				)}
			/>
		</div>
	);
}
