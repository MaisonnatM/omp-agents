/** The left sidebar's page list: New session, each shown tab's page with its count, and Settings, the page on screen holding its own list beneath its row. */
import { SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { SidebarGroup, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { PAGE_ICON } from "../page-icons";
import { hashForPage, type SettingsRoute, type SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { TAB_ROWS, tabShortcutLabels } from "../sidebar-tabs";

/** A row of the page list: a tab's page, Settings, or the New session draft. */
export type NavRow = SidebarTab | "settings" | "new";

/** A row's count and how its accessible name says it. */
export interface NavCount {
	count: number;
	says: (count: number) => string;
}

interface SidebarNavProps {
	/** The shown tabs, in the user's order, which the position keys count. */
	tabs: readonly SidebarTab[];
	/** The row of the page on screen; the panes are the Sessions page; `null` for a page with no row. */
	current: NavRow | null;
	/** The count after a row's label, for the rows that have one. */
	counts: Partial<Record<SidebarTab, NavCount>>;
	/** The row whose own list `list` is, shown beneath it; `null` for none. */
	listOf: NavRow | null;
	list: ReactNode;
	/** The New session row's label, naming the selected workspace. */
	newSessionLabel: string;
	onNewSession: () => void;
	onTab: (tab: SidebarTab) => void;
	/** The settings section and workspace the Settings row opens. */
	settingsRoute: SettingsRoute;
}

/** A page row's height, a step under the menu's own, so the list reads as one dense column. */
const ROW = "h-7";
const BADGE = "top-1.5 h-4 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground";

export function SidebarNav({ tabs, current, counts, listOf, list, newSessionLabel, onNewSession, onTab, settingsRoute }: SidebarNavProps) {
	const row = (value: NavRow): ReactNode => {
		const active = current === value;
		if (value === "new") {
			return (
				<SidebarMenuItem key={value}>
					<Tooltip content={newSessionLabel} shortcut={shortcutLabels("newSession")} side="right">
						<SidebarMenuButton className={ROW} icon={SquarePen} isActive={active} aria-label={newSessionLabel} onClick={onNewSession}>
							{newSessionLabel}
						</SidebarMenuButton>
					</Tooltip>
				</SidebarMenuItem>
			);
		}
		if (value === "settings") {
			return (
				<SidebarMenuItem key={value}>
					<Tooltip content="Settings" shortcut={shortcutLabels("settings")} side="right">
						<SidebarMenuButton className={ROW} asChild icon={PAGE_ICON.settings} isActive={active}>
							<a href={hashForPage({ kind: "settings", ...settingsRoute })}>Settings</a>
						</SidebarMenuButton>
					</Tooltip>
				</SidebarMenuItem>
			);
		}
		const { label, icon } = TAB_ROWS[value];
		const counted = counts[value];
		const badge = counted && counted.count > 0 ? counted : undefined;
		return (
			<SidebarMenuItem key={value}>
				<Tooltip content={label} shortcut={tabShortcutLabels(value, tabs)} side="right">
					<SidebarMenuButton className={ROW} icon={icon} isActive={active} aria-label={badge ? `${label}, ${badge.says(badge.count)}` : undefined} onClick={() => onTab(value)}>
						{label}
					</SidebarMenuButton>
				</Tooltip>
				{badge && (
					<SidebarMenuBadge aria-hidden className={BADGE}>
						{badge.count}
					</SidebarMenuBadge>
				)}
			</SidebarMenuItem>
		);
	};
	const rows: NavRow[] = ["new", ...tabs, "settings"];
	// The open row's list sits between its row and the next, so the rows split into two menus around it; the page of a
	// tab hidden in Preferences has no row, and its list follows the last one.
	const split = list === null || listOf === null ? -1 : rows.includes(listOf) ? rows.indexOf(listOf) : rows.length - 1;
	const before = split < 0 ? rows : rows.slice(0, split + 1);
	const after = split < 0 ? [] : rows.slice(split + 1);
	return (
		<SidebarGroup className="py-1">
			<nav aria-label="Pages" className="flex flex-col gap-px">
				<SidebarMenu className="gap-px">{before.map(row)}</SidebarMenu>
				{split >= 0 && (
					<ScrollArea className="sidebar-subnav ml-[15px] border-l border-border" viewportClassName="scroll-fade max-h-[45svh] pl-1">
						{list}
					</ScrollArea>
				)}
				{after.length > 0 && <SidebarMenu className="gap-px">{after.map(row)}</SidebarMenu>}
			</nav>
		</SidebarGroup>
	);
}
