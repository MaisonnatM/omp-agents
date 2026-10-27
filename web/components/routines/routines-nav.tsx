/** The sidebar's Routines tab: every routine with their count, then each one by name with its task's icon, a paused one muted and one whose last run failed or still runs with that run's dot. */
import { Pause } from "lucide-react";
import type { Routine } from "../../../src/routines";
import { SidebarGroup, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { PAGE_ICON } from "../../page-icons";
import { hashForRoutines } from "../../routing";
import { runHealth } from "../../routines-model";
import { RunDot, TaskIcon } from "./routine-marks";

interface RoutinesNavProps {
	routines: Routine[];
	/** The routine the Routines page shows, `null` for its list, `undefined` while another page is open. */
	current: string | null | undefined;
}

const AllIcon = PAGE_ICON.routines;

export function RoutinesNav({ routines, current }: RoutinesNavProps) {
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Routines">
				<SidebarMenuItem>
					<SidebarMenuButton asChild isActive={current === null}>
						<a href={hashForRoutines(null)} aria-current={current === null ? "page" : undefined} aria-label={`All, ${routines.length} routines`}>
							<AllIcon className="size-4" />
							<span className="truncate">All</span>
						</a>
					</SidebarMenuButton>
					<SidebarMenuBadge aria-hidden>{routines.length}</SidebarMenuBadge>
				</SidebarMenuItem>
				{routines.map(({ id, name, enabled, task, runs }) => {
					const active = current === id;
					const last = runs[0];
					const health = last && runHealth(last);
					const flagged = health === "failed" || health === "running";
					return (
						<SidebarMenuItem key={id}>
							<SidebarMenuButton asChild isActive={active}>
								<a href={hashForRoutines(id)} aria-current={active ? "page" : undefined} className={enabled ? undefined : "text-muted-foreground"}>
									{enabled ? <TaskIcon task={task} className="size-4" /> : <Pause aria-label="Paused" className="size-4" />}
									<span className="truncate">{name}</span>
								</a>
							</SidebarMenuButton>
							{flagged && (
								<SidebarMenuBadge>
									<RunDot run={last} />
								</SidebarMenuBadge>
							)}
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
