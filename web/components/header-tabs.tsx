/** `HeaderTabs`, the row across the top of the page and the details sidebar: Back and Forward, the tabs you browse in, pinned ones first, and a + that opens a new one. */
import { IconBubbleText, IconCalendarClock, IconChainLink1, IconCrossMedium, IconEditBig, IconHome, IconPin, IconPlusLarge, IconSparklesTwo, IconSquareBehindSquare2, IconUnpin } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { type ReactNode, useEffect, useRef } from "react";
import { awaitsSubagents, type PastSession, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuSeparator, MenuShortcut } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl, record } from "../activity";
import { pageTitle, viewTitle } from "../document-title";
import {
	closeHeaderTab,
	closeOtherHeaderTabs,
	closeRightHeaderTabs,
	decodeHeaderTabs,
	duplicateHeaderTab,
	encodeHeaderTabs,
	type HeaderTab,
	HEADER_TABS_KEY,
	type HeaderTabTarget,
	headerTabTarget,
	NEW_TAB_HASH,
	pinHeaderTab,
	reopenHeaderTab,
	reorderHeaderTabs,
	visitHeaderTab,
} from "../header-tabs";
import { MODULE_LIST, type WebModuleId } from "../modules";
import { moveBy, SIDE_DROP_LINE, stepTarget, type Where } from "../order";
import { PAGE_ICON } from "../page-icons";
import type { Page } from "../routing";
import { shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { useClipboard } from "../use-copy";
import { type DragItem, useDragOrder } from "../use-drag-order";
import { ClosableTab, useTabRowEdges } from "./closable-tab";
import { useDashboardActions } from "./dashboard-context";
import { HistoryButtons } from "./header-controls";
import { StatusDot } from "./status-dot";

const PAGE_TAB_ICON: Record<Page["kind"], IconComponent> = {
	...PAGE_ICON,
	...(Object.fromEntries(MODULE_LIST.map(({ id, tab }) => [id, tab.icon])) as Record<WebModuleId, IconComponent>),
	"get-started": IconSparklesTwo,
	new: IconEditBig,
	scheduled: IconCalendarClock,
};

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
	onTogglePin: () => void;
	onNewTab: () => void;
	onDuplicate: () => void;
	onCopyUrl: () => void;
	/** `null` while no other tab would close: the row holds only pinned tabs besides this one. */
	onCloseOthers: (() => void) | null;
	/** `null` while every tab after this one is pinned. */
	onCloseRight: (() => void) | null;
}

/**
 * One header tab, which drags from anywhere on it to reorder: its link and its ×, and the menu a right-click on it opens, in Capy's order.
 * A pinned tab shows only its icon and draws no ×.
 */
