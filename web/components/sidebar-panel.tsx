/** `DashboardSidebar`, one of the dashboard's two sidebars, resizable and closeable; `useSidebarPanels` keeps both panels' state and `SidebarToggle` shows or hides one. */
import { type LucideIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Sidebar, type SidebarSide } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { Separator, useDragSeparator } from "./drag-separator";

/**
 * The dashboard's two sidebars, each one resizable and closeable on its own. Fluid's provider holds a single width
 * and open state, and its rail resizes by pointer only and collapses on click without persisting. So each side keeps
 * its own state here, stored in localStorage, and a separator replaces the rail: pointer drag, arrow keys, and
 * double-click to reset.
 */
const MIN_WIDTH = 240;
const MAX_WIDTH = 560;
const STEP = 16;
/** The show and hide motion: a drawer's curve, fast out of the gate and settling without overshoot. */
const MOTION_MS = 260;
const MOTION = "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

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
	/**
	 * The strip the hidden sidebar leaves for its toggle, which then rides the sidebar's outer edge: 9 px in from it,
	 * where the header's `px-2` and border put its last button, and centered in the strip. 0 leaves none, and the toggle
	 * sits in the pane header instead.
	 */
	rail: number;
	/** Lays the wrapper out on its side: the content stays put against the outer edge while the width slides. */
	frame: string;
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
		rail: 46,
		frame: "",
	},
	right: {
		name: "Session details",
		id: "details-sidebar",
		defaultWidth: 288,
		widthKey: "omp-agents.plan-width",
		openKey: "omp-agents.plan-open",
		shortcut: "detailsSidebar",
		hideIcon: PanelRightClose,
		showIcon: PanelRightOpen,
		rail: 0,
		frame: "order-last justify-end",
	},
};

export interface SidebarPanel {
	open: boolean;
	/** In px, within {@link MIN_WIDTH} and {@link MAX_WIDTH}. */
	width: number;
}

const clamp = (width: number): number => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

interface StoredPanel {
	panel: SidebarPanel;
	setWidth: (width: number) => void;
	setOpen: (open: boolean) => void;
}

/** `side`'s panel as localStorage keeps it. A default is removed rather than stored, so a reset sidebar follows the default if it changes. */
function useStoredPanel(side: SidebarSide): StoredPanel {
	const { widthKey, openKey, defaultWidth } = SIDEBARS[side];
	const [width, setWidth] = useStoredState(widthKey, raw => {
		const stored = Number(raw);
		return Number.isFinite(stored) && stored > 0 ? clamp(stored) : defaultWidth;
	});
	const [open, setOpen] = useStoredState(openKey, raw => raw !== "false");
	return { panel: { open, width }, setWidth, setOpen };
}

export interface SidebarPanels {
	panels: Record<SidebarSide, SidebarPanel>;
	resize: (side: SidebarSide, width: number) => void;
	/** Shows or hides `side`. Focus inside what hides moves to the toggle that replaces it. */
	setOpen: (side: SidebarSide, open: boolean) => void;
}

export function useSidebarPanels(): SidebarPanels {
	const sides: Record<SidebarSide, StoredPanel> = { left: useStoredPanel("left"), right: useStoredPanel("right") };
	return {
		panels: { left: sides.left.panel, right: sides.right.panel },
		resize: (side, width) => sides[side].setWidth(clamp(width)),
		setOpen: (side, open) => {
			if (open === sides[side].panel.open) return;
			const { id } = SIDEBARS[side];
			const hiding = document.querySelector(open ? `[aria-controls="${id}"][aria-expanded="false"]` : `#${id}`);
			const refocus = hiding?.contains(document.activeElement) ?? false;
			flushSync(() => sides[side].setOpen(open));
			if (refocus) document.querySelector<HTMLElement>(`[aria-controls="${id}"]:not([hidden] *)`)?.focus();
		},
	};
}

interface SidebarToggleProps {
	side: SidebarSide;
	open: boolean;
	onToggle: () => void;
}

/** Shows or hides a sidebar: the left one's from the corner it rides on, the right one's from the pane header. */
export function SidebarToggle({ side, open, onToggle }: SidebarToggleProps) {
	const { name, id, shortcut, hideIcon: Hide, showIcon: Show } = SIDEBARS[side];
	return (
		<Tooltip content={`${open ? "Hide" : "Show"} the ${name.toLowerCase()} sidebar`} shortcut={shortcutLabels(shortcut)} side="bottom">
			<Button
				variant="ghost"
				size="icon-compact"
				className="shrink-0 text-muted-foreground"
				aria-label={`${name} sidebar`}
				aria-expanded={open}
				aria-controls={id}
				onClick={onToggle}
			>
				{open ? <Hide /> : <Show />}
			</Button>
		</Tooltip>
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
	const direction = side === "left" ? 1 : -1;
	const events = useDragSeparator({
		value: width,
		onValue: onWidth,
		axis: "vertical",
		direction,
		keyStep: STEP,
		shiftSteps: 4,
		min: MIN_WIDTH,
		max: MAX_WIDTH,
		reset: defaultWidth,
		read: (event, start) => start.value + direction * (event.clientX - start.coordinate),
	});
	return (
		<Separator
			{...events}
			axis="vertical"
			label={`Resize the ${name.toLowerCase()} sidebar`}
			min={MIN_WIDTH}
			max={MAX_WIDTH}
			now={width}
			className={cn("inset-y-0 w-3 cursor-col-resize", side === "left" ? "-right-1.5" : "-left-1.5")}
		/>
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
 * A sidebar with its resize handle, sliding its width open and shut. A sidebar with a rail keeps its toggle on its
 * outer edge, so the toggle glides from the header's corner to the rail with the edge and follows a resize drag. The
 * hidden sidebar stays mounted, so its filter and scroll survive; the right one's toggle sits in the pane header (see `App`).
 */
export function DashboardSidebar({ side, panel, onResize, onToggle, children }: DashboardSidebarProps) {
	const { id, rail, frame } = SIDEBARS[side];
	// While the width moves: the transition applies only then, so a resize drag follows the pointer without lag.
	const [moving, setMoving] = useState(false);
	const [shownOpen, setShownOpen] = useState(panel.open);
	if (shownOpen !== panel.open) {
		setShownOpen(panel.open);
		setMoving(true);
	}
	useEffect(() => {
		if (!moving) return;
		const timer = window.setTimeout(() => setMoving(false), MOTION_MS);
		return () => window.clearTimeout(timer);
	}, [moving, panel.open]);
	return (
		<div
			className={cn(
				"relative flex h-full shrink-0",
				frame,
				(!panel.open || moving) && "overflow-hidden",
				moving && cn("transition-[width]", MOTION),
				rail > 0 && !panel.open && "border-r border-border",
			)}
			style={{ width: panel.open ? panel.width : rail, transitionDuration: `${MOTION_MS}ms` }}
		>
			{/* Closing, it turns inert at once so focus and clicks leave it, and hidden once the width has slid shut. */}
			<Sidebar id={id} side={side} hidden={!panel.open && !moving} inert={!panel.open} className="relative h-full" style={{ width: panel.width }}>
				{children}
				<SidebarResizeHandle side={side} width={panel.width} onWidth={onResize} />
			</Sidebar>
			{rail > 0 && (
				<div className="absolute top-[calc((var(--page-header-height)-1.75rem)/2)] right-[9px] z-10">
					<SidebarToggle side={side} open={panel.open} onToggle={onToggle} />
				</div>
			)}
		</div>
	);
}
