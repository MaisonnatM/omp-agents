import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Fluid's built-in rail resizes by pointer only, collapses on click, and does
 * not persist. The dashboard keeps its roster visible, so this separator
 * replaces the rail: pointer drag, arrow keys, double-click to reset, and the
 * width stored in localStorage. It drives the Fluid sidebar's own width state.
 */
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 320;
const STEP = 16;
const STORAGE_KEY = "omp-agents.sidebar-width";

const clamp = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

export function storedSidebarWidth(): string {
	const stored = Number(localStorage.getItem(STORAGE_KEY));
	return `${Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT_WIDTH}px`;
}

export function SidebarResizeHandle() {
	const { width, setWidth } = useSidebar();
	const current = Number.parseFloat(width) || DEFAULT_WIDTH;
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);

	const commit = (next: number): void => {
		const clamped = clamp(next);
		setWidth(`${clamped}px`);
		localStorage.setItem(STORAGE_KEY, String(clamped));
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
		drag.current = { startX: event.clientX, startWidth: current };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
		if (drag.current) setWidth(`${clamp(drag.current.startWidth + event.clientX - drag.current.startX)}px`);
	};
	const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
		if (!drag.current) return;
		commit(drag.current.startWidth + event.clientX - drag.current.startX);
		drag.current = null;
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const step = event.shiftKey ? STEP * 4 : STEP;
		const next: Record<string, number> = {
			ArrowLeft: current - step,
			ArrowRight: current + step,
			Home: MIN_WIDTH,
			End: MAX_WIDTH,
		};
		const target = next[event.key];
		if (target === undefined) return;
		event.preventDefault();
		commit(target);
	};
	const reset = (): void => {
		setWidth(`${DEFAULT_WIDTH}px`);
		localStorage.removeItem(STORAGE_KEY);
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			aria-valuenow={Math.round(current)}
			title="Drag or use arrow keys to resize. Double-click to reset."
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={onKeyDown}
			onDoubleClick={reset}
			className="group absolute inset-y-0 -right-1.5 z-30 flex w-3 cursor-col-resize touch-none justify-center outline-none"
		>
			<span className="h-full w-px bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-ring group-active:bg-foreground/40" />
		</div>
	);
}
