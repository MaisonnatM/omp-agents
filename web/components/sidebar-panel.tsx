import { type LucideIcon, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Sidebar, type SidebarSide } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type ShortcutId, shortcutLabels } from "../shortcuts";
import { useStoredState } from "../stored-state";

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
		name: "Plan and changes",
		id: "plan-sidebar",
		defaultWidth: 288,
		widthKey: "omp-agents.plan-width",
		openKey: "omp-agents.plan-open",
		shortcut: "planSidebar",
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

/** Shows or hides a sidebar: the left one's from its header or the strip left in its place, the right one's from the pane header. */
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
 * A sidebar with its resize handle. While the left one is hidden, a strip holds the button that shows it again; the
 * right one's button always sits in the pane header instead (see `App`). The hidden sidebar stays mounted, so its filter
 * and scroll survive.
 */
export function DashboardSidebar({ side, panel, onResize, onToggle, children }: DashboardSidebarProps) {
	return (
		<>
			<Sidebar id={SIDEBARS[side].id} side={side} collapsible="none" hidden={!panel.open} className="relative h-full" style={{ width: panel.width }}>
				{children}
				<SidebarResizeHandle side={side} width={panel.width} onWidth={onResize} />
			</Sidebar>
			{side === "left" && !panel.open && (
				<div className="sticky top-0 flex h-full shrink-0 flex-col border-r border-border px-2 pt-4">
					<SidebarToggle side={side} open={false} onToggle={onToggle} />
				</div>
			)}
		</>
	);
}
