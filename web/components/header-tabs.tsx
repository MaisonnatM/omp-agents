/** `HeaderTabs`, the row across the top of the page and the details sidebar: Back and Forward, one tab per page or session you opened, New session, then the header's controls. */
import { GripVertical, House, Loader, type LucideIcon, MessageSquare, Plus, Sparkles, SquarePen, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { awaitsSubagents, type PastSession, type RosterHost } from "../../src/shared/sessions";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl, record } from "../activity";
import { closeHeaderTab, decodeHeaderTabs, encodeHeaderTabs, HEADER_TABS_KEY, headerTabKey, moveHeaderTab, visitHeaderTab } from "../header-tabs";
import { hostLabel, pastLabel } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { focusedView, type Page, routeFromHash } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { DESKTOP_TITLE_BAR } from "../desktop-title-bar";
import { HistoryButtons } from "./header-controls";
import { StatusDot } from "./status-dot";

const PAGE_LABEL: Record<Page["kind"], string> = {
	"get-started": "Get started",
	settings: "Settings",
	"pull-requests": "Pull requests",
	tickets: "Tickets",
	todo: "Todo",
	notes: "Notes",
	bots: "Bots",
	calendar: "Calendar",
	email: "Email",
	new: "New session",
	scheduled: "Scheduled session",
	sport: "Sport",
};

const PAGE_TAB_ICON: Record<Page["kind"], LucideIcon> = { ...PAGE_ICON, "get-started": Sparkles, new: SquarePen, scheduled: PAGE_ICON.calendar };

const ICON = "size-3.5 shrink-0";

/** A tab's name and the icon before it: the page's, else the session's title with its status. */
function faceOf(hash: string, hosts: readonly RosterHost[], past: readonly PastSession[]): { label: string; lead: ReactNode } {
	const route = routeFromHash(hash);
	if (route.kind === "page") {
		const Icon = PAGE_TAB_ICON[route.page.kind];
		return { label: PAGE_LABEL[route.page.kind], lead: <Icon className={ICON} /> };
	}
	const view = route.kind === "panes" ? focusedView(route.layout) : null;
	if (view === null) return { label: "Home", lead: <House className={ICON} /> };
	if (view.kind === "past") {
		const session = past.find(each => each.sessionId === view.sessionId);
		return { label: session ? pastLabel(session) : "Past session", lead: <MessageSquare className={ICON} /> };
	}
	const host = hosts.find(each => each.instanceId === view.instanceId);
	const name = host ? hostLabel(host) : "Session";
	const label = view.agentId === null ? name : `${view.agentId} · ${name}`;
	if (!host) return { label, lead: <MessageSquare className={ICON} /> };
	const status = awaitsSubagents(host) ? "awaiting-subagents" : host.status;
	if (status === "working" || status === "awaiting-subagents") return { label, lead: <Loader aria-label="Working" className={cn(ICON, "animate-spin text-success")} /> };
	return { label, lead: <span className="flex w-3.5 justify-center"><StatusDot status={status} /></span> };
}

interface HeaderTabsProps {
	/** The hash the dashboard shows, `""` for the empty home; each new one opens or updates its tab. */
	address: string;
	hosts: readonly RosterHost[];
	past: readonly PastSession[];
	/** The sessions sidebar is open beside the row; otherwise its toggle, or the desktop window's buttons, sit over the row's left end. */
	sidebarDocked: boolean;
	onNewSession: () => void;
	/** What's new, the bell, and Settings, at the row's right end. */
	controls: ReactNode;
}

/**
 * The row of header tabs: a tab for each page and focused session you open, at most eight, the one seen longest ago dropping out,
 * kept in this browser. Drag one to reorder; its × or a middle-click closes it, and closing the one on screen shows its neighbour.
 */
