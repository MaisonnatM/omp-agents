import { cn } from "@/lib/utils";
import { useStoredState } from "../stored-state";
import { Separator, useDragSeparator } from "./drag-separator";

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

export function SplitResizeHandle({ axis, ratio, onRatio, span = 1 }: SplitResizeHandleProps) {
	const columns = axis === "columns";
	const size = (element: HTMLDivElement): number => {
		const rect = (element.parentElement as HTMLElement).getBoundingClientRect();
		return columns ? rect.width : rect.height;
	};
	const events = useDragSeparator({
		value: ratio,
		onValue: onRatio,
		axis: columns ? "vertical" : "horizontal",
		keyStep: STEP,
		shiftSteps: 5,
		min: 0,
		max: 1,
		reset: DEFAULT_RATIO,
		size,
		clamp: (next, element) => clamp(next, axis, size(element)),
		read: (event, start) => {
			const at = columns ? event.clientX : event.clientY;
			return clamp(start.value + (at - start.coordinate) / (start.size - 1), axis, start.size);
		},
	});
	const along = `calc(${splitAt(ratio)} + 0.5px)`;
	const across = span === 1 ? "100%" : splitAt(span);
	return (
		<Separator
			{...events}
			axis={columns ? "vertical" : "horizontal"}
			label={columns ? "Resize columns" : "Resize rows"}
			min={0}
			max={100}
			now={Math.round(ratio * 100)}
			style={columns ? { left: along, height: across } : { top: along, width: across }}
			className={cn("select-none", columns ? "top-0 w-3 -translate-x-1/2 cursor-col-resize" : "left-0 h-3 -translate-y-1/2 cursor-row-resize flex-col")}
		/>
	);
}
