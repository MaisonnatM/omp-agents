import { type LucideIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Sidebar, type SidebarSide } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { chordLabel, type ShortcutId, SHORTCUTS } from "../shortcuts";

/**
 * The dashboard's two sidebars, each one resizable and closeable on its own. Fluid's provider holds a single width
 * and open state, and its rail resizes by pointer only and collapses on click without persisting. So each side keeps
 * its own state here, stored in localStorage, and a separator replaces the rail: pointer drag, arrow keys, and
 * double-click to reset.
 */
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;
const STEP = 16;

interface SidebarSpec {
	/** What the sidebar lists, as its controls name it. */
	name: string;
	id: string;
	defaultWidth: number;
	widthKey: string;
	openKey: string;
	shortcut: ShortcutId;
	hideIcon: LucideIcon;
	showIcon: LucideIcon;
}

const SIDEBARS: Record<SidebarSide, SidebarSpec> = {
	left: {
		name: "Sessions",
		id: "sessions-sidebar",
		defaultWidth: 320,
		widthKey: "omp-agents.sidebar-width",
		openKey: "omp-agents.sidebar-open",
		shortcut: "sessionsSidebar",
		hideIcon: PanelLeftClose,
		showIcon: PanelLeftOpen,
	},
	right: {
		name: "Subagents",
		id: "subagents-sidebar",
		defaultWidth: 288,
		widthKey: "omp-agents.subagents-width",
		openKey: "omp-agents.subagents-open",
		shortcut: "subagentsSidebar",
		hideIcon: PanelRightClose,
		showIcon: PanelRightOpen,
	},
};

export interface SidebarPanel {
	open: boolean;
	/** In px, within {@link MIN_WIDTH} and {@link MAX_WIDTH}. */
	width: number;
}

const clamp = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

function storedPanel(side: SidebarSide): SidebarPanel {
	const { widthKey, openKey, defaultWidth } = SIDEBARS[side];
	const width = Number(localStorage.getItem(widthKey));
	return { open: localStorage.getItem(openKey) !== "false", width: Number.isFinite(width) && width > 0 ? clamp(width) : defaultWidth };
}

/** A default is removed rather than stored, so a reset sidebar follows the default if it changes. */
function store(key: string, value: string, fallback: string): void {
	if (value === fallback) localStorage.removeItem(key);
	else localStorage.setItem(key, value);
}

export interface SidebarPanels {
	panels: Record<SidebarSide, SidebarPanel>;
	resize: (side: SidebarSide, width: number) => void;
	/** Shows or hides `side`. Focus inside what hides moves to the toggle that replaces it. */
	setOpen: (side: SidebarSide, open: boolean) => void;
}

export function useSidebarPanels(): SidebarPanels {
	const [panels, setPanels] = useState(() => ({ left: storedPanel("left"), right: storedPanel("right") }));
	const update = (side: SidebarSide, panel: SidebarPanel): void => {
		const { widthKey, openKey, defaultWidth } = SIDEBARS[side];
		store(widthKey, String(panel.width), String(defaultWidth));
		store(openKey, String(panel.open), "true");
		setPanels(current => ({ ...current, [side]: panel }));
	};
	return {
		panels,
		resize: (side, width) => update(side, { ...panels[side], width: clamp(width) }),
		setOpen: (side, open) => {
			if (open === panels[side].open) return;
			const { id } = SIDEBARS[side];
			const hiding = document.querySelector(open ? `[data-sidebar-strip="${side}"]` : `#${id}`);
			const refocus = hiding?.contains(document.activeElement) ?? false;
			flushSync(() => update(side, { ...panels[side], open }));
			if (refocus) document.querySelector<HTMLElement>(`[aria-controls="${id}"]:not([hidden] *)`)?.focus();
		},
	};
}

interface SidebarToggleProps {
	side: SidebarSide;
	open: boolean;
	onToggle: () => void;
}

