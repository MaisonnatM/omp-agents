/** The sidebar's Sport tab: the page's week, journal, and progress. */
import { CalendarDays, ChartLine, type LucideIcon, NotebookText } from "lucide-react";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hashForSport, type SportRoute } from "../../routing";

/** The Sport page's three tabs, as the sidebar and the page's header list them. */
export const SPORT_TABS = [
	{ route: { tab: "week", day: null }, name: "Semaine", icon: CalendarDays },
	{ route: { tab: "journal", open: null }, name: "Journal", icon: NotebookText },
	{ route: { tab: "progress" }, name: "Progrès", icon: ChartLine },
] as const satisfies readonly { route: SportRoute; name: string; icon: LucideIcon }[];

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
