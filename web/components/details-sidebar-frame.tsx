/** The right sidebar's shell for a focused view: the directory its file references resolve against, a row of the tabs open in it with + to open more, and the open tab's panel. */
import type { IconComponent } from "@/lib/icon-context";
import { IconCheckmark1, IconCrossMedium, IconPlusLarge } from "central-icons";
import { type KeyboardEvent, type ReactNode, useId, useMemo, useState } from "react";
import type { ControlId } from "../../src/shared/activity";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem, MenuShortcut } from "@/components/ui/menu";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../activity";
import { closeDetailsTab, decodeDetailsTabs, encodeDetailsTabs, openDetailsTab } from "../details-tabs";
import { useStoredState } from "../stored-state";
import { FileBaseContext } from "./file-link";

/** Keeps each tab's content off the header's hairline at rest, and scrolls away with it. */
const PANEL_VIEWPORT = "pt-2";

export interface DetailsTab<T extends string> {
	value: T;
	icon: IconComponent;
	name: string;
	/** The Activity control opening or picking the tab records. */
	control: ControlId;
	/** Shown after its name, which screen readers hear with it; zero shows none. */
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
	ids: { tab: string; panel: string };
	active: boolean;
	/** `null` for the first tab, which stays open. */
	onClose: (() => void) | null;
	onSelect: () => void;
}

/** One open tab, as Capy's side panel draws it: its icon, name, and count, and an × on hover, on focus, and always on the tab on screen. */
function DetailsTabChip({ tab, ids, active, onClose, onSelect }: DetailsTabChipProps) {
	const Icon = tab.icon;
	return (
		<div
			className={cn(
				"group/reveal relative flex h-7 min-w-0 shrink-0 items-center rounded-lg text-[13px]",
				active ? "bg-active text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			<button
				type="button"
				role="tab"
				{...activityControl(tab.control)}
				id={ids.tab}
				aria-selected={active}
				aria-controls={active ? ids.panel : undefined}
				aria-label={tab.count > 0 ? `${tab.name} (${tab.count})` : undefined}
				tabIndex={active ? 0 : -1}
				className={cn(
					"flex h-full min-w-0 items-center gap-1.5 rounded-lg pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring",
					onClose === null ? "pr-2.5" : active ? "pr-7" : "pr-2.5 revealed:[mask-image:linear-gradient(to_left,transparent_1.5rem,black_1.875rem)]",
				)}
				onClick={onSelect}
				onKeyDown={event => {
					if (onClose === null || (event.key !== "Delete" && event.key !== "Backspace")) return;
					event.preventDefault();
					onClose();
				}}
			>
				<Icon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{tab.name}</span>
				{tab.count > 0 && <span className="text-muted-foreground tabular-nums">{tab.count}</span>}
			</button>
			{onClose !== null && (
				<button
					type="button"
					{...activityControl("details.tab.close")}
					tabIndex={-1}
					aria-label={`Close ${tab.name}`}
					className={cn(
						"group/close absolute right-0.5 grid size-6 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground",
						!active && "opacity-0 revealed:opacity-100",
					)}
					onClick={onClose}
				>
					<span className="grid size-4 place-items-center rounded-md group-hover/close:bg-active">
						<IconCrossMedium className="size-3" />
					</span>
				</button>
			)}
		</div>
	);
}

/** The + menu: every tab the view can show, the one on screen checked; picking one opens it, or shows it when already open. */
function OpenTabMenu<T extends string>({ tabs, active, onPick }: { tabs: readonly DetailsTab<T>[]; active: T; onPick: (value: T) => void }) {
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
				{tabs.map(each => {
					const Icon = each.icon;
					return (
						<MenuItem key={each.value} {...activityControl(each.control)} onClick={() => onPick(each.value)}>
							<Icon aria-hidden="true" />
							{each.name}
							<MenuShortcut className="flex items-center gap-2 tabular-nums">
								{each.count > 0 && each.count}
								<IconCheckmark1 aria-hidden="true" className={cn("text-foreground", each.value !== active && "invisible")} />
							</MenuShortcut>
						</MenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function DetailsSidebarFrame<T extends string>({ label, storageKey, defaultTab, cwd, tabs }: DetailsSidebarFrameProps<T>) {
	const [stored, setStored] = useStoredState(storageKey, decodeDetailsTabs, encodeDetailsTabs);
	// Resolved each render: a stored tab that shows only once its items arrive, such as Tickets, comes back then.
	const byValue = new Map<string, DetailsTab<T>>(tabs.map(each => [each.value, each]));
	const shown = [defaultTab, ...stored.open.filter(value => value !== defaultTab && byValue.has(value))] as T[];
	const tab = shown.find(value => value === stored.active) ?? defaultTab;
	const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set([tab]));
	if (!mounted.has(tab)) setMounted(new Set(mounted).add(tab));
	const fileBase = useMemo(() => (cwd === null ? null : { dir: cwd, session: null }), [cwd]);
	const prefix = useId();
	const ids = (value: string) => ({ tab: `${prefix}-tab-${value}`, panel: `${prefix}-panel-${value}` });
	const show = (value: T): void => setStored(current => (value === defaultTab ? { open: current.open, active: null } : openDetailsTab(current, value)));
	const onListKey = (event: KeyboardEvent<HTMLDivElement>): void => {
		const at = shown.indexOf(tab);
		const step = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: shown.length - 1 }[event.key];
		if (step === undefined) return;
		event.preventDefault();
		const next = shown[(step + shown.length) % shown.length]!;
		show(next);
		document.getElementById(ids(next).tab)?.focus();
	};
	return (
		<FileBaseContext.Provider value={fileBase}>
			<div className="flex min-h-0 flex-1 flex-col">
				<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-1 border-b border-border px-2 py-0">
					<h2 className="sr-only">{label}</h2>
					<div role="tablist" aria-label={label} className="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" onKeyDown={onListKey}>
						{shown.map(value => (
							<DetailsTabChip
								key={value}
								tab={byValue.get(value)!}
								ids={ids(value)}
								active={value === tab}
								onSelect={() => show(value)}
								onClose={value === defaultTab ? null : () => setStored(current => closeDetailsTab(current, value, shown))}
							/>
						))}
					</div>
					<OpenTabMenu tabs={tabs} active={tab} onPick={show} />
				</SidebarHeader>
				{shown.map(value => {
					const each = byValue.get(value)!;
					const active = value === tab;
					if (!active && !(each.keepMounted && mounted.has(value))) return null;
					const panel = { role: "tabpanel", id: ids(value).panel, "aria-labelledby": ids(value).tab };
					return each.scrollsItself ? (
						<div key={value} {...panel} className={cn("flex min-h-0 flex-1 flex-col", !active && "hidden")}>
							{each.content}
						</div>
					) : (
						<SidebarContent key={value} {...panel} viewportClassName={PANEL_VIEWPORT} className={cn(!active && "hidden")}>
							{each.content}
						</SidebarContent>
					);
				})}
			</div>
		</FileBaseContext.Provider>
	);
}
