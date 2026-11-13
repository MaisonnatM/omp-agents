/** The left sidebar's page list: New session, each shown tab's page with its count, Notifications with its unread count, and Settings; while the sidebar floats, the page on screen holds its own list beneath its row. */
import { IconEditBig } from "central-icons";
import { Fragment, type ReactNode } from "react";
import { SidebarGroup, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarMenuNested } from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip } from "@/components/ui/tooltip";
import { PAGE_ICON } from "../page-icons";
import { hashForNotifications, hashForPage, type SettingsRoute, type SidebarTab } from "../routing";
import { shortcutLabels } from "../shortcuts";
import { type NavRow, TAB_ROWS, tabShortcutLabels } from "../sidebar-tabs";
import { CountPill } from "./count-pill";

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
	/** The current row's own list, shown beneath it, or after the last row for a tab the user hid; `null` for none, as when the page holds its list itself. */
	list: ReactNode;
	/** The New session row's label, naming the selected workspace. */
	newSessionLabel: string;
	onNewSession: () => void;
	onTab: (tab: SidebarTab) => void;
	/** The settings section and workspace the Settings row opens. */
	settingsRoute: SettingsRoute;
	/** How many notices are unread, after the Notifications row's label. */
	unreadNotices: number;
}

export function SidebarNav({ tabs, current, counts, list, newSessionLabel, onNewSession, onTab, settingsRoute, unreadNotices }: SidebarNavProps) {
	const sub = list !== null && (
		<SidebarMenuNested>
			<ScrollArea className="ml-[15px] border-l border-border" viewportClassName="scroll-fade max-h-[30svh] pl-1 [&>div]:!block [&>div]:!min-w-0">
				{list}
			</ScrollArea>
		</SidebarMenuNested>
	);
	return (
		<SidebarGroup className="shrink-0 py-1">
			<nav aria-label="Pages">
				<SidebarMenu className="gap-px">
					<SidebarMenuItem>
						<Tooltip content={newSessionLabel} shortcut={shortcutLabels("newSession")} side="right">
							<SidebarMenuButton size="short" icon={IconEditBig} isActive={current === "new"} aria-label={newSessionLabel} onClick={onNewSession}>
								{newSessionLabel}
							</SidebarMenuButton>
						</Tooltip>
					</SidebarMenuItem>
					{tabs.map(tab => {
						const { label, icon } = TAB_ROWS[tab];
						const counted = counts[tab];
						const badge = counted && counted.count > 0 ? counted : undefined;
						return (
							<Fragment key={tab}>
								<SidebarMenuItem>
									<Tooltip content={label} shortcut={tabShortcutLabels(tab, tabs)} side="right">
										<SidebarMenuButton size="short" icon={icon} isActive={current === tab} aria-label={badge ? `${label}, ${badge.says(badge.count)}` : undefined} onClick={() => onTab(tab)}>
											{label}
										</SidebarMenuButton>
									</Tooltip>
									{badge && (
										<SidebarMenuBadge aria-hidden>
											<CountPill count={badge.count} />
										</SidebarMenuBadge>
									)}
								</SidebarMenuItem>
								{current === tab && sub}
							</Fragment>
						);
					})}
					<SidebarMenuItem>
						<Tooltip content="Notifications" side="right">
							<SidebarMenuButton
								size="short"
								asChild
								icon={PAGE_ICON.notifications}
								isActive={current === "notifications"}
								aria-label={unreadNotices > 0 ? `Notifications, ${unreadNotices} unread` : undefined}
							>
								<a href={hashForNotifications()}>Notifications</a>
							</SidebarMenuButton>
						</Tooltip>
						{unreadNotices > 0 && (
							<SidebarMenuBadge aria-hidden>
								<CountPill count={unreadNotices} />
							</SidebarMenuBadge>
						)}
					</SidebarMenuItem>
					<SidebarMenuItem>
						<Tooltip content="Settings" shortcut={shortcutLabels("settings")} side="right">
							<SidebarMenuButton size="short" asChild icon={PAGE_ICON.settings} isActive={current === "settings"}>
								<a href={hashForPage({ kind: "settings", ...settingsRoute })}>Settings</a>
							</SidebarMenuButton>
						</Tooltip>
					</SidebarMenuItem>
					{/* Settings' list, and the list of a page whose tab the user hid in Preferences, which has no row of its own. */}
					{current !== null && !tabs.some(tab => tab === current) && sub}
				</SidebarMenu>
			</nav>
		</SidebarGroup>
	);
}
