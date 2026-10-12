import type { View } from "../../src/shared/sessions";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@/components/ui/sidebar";
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
		<SidebarGroup className="p-0" collapsible open={open} onOpenChange={onOpenChange}>
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
