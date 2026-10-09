import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Axis = "horizontal" | "vertical";
type Drag = { coordinate: number; value: number; size: number };

interface DragSeparatorOptions {
	value: number;
	onValue: (value: number) => void;
	axis: Axis;
	read: (event: PointerEvent<HTMLDivElement>, start: Drag) => number;
	keyStep: number;
	shiftSteps: number;
	/** The value decreases toward the right or the bottom: a right-hand sidebar's width, a bottom panel's height. */
	direction?: 1 | -1;
	min: number;
	max: number;
	reset: number;
	size?: (element: HTMLDivElement) => number;
	clamp?: (value: number, element: HTMLDivElement) => number;
}

export interface DragSeparatorEvents {
	onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
	onPointerCancel: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onDoubleClick: () => void;
}

/** The pointer, keyboard and reset gestures shared by sidebar widths and split ratios. */
export function useDragSeparator({ value, onValue, axis, read, keyStep, shiftSteps, direction = 1, min, max, reset, size, clamp }: DragSeparatorOptions): DragSeparatorEvents {
	const drag = useRef<Drag | null>(null);
	const coordinate = (event: PointerEvent<HTMLDivElement>): number => (axis === "vertical" ? event.clientX : event.clientY);
	return {
		onPointerDown: (event: PointerEvent<HTMLDivElement>): void => {
			drag.current = { coordinate: coordinate(event), value, size: size?.(event.currentTarget) ?? 0 };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove: (event: PointerEvent<HTMLDivElement>): void => {
			if (drag.current) onValue(read(event, drag.current));
		},
		onPointerUp: (event: PointerEvent<HTMLDivElement>): void => {
			if (!drag.current) return;
			onValue(read(event, drag.current));
			drag.current = null;
		},
		onPointerCancel: (): void => {
			drag.current = null;
		},
		onKeyDown: (event: KeyboardEvent<HTMLDivElement>): void => {
			const step = keyStep * (event.shiftKey ? shiftSteps : 1);
			const next: Record<string, number> = axis === "vertical"
				? { ArrowLeft: value - direction * step, ArrowRight: value + direction * step, Home: min, End: max }
				: { ArrowUp: value - direction * step, ArrowDown: value + direction * step, Home: min, End: max };
			const target = next[event.key];
			if (target === undefined) return;
			event.preventDefault();
			onValue(clamp ? clamp(target, event.currentTarget) : target);
		},
		onDoubleClick: (): void => onValue(reset),
	};
}

interface SeparatorProps extends DragSeparatorEvents {
	axis: Axis;
	label: string;
	min: number;
	max: number;
	now: number;
	className: string;
	style?: CSSProperties;
	children?: ReactNode;
}

/** The accessible separator element and its interaction line, independent of the value's domain. */
export function Separator({ axis, label, min, max, now, className, style, children, ...events }: SeparatorProps) {
	return (
		<Tooltip content="Drag or use arrow keys to resize. Double-click to reset.">
			<div
				role="separator"
				aria-orientation={axis}
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={now}
				tabIndex={0}
				style={style}
				className={cn("group absolute z-30 flex touch-none justify-center outline-none", className)}
				{...events}
			>
				<span className={cn("bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-ring group-active:bg-foreground/40", axis === "vertical" ? "h-full w-px" : "h-px w-full")} />
				{children}
			</div>
		</Tooltip>
	);
}
