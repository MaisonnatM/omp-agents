/** `HeaderTabs`, the row across the top of the page and the details sidebar: Back and Forward, the tabs you browse in, a + that opens a new one, then the header's controls. */
import { IconBubbleText, IconCrossMedium, IconDotGrid2x3, IconEditBig, IconHome, IconPlusLarge, IconSparklesTwo } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { awaitsSubagents, type PastSession, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl, record } from "../activity";
import { pageTitle, viewTitle } from "../document-title";
import { closeHeaderTab, decodeHeaderTabs, encodeHeaderTabs, type HeaderTab, HEADER_TABS_KEY, type HeaderTabTarget, headerTabTarget, NEW_TAB_HASH, reorderHeaderTabs, visitHeaderTab } from "../header-tabs";
import { moveBy, SIDE_DROP_LINE, stepTarget, type Where } from "../order";
import { PAGE_ICON } from "../page-icons";
import type { Page } from "../routing";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { type DragItem, useDragOrder } from "../use-drag-order";
import { useDashboardActions } from "./dashboard-context";
import { HistoryButtons } from "./header-controls";
import { StatusDot } from "./status-dot";

const PAGE_TAB_ICON: Record<Page["kind"], IconComponent> = { ...PAGE_ICON, "get-started": IconSparklesTwo, new: IconEditBig, scheduled: PAGE_ICON.calendar };

const ICON = "size-3.5 shrink-0";

/** A tab's name, the one the window's title gives what it shows, and the icon before it: the page's, else the session's status. */
function faceOf(target: HeaderTabTarget, hosts: readonly RosterHost[], past: readonly PastSession[]): { label: string; lead: ReactNode } {
	switch (target.kind) {
		case "home":
			return { label: "Home", lead: <IconHome className={ICON} /> };
		case "page": {
			const Icon = PAGE_TAB_ICON[target.page.kind];
			return { label: pageTitle(target.page), lead: <Icon className={ICON} /> };
		}
		case "view":
			break;
		default: {
			const never: never = target;
			return never;
		}
	}
	const { view } = target;
	if (view.kind === "past") {
		const session = past.find(each => each.sessionId === view.sessionId) ?? null;
		return { label: viewTitle(view, null, session) ?? "Past session", lead: <IconBubbleText className={ICON} /> };
	}
	const host = hosts.find(each => each.instanceId === view.instanceId) ?? null;
	const label = viewTitle(view, host, null) ?? "Session";
	if (!host) return { label, lead: <IconBubbleText className={ICON} /> };
	const status = awaitsSubagents(host) ? "awaiting-subagents" : host.status;
	// A working session draws no mark, as its sidebar row's dot does not: the icon, and the status only for screen readers.
	if (status === "working" || status === "awaiting-subagents") return { label, lead: <><IconBubbleText className={ICON} /><StatusDot status={status} /></> };
	return { label, lead: <span className="flex w-3.5 justify-center"><StatusDot status={status} /></span> };
}

interface HeaderTabItemProps {
	tab: HeaderTab;
	/** What the tab's hash shows; a session's tab shares the row's width, a page's keeps its own. */
	target: HeaderTabTarget | null;
	label: string;
	lead: ReactNode;
	active: boolean;
	drag: DragItem;
	onSelect: () => void;
	onClose: () => void;
}

/** One header tab: its link, the grip that says the focused tab drags, and its ×, which an inactive tab shows on hover, on focus, and on a touch screen. */
function HeaderTabItem({ tab, target, label, lead, active, drag, onSelect, onClose }: HeaderTabItemProps) {
	return (
		<div
			data-tab-id={tab.id}
			{...drag.handle}
			{...drag.target}
			className={cn(
				"group/reveal relative flex h-7 max-w-60 min-w-24 items-center rounded-lg border text-[13px]",
				target?.kind === "view" ? "min-w-36 flex-[0_1_auto]" : "shrink-0",
				active ? "border-border bg-background text-foreground shadow-raised" : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
				drag.dragging && "opacity-50",
				drag.dropAt && SIDE_DROP_LINE[drag.dropAt],
			)}
		>
			<a
				href={tab.hash || "#"}
				aria-current={active ? "page" : undefined}
				title={label}
				draggable={false}
				className={cn(
					"flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
					// The label fades under the × where it shows.
					active ? "pr-11" : "pr-2.5 revealed:[mask-image:linear-gradient(to_left,transparent_1.625rem,black_2rem)]",
				)}
				onClick={event => {
					if (event.metaKey || event.ctrlKey || event.shiftKey) return;
					event.preventDefault();
					if (!active) onSelect();
				}}
				onMouseDown={event => {
					// A middle press would start the browser's autoscroll before the click that closes the tab.
					if (event.button === 1) event.preventDefault();
				}}
				onAuxClick={event => {
					if (event.button !== 1) return;
					event.preventDefault();
					onClose();
				}}
			>
				{lead}
				<span className="truncate">{label}</span>
			</a>
			<IconDotGrid2x3 className={cn("pointer-events-none absolute right-[26px] size-3 text-muted-foreground/60", !active && "hidden")} />
			<button
				type="button"
				{...activityControl("header.tab.close")}
				aria-label={`Close ${label}`}
				className={cn(
					"group/close absolute right-0.5 grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
					!active && "opacity-0 revealed:opacity-100",
				)}
				onClick={onClose}
			>
				<span className="grid size-4 place-items-center rounded-md group-hover/close:bg-active">
					<IconCrossMedium className="size-3" />
				</span>
			</button>
		</div>
	);
}

