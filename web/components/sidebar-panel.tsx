/** `DashboardSidebar`, one of the dashboard's two sidebars, resizable and closeable; `useSidebarPanels` keeps both panels' state and `SidebarToggle` shows or hides one. */
import { type LucideIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Sidebar, type SidebarSide } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
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
/** What the session pane keeps between the sidebars, in px, however wide the right one is dragged. */
const PANE_MIN_WIDTH = 480;
const STEP = 16;
/** Tailwind's `sm`: below it, a floating sidebar takes the screen up to {@link SIDEBARS}' rail. */
const PHONE_MAX_WIDTH = 640;
/** The show and hide motion: a drawer's curve, fast out of the gate and settling without overshoot. */
const MOTION_MS = 260;
const MOTION = "ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

interface SidebarSpec {
	/** What the sidebar lists, as its controls name it. */
	name: string;
	id: string;
	defaultWidth: number;
	/** In px; the right sidebar goes wider, so the Browser can show an app at a laptop's width, as far as the session pane keeps {@link PANE_MIN_WIDTH}. */
	maxWidth: number;
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
		maxWidth: 560,
		widthKey: "omp-agents.sidebar-width",
		openKey: "omp-agents.sidebar-open",
		shortcut: "sessionsSidebar",
		hideIcon: PanelLeftClose,
		showIcon: PanelLeftOpen,
		rail: 46,
		frame: "",
	},
	right: {
		name: "Details",
		id: "details-sidebar",
		defaultWidth: 288,
		maxWidth: 960,
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
	/** In px, within {@link MIN_WIDTH} and {@link SidebarPanel.max}. */
	width: number;
	/** The widest the sidebar can be in the window now, in px. */
	max: number;
	/** The window is too narrow to keep the sidebar beside a usable page, so the open sidebar floats over the page instead of shrinking it. */
	floating: boolean;
}

const clamp = (width: number, max: number): number => Math.round(Math.min(max, Math.max(MIN_WIDTH, width)));

interface StoredPanel {
	open: boolean;
	/** As stored, which a narrow window can cut without changing it. */
	width: number;
	setWidth: (width: number) => void;
	setOpen: (open: boolean) => void;
}

/** `side`'s panel as localStorage keeps it. A default is removed rather than stored, so a reset sidebar follows the default if it changes. */
function useStoredPanel(side: SidebarSide): StoredPanel {
	const { widthKey, openKey, defaultWidth } = SIDEBARS[side];
	const [width, setWidth] = useStoredState(widthKey, raw => {
		const stored = Number(raw);
		return Number.isFinite(stored) && stored > 0 ? stored : defaultWidth;
	});
	const [open, setOpen] = useStoredState(openKey, raw => raw !== "false");
	return { open, width, setWidth, setOpen };
}

const subscribeResize = (onChange: () => void): (() => void) => {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
};

export interface SidebarPanels {
	panels: Record<SidebarSide, SidebarPanel>;
	resize: (side: SidebarSide, width: number) => void;
	/** Shows or hides `side`. Focus inside what hides moves to the toggle that replaces it. */
	setOpen: (side: SidebarSide, open: boolean) => void;
}