/** Hides the sidebar from its header, or shows it again from the strip left in its place. */
export function SidebarToggle({ side, open, onToggle }: SidebarToggleProps) {
	const { name, id, shortcut, hideIcon: Hide, showIcon: Show } = SIDEBARS[side];
	const chord = SHORTCUTS.find(({ id }) => id === shortcut)?.chord;
	const action = `${open ? "Hide" : "Show"} the ${name.toLowerCase()} sidebar`;
	return (
		<Button
			variant="ghost"
			size="icon-compact"
			className="shrink-0 text-muted-foreground"
			aria-label={`${name} sidebar`}
			aria-expanded={open}
			aria-controls={id}
			title={chord ? `${action} (${chordLabel(chord)})` : action}
			onClick={onToggle}
		>
			{open ? <Hide /> : <Show />}
		</Button>
	);
}

interface SidebarResizeHandleProps {
	side: SidebarSide;
	width: number;
	onWidth: (width: number) => void;
}

function SidebarResizeHandle({ side, width, onWidth }: SidebarResizeHandleProps) {
	const { name, defaultWidth } = SIDEBARS[side];
	// The handle sits on the sidebar's inner edge: moving it toward the page widens the left sidebar and narrows the right one.
	const sign = side === "left" ? 1 : -1;
	const drag = useRef<{ startX: number; startWidth: number } | null>(null);
	const dragged = (event: PointerEvent<HTMLDivElement>, { startX, startWidth }: { startX: number; startWidth: number }): number =>
		startWidth + sign * (event.clientX - startX);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
		drag.current = { startX: event.clientX, startWidth: width };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
		if (drag.current) onWidth(dragged(event, drag.current));
	};
	const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
		if (!drag.current) return;
		onWidth(dragged(event, drag.current));
		drag.current = null;
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		const step = event.shiftKey ? STEP * 4 : STEP;
		const next: Record<string, number> = {
			ArrowLeft: width - sign * step,
			ArrowRight: width + sign * step,
			Home: MIN_WIDTH,
			End: MAX_WIDTH,
		};
		const target = next[event.key];
		if (target === undefined) return;
		event.preventDefault();
		onWidth(target);
	};

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize the ${name.toLowerCase()} sidebar`}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			aria-valuenow={width}
			title="Drag or use arrow keys to resize. Double-click to reset."
			tabIndex={0}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				drag.current = null;
			}}
			onKeyDown={onKeyDown}
			onDoubleClick={() => onWidth(defaultWidth)}
			className={cn(
				"group absolute inset-y-0 z-30 flex w-3 cursor-col-resize touch-none justify-center outline-none",
				side === "left" ? "-right-1.5" : "-left-1.5",
			)}
		>
			<span className="h-full w-px bg-transparent transition-colors group-hover:bg-foreground/25 group-focus-visible:bg-ring group-active:bg-foreground/40" />
		</div>
	);
}

interface DashboardSidebarProps {
	side: SidebarSide;
	panel: SidebarPanel;
	onResize: (width: number) => void;
	onToggle: () => void;
	children: ReactNode;
}

/**
 * A sidebar with its resize handle, or, while it is hidden, a strip holding the button that shows it again. The hidden
 * sidebar stays mounted, so its filter and scroll survive.
 */
export function DashboardSidebar({ side, panel, onResize, onToggle, children }: DashboardSidebarProps) {
	return (
		<>
			<Sidebar id={SIDEBARS[side].id} side={side} collapsible="none" hidden={!panel.open} className="relative" style={{ width: panel.width }}>
				{children}
				<SidebarResizeHandle side={side} width={panel.width} onWidth={onResize} />
			</Sidebar>
			{!panel.open && (
				<div
					data-sidebar-strip={side}
					className={cn(
						"sticky top-0 flex h-svh shrink-0 flex-col pt-4",
						side === "left" ? "border-r border-border px-2" : "order-last border-l border-border px-3",
					)}
				>
					<SidebarToggle side={side} open={false} onToggle={onToggle} />
				</div>
			)}
		</>
	);
}