interface HeaderTabsProps {
	/** Places the row in the window's grid. */
	className?: string;
	/** The hash the dashboard shows, `""` for the empty home; each new one opens or updates its tab. */
	address: string;
	hosts: readonly RosterHost[];
	past: readonly PastSession[];
	/** What's new, the bell, and Settings, at the row's right end. */
	controls: ReactNode;
}

/**
 * The row of header tabs, kept in this browser, working as Capy's desktop tabs do: going to a page shows it in the tab on screen,
 * a session another tab shows focuses that tab, and only + opens a new tab. Drag one, or press Alt+Shift+← or → on it, to reorder;
 * its × or a middle-click closes it, closing the one on screen shows its neighbour, and closing the last leaves a new one.
 */
export function HeaderTabs({ className, address, hosts, past, controls }: HeaderTabsProps) {
	const { openNewSession } = useDashboardActions();
	const [row, setRow] = useStoredState(HEADER_TABS_KEY, decodeHeaderTabs, encodeHeaderTabs);
	useEffect(() => {
		setRow(current => visitHeaderTab(current, address, false, crypto.randomUUID()));
	}, [address, setRow]);
	const { tabs } = row;
	const activeId = tabs[row.active]?.id ?? null;
	const list = useRef<HTMLElement>(null);
	const dragOrder = useDragOrder("x");
	/** The tab a key press moved, which takes the focus back once the row is drawn again in its new order. */
	const refocus = useRef<string | null>(null);
	/** Which ends of the row hide tabs past them, faded so the row says it scrolls. */
	const [edges, setEdges] = useState({ start: false, end: false });
	const measureEdges = (): void => {
		const element = list.current;
		if (!element) return;
		const start = element.scrollLeft > 0;
		const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
		setEdges(shown => (shown.start === start && shown.end === end ? shown : { start, end }));
	};
	useEffect(() => {
		list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeId, tabs.length]);
	// The row's width, and its tabs', which a resize of the window or a session's new title changes without a scroll.
	useEffect(() => {
		const element = list.current;
		if (!element) return;
		const observer = new ResizeObserver(measureEdges);
		observer.observe(element);
		for (const tab of element.children) observer.observe(tab);
		return () => observer.disconnect();
	}, [tabs]);
	useEffect(() => {
		const id = refocus.current;
		refocus.current = null;
		if (id !== null) list.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"] a`)?.focus();
	}, [tabs]);
	const move = (id: string, target: string, where: Where): void => {
		setRow(current => reorderHeaderTabs(current, moveBy(current.tabs, tab => tab.id, id, target, where)));
		record("control", "header.tab.move");
	};
	/** Moves the focused tab one place `by`; a key press with no tab focused passes on. */
	const moveFocused = (by: 1 | -1): boolean => {
		const id = document.activeElement?.closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
		if (id === undefined || !list.current?.contains(document.activeElement)) return false;
		const step = stepTarget(tabs.map(tab => tab.id), id, by);
		if (step === null) return true;
		refocus.current = id;
		move(id, step.target, step.where);
		return true;
	};
	useShortcuts({ moveTabLeft: () => moveFocused(-1), moveTabRight: () => moveFocused(1) });
	const select = (index: number): void => {
		setRow(current => ({ tabs: current.tabs, active: index }));
		location.hash = tabs[index]?.hash ?? "";
	};
	const close = (id: string): void => {
		const { row: rest, go } = closeHeaderTab(row, id, crypto.randomUUID());
		setRow(rest);
		if (go !== null) location.hash = go;
	};
	return (
		<div
			className={cn(
				"flex h-(--page-header-height) min-w-0 items-center gap-1 select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]",
				// A closed sidebar's rail is narrower than the desktop window's buttons; on a phone the floating sidebar's toggle sits over the row's left end.
				"phone:group-has-[#sessions-sidebar[inert]]/window:pl-[max(0px,calc(env(titlebar-area-x,0px)-var(--sidebar-rail)))] max-phone:pl-[max(var(--sidebar-toggle-clearance),env(titlebar-area-x,0px))]",
				className,
			)}
		>
			<HistoryButtons />
			<nav
				ref={list}
				aria-label="Header tabs"
				onScroll={measureEdges}
				className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
				style={{ maskImage: `linear-gradient(to right, ${edges.start ? "transparent, black 2rem" : "black"}, ${edges.end ? "black calc(100% - 2rem), transparent" : "black"})` }}
			>
				{tabs.map((tab, index) => {
					const target = headerTabTarget(tab.hash);
					const { label, lead } = target ? faceOf(target, hosts, past) : { label: "Session", lead: <IconBubbleText className={ICON} /> };
					return (
						<HeaderTabItem
							key={tab.id}
							tab={tab}
							target={target}
							label={label}
							lead={lead}
							active={tab.id === activeId}
							drag={dragOrder("header-tabs", tab.id, (dragged, where) => move(dragged, tab.id, where))}
							onSelect={() => select(index)}
							onClose={() => close(tab.id)}
						/>
					);
				})}
			</nav>
			<Tooltip content="New tab" side="bottom">
				<Button
					variant="ghost"
					size="icon-compact"
					className="shrink-0 text-muted-foreground"
					aria-label="New tab"
					onClick={() => {
						setRow(current => visitHeaderTab(current, NEW_TAB_HASH, true, crypto.randomUUID()));
						openNewSession();
					}}
				>
					<IconPlusLarge />
				</Button>
			</Tooltip>
			<div className="ml-auto flex shrink-0 items-center pr-1.5">{controls}</div>
		</div>
	);
}