export function HeaderTabs({ address, hosts, past, sidebarDocked, onNewSession, controls }: HeaderTabsProps) {
	const [tabs, setTabs] = useStoredState(HEADER_TABS_KEY, decodeHeaderTabs, encodeHeaderTabs);
	useEffect(() => setTabs(current => visitHeaderTab(current, address, Date.now())), [address, setTabs]);
	const activeKey = headerTabKey(address);
	const list = useRef<HTMLDivElement>(null);
	const dragged = useRef<{ key: string; moved: boolean } | null>(null);
	/** Which ends of the row hide tabs past them, faded so the row says it scrolls. */
	const [edges, setEdges] = useState({ start: false, end: false });
	const measureEdges = (): void => {
		const element = list.current;
		if (element) setEdges({ start: element.scrollLeft > 0, end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1 });
	};
	useEffect(() => {
		list.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
		measureEdges();
	}, [activeKey, tabs.length]);
	const close = (key: string): void => {
		const { tabs: rest, go } = closeHeaderTab(tabs, key, activeKey);
		setTabs(rest);
		if (go !== null) location.hash = go;
	};
	return (
		<div
			className={cn(
				"col-start-2 col-end-[-1] row-start-1 flex h-(--page-header-height) min-w-0 items-center gap-1 select-none [-webkit-app-region:drag] *:[-webkit-app-region:no-drag]",
				// A closed sidebar's rail is narrower than the desktop window's buttons; a floating one's toggle sits over the row's left end.
				!sidebarDocked && "pl-[max(0px,calc(env(titlebar-area-x,0px)-46px))] max-phone:pl-[max(var(--sidebar-toggle-clearance),env(titlebar-area-x,0px))]",
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
				{tabs.map(tab => {
					const active = tab.key === activeKey;
					const { label, lead } = faceOf(tab.hash, hosts, past);
					return (
						<div
							key={tab.key}
							draggable
							onDragStart={event => {
								dragged.current = { key: tab.key, moved: false };
								event.dataTransfer.effectAllowed = "move";
							}}
							onDragOver={event => {
								event.preventDefault();
								const from = dragged.current;
								if (!from || from.key === tab.key) return;
								from.moved = true;
								setTabs(current => moveHeaderTab(current, from.key, tab.key));
							}}
							onDragEnd={() => {
								if (dragged.current?.moved) record("control", "header.tab.move");
								dragged.current = null;
							}}
							className={cn(
								"group relative flex h-7 max-w-60 min-w-24 items-center rounded-lg border text-[13px]",
								tab.key.startsWith("view:") ? "min-w-36 flex-[0_1_auto]" : "shrink-0",
								active ? "border-border bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)]" : "border-transparent text-muted-foreground hover:bg-hover hover:text-foreground",
							)}
						>
							<a
								href={tab.hash || "#"}
								aria-current={active ? "page" : undefined}
								title={label}
								draggable={false}
								className={cn(
									"flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-lg pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
									active ? "pr-11" : "pr-2.5 group-hover:[mask-image:linear-gradient(to_left,transparent_1.625rem,black_2rem)]",
								)}
								onClick={event => {
									if (event.metaKey || event.ctrlKey || event.shiftKey) return;
									event.preventDefault();
									if (!active) location.hash = tab.hash;
								}}
								onMouseDown={event => {
									// A middle press would start the browser's autoscroll before the click that closes the tab.
									if (event.button === 1) event.preventDefault();
								}}
								onAuxClick={event => {
									if (event.button !== 1) return;
									event.preventDefault();
									close(tab.key);
								}}
							>
								{lead}
								<span className="truncate">{label}</span>
							</a>
							<GripVertical aria-hidden className={cn("pointer-events-none absolute right-[26px] size-3 text-muted-foreground/60", !active && "hidden")} />
							<button
								type="button"
								{...activityControl("header.tab.close")}
								aria-label={`Close ${label}`}
								className={cn(
									"absolute right-1 flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-active hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
									!active && "opacity-0 group-hover:opacity-100",
								)}
								onClick={() => close(tab.key)}
							>
								<X className="size-3" />
							</button>
						</div>
					);
				})}
			</nav>
			<Tooltip content="New session" shortcut={shortcutLabels("newSession")} side="bottom">
				<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="New session" onClick={onNewSession}>
					<Plus />
				</Button>
			</Tooltip>
			<div className="ml-auto flex shrink-0 items-center pr-1.5">{controls}</div>
		</div>
	);
}
