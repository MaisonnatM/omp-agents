/** The right sidebar's shell for a focused view: the directory its file references resolve against, a row of the tabs open in it with + to open more, and the open tab's panel. */
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { IconComponent } from "@/lib/icon-context";
import { IconPlusLarge } from "central-icons";
import { type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuRadioGroup, MenuRadioItem, MenuShortcut } from "@/components/ui/menu";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { closeDetailsTab, decodeDetailsTabs, encodeDetailsTabs, showDetailsTab } from "../details-tabs";
import { type ShortcutHandlers, type ShortcutId, shortcutLabels, useShortcuts } from "../shortcuts";
import { useStoredState } from "../stored-state";
import { ClosableTab, useTabRowEdges } from "./closable-tab";
import { CountPill } from "./count-pill";
import { FileBaseContext } from "./file-link";
import { SidebarOpen } from "./sidebar-panel";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

/** The tab on screen in the row, which a change scrolls into view and a keyboard close focuses. */
const ACTIVE_TAB = '[role="tab"][data-state="active"]';

export interface DetailsTab<T extends string> {
	value: T;
	icon: IconComponent;
	name: string;
	/** The Activity control opening or picking the tab records. */
	control: ControlId;
	/** The keys that open or show it while the sidebar shows, listed in the + menu, as Capy's ⇧⌘L opens its Browser. */
	shortcut?: ShortcutId;
	/** Shown as a pill after its name, which screen readers hear with it; zero shows none. */
	count: number;
	/** The content scrolls itself inside the panel's full height, as a pull request's details do below their header and tabs. */
	scrollsItself?: boolean;
	/** Once first shown, the content stays mounted, hidden behind another tab while open, so a page loaded in it survives the switch. */
	keepMounted?: boolean;
	content: ReactNode;
}

interface DetailsSidebarFrameProps<T extends string> {
	/** The heading and tab list's accessible name. */
	label: string;
	/** The localStorage key keeping the open tabs across views. */
	storageKey: string;
	/** The first tab, always open and never closed, shown when no other is. */
	defaultTab: T;
	/** The focused view's directory, which relative file references in every tab resolve against. */
	cwd: string | null;
	/** Every tab the view can show, in the + menu's order. */
	tabs: readonly DetailsTab<T>[];
	/** What the + menu lists after the tabs, such as a session's subagents and terminals, each section after a separator. */
	menuSections?: ReactNode;
}