function HeaderTabItem({ tab, target, label, lead, active, drag, onSelect, onClose, onTogglePin, onNewTab, onDuplicate, onCopyUrl, onCloseOthers, onCloseRight }: HeaderTabItemProps) {
	const pinned = tab.pinned === true;
	return (
		<ContextMenu>
			<ClosableTab
				data-tab-id={tab.id}
				{...drag.handle}
				{...drag.target}
				name={label}
				active={active}
				onClose={pinned ? null : onClose}
				closeControl="header.tab.close"
				activePadding="pr-7"
				className={cn(
					"border",
					pinned ? "w-9 shrink-0" : cn("max-w-60 min-w-24", target?.kind === "view" ? "min-w-36 flex-[0_1_auto]" : "shrink-0"),
					active ? "border-border bg-background text-foreground shadow-raised" : "border-transparent",
					drag.dragging && "opacity-50",
					drag.dropAt && SIDE_DROP_LINE[drag.dropAt],
				)}
			>
				{body => (
					<ContextMenuTrigger
						render={
							<a
								href={tab.hash || "#"}
								aria-current={active ? "page" : undefined}
								title={label}
								draggable={false}
								className={cn(body, "flex-1", pinned && "justify-center")}
								onClick={event => {
									if (event.metaKey || event.ctrlKey || event.shiftKey) return;
									event.preventDefault();
									if (!active) onSelect();
								}}
							/>
						}
					>
						{lead}
						<span className={pinned ? "sr-only" : "truncate"}>{label}</span>
					</ContextMenuTrigger>
				)}
			</ClosableTab>
			<ContextMenuContent>
				<MenuItem {...activityControl("header.tab.pin")} onClick={onTogglePin}>
					{pinned ? <IconUnpin /> : <IconPin />}
					{pinned ? "Unpin tab" : "Pin tab"}
					<MenuShortcut>{shortcutLabels("pinTab")[0]}</MenuShortcut>
				</MenuItem>
				<MenuItem onClick={onNewTab}>
					<IconPlusLarge />
					New tab
					<MenuShortcut>{shortcutLabels("newTab")[0]}</MenuShortcut>
				</MenuItem>
				<MenuItem onClick={onDuplicate}>
					<IconSquareBehindSquare2 />
					Duplicate tab
				</MenuItem>
				<MenuItem onClick={onCopyUrl}>
					<IconChainLink1 />
					Copy URL
					<MenuShortcut>{shortcutLabels("copyTabUrl")[0]}</MenuShortcut>
				</MenuItem>
				<MenuSeparator />
				{!pinned && (
					<MenuItem {...activityControl("header.tab.close")} onClick={onClose}>
						<IconCrossMedium />
						Close tab
					</MenuItem>
				)}
				<MenuItem disabled={onCloseOthers === null} onClick={onCloseOthers ?? undefined}>
					<IconCrossMedium />
					Close other tabs
				</MenuItem>
				<MenuItem disabled={onCloseRight === null} onClick={onCloseRight ?? undefined}>
					<IconCrossMedium />
					Close tabs to the right
				</MenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

interface HeaderTabsProps {
	/** Places the row in the window's grid. */
	className?: string;
	/** The hash the dashboard shows, `""` for the empty home; each new one opens or updates its tab. */
	address: string;
	hosts: readonly RosterHost[];
	past: readonly PastSession[];
}

/**
 * The row of header tabs, kept in this browser, working as Capy's desktop tabs do: going to a page shows it in the tab on screen,
 * a session another tab shows focuses that tab, and only + or ⌘T opens a new tab. ⌘1 to ⌘9 go to the tab of that place, and ⌃⇥
 * and ⌃⇧⇥ to the next and previous. Drag one, or press Alt+Shift+← or → on it, to reorder; its × or a middle-click closes it,
 * closing the one on screen shows its neighbour, closing the last leaves a new one, and ⌥⌘W closes all but the pinned ones and the one on screen.
 * ⇧⌘T reopens the last closed tab where it was. Pin or Unpin in a tab's menu, or ⌃⇧P on the one on screen, moves it among the pinned
 * tabs, which sit first, show only their icon, and stay open until unpinned. The menu also duplicates a tab, copies its address, as ⌘L does
 * for the one on screen, and closes the tabs to its right.
 */
export function HeaderTabs({ className, address, hosts, past }: HeaderTabsProps) {
	const { openNewSession } = useDashboardActions();
	const [row, setRow] = useStoredState(HEADER_TABS_KEY, decodeHeaderTabs, encodeHeaderTabs);
	const clipboard = useClipboard();
	useEffect(() => {
		setRow(current => visitHeaderTab(current, address, false, crypto.randomUUID()));
	}, [address, setRow]);
	const { tabs } = row;
	const activeId = tabs[row.active]?.id ?? null;
	const list = useRef<HTMLElement>(null);
	const dragOrder = useDragOrder("x");
	/** The tab a key press moved, which takes the focus back once the row is drawn again in its new order. */
	const refocus = useRef<string | null>(null);
	const edges = useTabRowEdges(list, tabs);
	useEffect(() => {
		list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeId, tabs.length]);
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
	const select = (index: number): void => {
		setRow(current => ({ ...current, active: index }));
		location.hash = tabs[index]?.hash ?? "";
	};
	/** Opens a new tab on the new-session page, as + does. */
	const openTab = (): void => {
		setRow(current => visitHeaderTab(current, NEW_TAB_HASH, true, crypto.randomUUID()));
		openNewSession();
	};
	/** Applies a change that may move the screen elsewhere, as closing the tab on screen does. */
	const apply = (change: { row: typeof row; go: string | null } | null): boolean => {
		if (change === null) return false;
		setRow(change.row);
		if (change.go !== null) location.hash = change.go;
		return true;
	};
	const close = (id: string): void => {
		apply(closeHeaderTab(row, id, crypto.randomUUID()));
	};
	const togglePin = (id: string): void => {
		setRow(current => pinHeaderTab(current, id, current.tabs.find(tab => tab.id === id)?.pinned !== true));
	};
	/** Copies the address that opens the dashboard on what `tab` shows. */
	const copyUrl = (tab: HeaderTab): void => clipboard.run(`${location.origin}${location.pathname}${tab.hash}`);
	useShortcuts({
		moveTabLeft: () => moveFocused(-1),
		moveTabRight: () => moveFocused(1),
		// A pinned tab on screen takes ⌘W and stays, as it has no ×.
		closeTab: () => {
			if (activeId === null) return false;
			close(activeId);
		},
		reopenClosedTab: () => apply(reopenHeaderTab(row)),
		pinTab: () => {
			if (activeId === null) return false;
			togglePin(activeId);
		},
		copyTabUrl: () => {
			const active = tabs[row.active];
			if (!active) return false;
			copyUrl(active);
		},
		selectTab: index => {
			if (index >= tabs.length) return false;
			select(index);
		},
		nextTab: () => select((row.active + 1) % tabs.length),
		previousTab: () => select((row.active - 1 + tabs.length) % tabs.length),
		newTab: openTab,
		closeOtherTabs: () => activeId !== null && apply(closeOtherHeaderTabs(row, activeId)),
	});
	return (
		<div
			className={cn(
				"flex h-(--page-header-height) min-w-0 items-center gap-1 select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]",
				// A closed sidebar's toggle sits over the row's left end, past the desktop window's buttons.
				"phone:group-has-[#sessions-sidebar[inert]]/window:pl-[calc(env(titlebar-area-x,0px)+var(--sidebar-toggle-clearance))] max-phone:pl-[max(var(--sidebar-toggle-clearance),env(titlebar-area-x,0px))]",
				className,
			)}
		>
			{/* A docked open sidebar holds these at its right edge instead (`DashboardSidebar`). */}
			<div className="contents phone:group-has-[#sessions-sidebar:not([inert])]/window:hidden">
				<HistoryButtons />
			</div>
			<nav
				ref={list}
				aria-label="Header tabs"
				onScroll={edges.onScroll}
				className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] phone:group-has-[#sessions-sidebar:not([inert])]/window:ml-0"
				style={edges.style}
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
							onTogglePin={() => togglePin(tab.id)}
							onNewTab={openTab}
							onDuplicate={() => apply(duplicateHeaderTab(row, tab.id, crypto.randomUUID()))}
							onCopyUrl={() => copyUrl(tab)}
							onCloseOthers={tabs.some(other => other.id !== tab.id && !other.pinned) ? () => apply(closeOtherHeaderTabs(row, tab.id)) : null}
							onCloseRight={tabs.some((other, at) => at > index && !other.pinned) ? () => apply(closeRightHeaderTabs(row, tab.id)) : null}
						/>
					);
				})}
			</nav>
			<Tooltip content="New tab" shortcut={shortcutLabels("newTab")} side="bottom">
				<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="New tab" onClick={openTab}>
					<IconPlusLarge />
				</Button>
			</Tooltip>
		</div>
	);
}