export function useSidebarPanels(): SidebarPanels {
	const stored: Record<SidebarSide, StoredPanel> = { left: useStoredPanel("left"), right: useStoredPanel("right") };
	const windowWidth = useSyncExternalStore(subscribeResize, () => window.innerWidth);
	const floating = windowWidth < MIN_WIDTH + PANE_MIN_WIDTH;
	// A floating sidebar covers the page, as on a phone, so it opens only when asked and stays out of what this window stores.
	const [floatingOpen, setFloatingOpen] = useState<Record<SidebarSide, boolean>>({ left: false, right: false });
	const sides: Record<SidebarSide, Pick<StoredPanel, "open" | "setOpen">> = floating
		? {
				left: { open: floatingOpen.left, setOpen: open => setFloatingOpen(shown => ({ ...shown, left: open })) },
				right: { open: floatingOpen.right, setOpen: open => setFloatingOpen(shown => ({ ...shown, right: open })) },
			}
		: stored;
	// A floating sidebar leaves a rail's width of the page uncovered, which a tap closes it on; on a phone it takes all the rest, since its rows and the Details tabs cut to nothing in a desktop sidebar's width.
	const floatingMax = Math.max(MIN_WIDTH, windowWidth - SIDEBARS.left.rail);
	const phone = windowWidth < PHONE_MAX_WIDTH;
	const panel = (side: SidebarSide, max: number): SidebarPanel => ({ open: sides[side].open, width: phone ? max : clamp(stored[side].width, max), max, floating });
	const left = panel("left", floating ? floatingMax : SIDEBARS.left.maxWidth);
	const leftShown = left.open ? left.width : SIDEBARS.left.rail;
	const panels = { left, right: panel("right", floating ? floatingMax : Math.max(MIN_WIDTH, Math.min(SIDEBARS.right.maxWidth, windowWidth - leftShown - PANE_MIN_WIDTH))) };
	return {
		panels,
		resize: (side, width) => stored[side].setWidth(clamp(width, panels[side].max)),
		setOpen: (side, open) => {
			if (open === sides[side].open) return;
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
				{...activityControl(side === "left" ? "sidebar.left.toggle" : "sidebar.right.toggle")}
				variant="ghost"
				size="icon-compact"
				// On a touch screen the left toggle, alone in its corner, takes taps 8px around its 28px, the 44px a finger needs; the right one sits among the header's buttons.
				className={cn("shrink-0 text-muted-foreground", side === "left" && "pointer-coarse:after:absolute pointer-coarse:after:-inset-2")}
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
	max: number;
	onWidth: (width: number) => void;
	onDragging: (dragging: boolean) => void;
}

function SidebarResizeHandle({ side, width, max, onWidth, onDragging }: SidebarResizeHandleProps) {
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
		max,
		reset: defaultWidth,
		read: (event, start) => start.value + direction * (event.clientX - start.coordinate),
	});
	return (
		<Separator
			{...events}
			onPointerDown={event => {
				onDragging(true);
				events.onPointerDown(event);
			}}
			onPointerUp={event => {
				onDragging(false);
				events.onPointerUp(event);
			}}
			onPointerCancel={() => {
				onDragging(false);
				events.onPointerCancel();
			}}
			onLostPointerCapture={() => onDragging(false)}
			axis="vertical"
			label={`Resize the ${name.toLowerCase()} sidebar`}
			min={MIN_WIDTH}
			max={max}
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
	/** The address of what the page shows; a change closes a floating sidebar. */
	address: string;
	children: ReactNode;
}

/**
 * A sidebar with its resize handle, sliding its width open and shut. A sidebar with a rail keeps its toggle on its
 * outer edge, so the toggle glides from the header's corner to the rail with the edge and follows a resize drag. The
 * hidden sidebar stays mounted, so its filter and scroll survive; the right one's toggle sits in the pane header (see `App`).
 */
export function DashboardSidebar({ side, panel, onResize, onToggle, address, children }: DashboardSidebarProps) {
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
	// A floating sidebar is a place to pick where to go: once a pick changes the address, it gets out of the page's way.
	const floatingOpen = panel.floating && panel.open;
	const shownAddress = useRef(address);
	useEffect(() => {
		if (shownAddress.current === address) return;
		shownAddress.current = address;
		if (floatingOpen) onToggle();
	}, [address, floatingOpen, onToggle]);
	// While a resize drag runs: a page in a `<webview>`, the Browser's, would take the pointer from the handle's capture once it crosses into it.
	const [dragging, setDragging] = useState(false);
	const sliding = !panel.floating && moving;
	// A floating sidebar leaves no rail: its toggle floats over the page header's corner, which `Header` keeps clear, so the page gets the whole width.
	const shownRail = panel.floating ? 0 : rail;
	return (
		<div
			className={cn(
				"relative flex h-full shrink-0",
				frame,
				!panel.floating && (!panel.open || moving) && "overflow-hidden",
				sliding && cn("transition-[width]", MOTION),
				shownRail > 0 && !panel.open && "border-r border-border",
			)}
			style={{ width: panel.open && !panel.floating ? panel.width : shownRail, transitionDuration: `${MOTION_MS}ms` }}
		>
			{floatingOpen && <button type="button" aria-label={`Hide the ${SIDEBARS[side].name.toLowerCase()} sidebar`} className="fixed inset-0 z-30 cursor-default bg-black/20" onClick={onToggle} />}
			{/* Closing, it turns inert at once so focus and clicks leave it, and hidden once the width has slid shut. */}
			<Sidebar
				id={id}
				side={side}
				hidden={!panel.open && !sliding}
				inert={!panel.open}
				className={cn(panel.floating ? cn("absolute inset-y-0 z-40 bg-background shadow-xl", side === "left" ? "left-0" : "right-0") : "relative", "h-full", dragging && "[&_webview]:pointer-events-none")}
				style={{ width: panel.width }}
			>
				{children}
				<SidebarResizeHandle side={side} width={panel.width} max={panel.max} onWidth={onResize} onDragging={setDragging} />
			</Sidebar>
			{rail > 0 && (
				<div
					className={cn("absolute top-[calc((var(--page-header-height)-1.75rem)/2)]", floatingOpen ? "z-50" : panel.floating ? "left-[9px] z-20" : "right-[9px] z-10")}
					style={floatingOpen ? { left: panel.width - 9 - 28 } : undefined}
				>
					<SidebarToggle side={side} open={panel.open} onToggle={onToggle} />
				</div>
			)}
		</div>
	);
}