/** A tab with nothing to show yet. */
export function DetailsEmpty({ icon: Icon, title, description }: { icon: IconComponent; title: string; description: string }) {
	return (
		<Empty className="py-10">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription className="text-xs/relaxed">{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

interface DetailsTabChipProps {
	tab: DetailsTab<string>;
	active: boolean;
	/** `null` for the first tab, which stays open; `byKey` when Delete or Backspace on the focused tab closes it. */
	onClose: ((byKey: boolean) => void) | null;
}

/** One open tab, as Capy's side panel draws it: its icon, name, and count, and the {@link ClosableTab} ×; Delete or Backspace on it closes it too. */
function DetailsTabChip({ tab, active, onClose }: DetailsTabChipProps) {
	const Icon = tab.icon;
	return (
		<ClosableTab
			name={tab.name}
			active={active}
			onClose={onClose && (() => onClose(false))}
			closeControl="details.tab.close"
			activePadding="pr-7"
			className={cn("min-w-0 shrink-0", active && "bg-active text-foreground")}
		>
			{body => (
				<TabsPrimitive.Trigger
					value={tab.value}
					{...activityControl(tab.control)}
					aria-label={tab.count > 0 ? `${tab.name} (${tab.count})` : undefined}
					className={body}
					onKeyDown={event => {
						if (onClose === null || (event.key !== "Delete" && event.key !== "Backspace")) return;
						event.preventDefault();
						onClose(true);
					}}
				>
					<Icon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="truncate">{tab.name}</span>
					{tab.count > 0 && <CountPill count={tab.count} />}
				</TabsPrimitive.Trigger>
			)}
		</ClosableTab>
	);
}

/** The + menu: every tab the view can show, the one on screen checked; picking one opens it, or shows it when already open. */
function OpenTabMenu<T extends string>({ tabs, active, onPick, sections }: { tabs: readonly DetailsTab<T>[]; active: string; onPick: (value: unknown) => void; sections: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="Open a tab" side="bottom" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger
					{...activityControl("details.tab.add")}
					render={<Button variant="ghost" size="icon-compact" className="shrink-0 text-muted-foreground" aria-label="Open a tab" />}
				>
					<IconPlusLarge />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="start" className="min-w-52">
				<MenuRadioGroup value={active} onValueChange={onPick}>
					{tabs.map(each => {
						const Icon = each.icon;
						return (
							<MenuRadioItem key={each.value} value={each.value} closeOnClick {...activityControl(each.control)}>
								<Icon aria-hidden="true" />
								<span className="flex-1">{each.name}</span>
								{(each.count > 0 || each.shortcut) && (
									<MenuShortcut className="flex items-center gap-2 tabular-nums">
										{each.count > 0 && <span>{each.count}</span>}
										{each.shortcut && <span>{shortcutLabels(each.shortcut).join(" ")}</span>}
									</MenuShortcut>
								)}
							</MenuRadioItem>
						);
					})}
				</MenuRadioGroup>
				{sections}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function DetailsSidebarFrame<T extends string>({ label, storageKey, defaultTab, cwd, tabs, menuSections }: DetailsSidebarFrameProps<T>) {
	const [stored, setStored] = useStoredState(storageKey, decodeDetailsTabs, encodeDetailsTabs);
	// Resolved each render: a stored tab that shows only once its items arrive, such as Tickets, comes back then.
	const first = tabs.find(each => each.value === defaultTab);
	const shown = [...(first ? [first] : []), ...stored.open.flatMap(value => (value !== defaultTab && tabs.find(each => each.value === value)) || [])];
	const shownValues = shown.map(each => each.value);
	const active = (shown.find(each => each.value === stored.active) ?? shown[0])?.value ?? defaultTab;
	const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set([active]));
	if (!mounted.has(active)) setMounted(new Set(mounted).add(active));
	const fileBase = useMemo(() => (cwd === null ? null : { dir: cwd, session: null }), [cwd]);
	const sidebarOpen = useContext(SidebarOpen);
	const list = useRef<HTMLDivElement>(null);
	/** Set by a keyboard close, so the tab that then shows takes the focus the closed one had. */
	const refocus = useRef(false);
	const edges = useTabRowEdges(list, shownValues.join(" "));
	useEffect(() => {
		const tab = list.current?.querySelector<HTMLElement>(ACTIVE_TAB);
		tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
		if (!refocus.current) return;
		refocus.current = false;
		tab?.focus();
	}, [active, shown.length]);

	const show = (value: T): void => setStored(current => showDetailsTab(current, value, defaultTab));
	const pick = (value: unknown): void => {
		const picked = tabs.find(each => each.value === value);
		if (picked) show(picked.value);
	};
	const close = (value: T, byKey: boolean): void => {
		refocus.current = byKey;
		setStored(current => closeDetailsTab(current, value, shownValues));
	};
	const handlers: ShortcutHandlers = {};
	for (const each of tabs) {
		if (!each.shortcut) continue;
		// A closed sidebar stays mounted, so its keys pass on to the page, such as the browser's ⇧⌘G, instead of changing what it hides.
		handlers[each.shortcut] = () => {
			if (!sidebarOpen) return false;
			show(each.value);
		};
	}
	useShortcuts(handlers);

	return (
		<FileBaseContext.Provider value={fileBase}>
			<TabsPrimitive.Root value={active} onValueChange={pick} className="flex min-h-0 flex-1 flex-col">
				<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-1 border-b border-border px-2 py-0">
					<h2 className="sr-only">{label}</h2>
					<TabsPrimitive.List ref={list} aria-label={label} onScroll={edges.onScroll} style={edges.style} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
						{shown.map(each => (
							<DetailsTabChip key={each.value} tab={each} active={each.value === active} onClose={each.value === defaultTab ? null : byKey => close(each.value, byKey)} />
						))}
					</TabsPrimitive.List>
					<OpenTabMenu tabs={tabs} active={active} onPick={pick} sections={menuSections} />
				</SidebarHeader>
				{shown.map(each => {
					// A kept panel stays drawn while inactive, so its class hides it.
					const panel = { value: each.value, forceMount: each.keepMounted && mounted.has(each.value) ? (true as const) : undefined };
					return each.scrollsItself ? (
						<TabsPrimitive.Content key={each.value} {...panel} className="flex min-h-0 flex-1 flex-col outline-none data-[state=inactive]:hidden">
							{each.content}
						</TabsPrimitive.Content>
					) : (
						<TabsPrimitive.Content key={each.value} {...panel} asChild className="outline-none data-[state=inactive]:hidden">
							<SidebarContent viewportClassName={PANEL_VIEWPORT}>{each.content}</SidebarContent>
						</TabsPrimitive.Content>
					);
				})}
			</TabsPrimitive.Root>
		</FileBaseContext.Provider>
	);
}
