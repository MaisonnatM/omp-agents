import type { Routine } from "../../../src/shared";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { hashForRoutines } from "../../routing";

/** The Routines tab of the sidebar: every routine, then each one by name, a paused one muted. */
export function RoutinesNav({ routines, target }: { routines: Routine[]; target: string | null }) {
	const link = (id: string | null, name: string, muted = false) => (
		<SidebarMenuButton asChild isActive={target === id}>
			<a href={hashForRoutines(id)} aria-current={target === id ? "page" : undefined}>
				<span className={muted ? "truncate text-muted-foreground" : "truncate"}>{name}</span>
			</a>
		</SidebarMenuButton>
	);
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Routines</SidebarGroupLabel>
			<SidebarMenu aria-label="Routines">
				<SidebarMenuItem>{link(null, "All")}</SidebarMenuItem>
				{routines.map(routine => (
					<SidebarMenuItem key={routine.id}>{link(routine.id, routine.name, !routine.enabled)}</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
