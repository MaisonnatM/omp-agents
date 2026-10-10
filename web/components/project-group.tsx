import { FolderKanban } from "lucide-react";
import type { View } from "../../src/shared/sessions";
import { SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { hashForProjects } from "../routing";
import { type ProjectGroup, waitsOnYou } from "../sessions";
import { HostRow, PastRow } from "./session-row";

interface ProjectSessionsProps {
	group: ProjectGroup;
	/** The group is unfolded. */
	open: boolean;
	onOpenChange: () => void;
	/** Whether `view` is on screen. */
	isOpen: (view: View) => boolean;
	showWorkspace: boolean;
	onTogglePin: (sessionId: string) => void;
}

/**
 * One project's group in the Sessions tab, nested in the Projects group: the coordinator, then the workers, `w1` first.
 * Each row's badge names its role, and a worker's row reads as the title its coordinator gave it.
 */
export function ProjectSessions({ group: { project, members }, open, onOpenChange, isOpen, showWorkspace, onTogglePin }: ProjectSessionsProps) {
	const waiting = members.filter(({ row }) => row.kind === "live" && waitsOnYou(row.host)).length;
	return (
		// The Projects group's padding already insets it, so the actions move by that padding to stay on the rows' axis.
		<SidebarGroup
			className="p-0"
			collapsible
			open={open}
			onOpenChange={onOpenChange}
			headerActions={
				<SidebarGroupActions className="top-0 right-1.5">
					<Tooltip content="Open project">
						<SidebarGroupAction asChild>
							<a href={hashForProjects({ kind: "project", id: project.id })} aria-label={`Open project ${project.name}`}>
								<FolderKanban />
							</a>
						</SidebarGroupAction>
					</Tooltip>
				</SidebarGroupActions>
			}
		>
			<SidebarGroupLabel>{waiting > 0 ? `${project.name} · ${waiting} waiting` : project.name}</SidebarGroupLabel>
			<SidebarMenu aria-label={`Sessions of project ${project.name}`}>
				{members.map(({ worker, row, pinned }) => {
					const rowProps = { role: worker?.id ?? "Coordinator", roleTitle: worker?.title, pinned, showWorkspace, onTogglePin };
					return row.kind === "live" ? (
						<HostRow key={row.host.instanceId} session={row.host} open={isOpen({ kind: "live", instanceId: row.host.instanceId, agentId: null })} {...rowProps} />
					) : (
						<PastRow key={row.session.sessionId} session={row.session} open={isOpen({ kind: "past", sessionId: row.session.sessionId })} {...rowProps} />
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
