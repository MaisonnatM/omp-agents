import type { Routine } from "../../../src/routines";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hashForCalendar, hashForRoutines } from "../../routing";

/** The page under the Calendar tab that is open: the calendar, or the Routines page on a routine or, `null`, the list; `null` for another page. */
export type CalendarTabPage = { kind: "calendar" } | { kind: "routines"; target: string | null } | null;

/** The Calendar tab of the sidebar: the calendar, then every routine, then each one by name, a paused one muted. */
export function CalendarNav({ routines, current }: { routines: Routine[]; current: CalendarTabPage }) {
	const link = (href: string, active: boolean, name: string, muted = false) => (
		<SidebarMenuButton asChild isActive={active}>
			<a href={href} aria-current={active ? "page" : undefined}>
				<span className={muted ? "truncate text-muted-foreground" : "truncate"}>{name}</span>
			</a>
		</SidebarMenuButton>
	);
	const routine = current?.kind === "routines" ? current.target : undefined;
	return (
		<>
			<SidebarGroup>
				<SidebarMenu aria-label="Calendar">
					<SidebarMenuItem>{link(hashForCalendar(), current?.kind === "calendar", "Calendar")}</SidebarMenuItem>
				</SidebarMenu>
			</SidebarGroup>
			<SidebarGroup>
				<SidebarGroupLabel>Routines</SidebarGroupLabel>
				<SidebarMenu aria-label="Routines">
					<SidebarMenuItem>{link(hashForRoutines(null), routine === null, "All")}</SidebarMenuItem>
					{routines.map(({ id, name, enabled }) => (
						<SidebarMenuItem key={id}>{link(hashForRoutines(id), routine === id, name, !enabled)}</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
