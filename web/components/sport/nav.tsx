/** The sidebar's Sport tab: the page's week, journal, and progress. */
import { IconCalendarDays, IconLineChart1, IconNotebook } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { ControlId } from "../../../src/shared/activity";
import { hashForSport, type SportRoute } from "../../routing";

/** The Sport page's three tabs, as the sidebar and the page's header list them; `control` tags the header's tab. */
export const SPORT_TABS = [
	{ route: { tab: "week", day: null }, name: "Semaine", icon: IconCalendarDays, control: "sport.tab.week" },
	{ route: { tab: "journal", open: null }, name: "Journal", icon: IconNotebook, control: "sport.tab.journal" },
	{ route: { tab: "progress" }, name: "Progrès", icon: IconLineChart1, control: "sport.tab.progress" },
] as const satisfies readonly { route: SportRoute; name: string; icon: IconComponent; control: ControlId }[];

/** `open` is the route the Sport page shows, `null` while another page is open. */
export function SportNav({ open }: { open: SportRoute | null }) {
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Sport">
				{SPORT_TABS.map(({ route, name, icon: Icon }) => {
					const active = open?.tab === route.tab;
					return (
						<SidebarMenuItem key={route.tab}>
							<SidebarMenuButton asChild isActive={active}>
								<a href={hashForSport(route)} aria-current={active ? "page" : undefined}>
									<Icon className="size-4" />
									<span className="truncate">{name}</span>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
