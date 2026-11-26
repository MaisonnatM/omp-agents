/** A Board Workspace's Projects list: a search field, All projects, and New project, then each open project, and the archived ones under Archived. */
import { IconArchive, IconFlag1, IconLayoutGrid1, IconPlusSmall } from "central-icons";
import { useState } from "react";
import { openProjects, type Project, type ProjectList } from "../../../src/shared/projects";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { usePageHash } from "../../page-hash";
import { hashForProject } from "../../routing";
import { useDashboardActions } from "../dashboard-context";
import { SidebarSearch } from "../sidebar-search";
import { createProject } from "./new-project";

interface ProjectsNavProps {
	/** `null` until the server sends the projects. */
	state: ProjectList | null;
	/** The open project's id, `null` while the table shows. */
	openId: string | null;
	disabled: boolean;
	/** The Workspace a new project is made in. */
	workspace?: string;
}

export function ProjectsNav({ state, openId, disabled, workspace }: ProjectsNavProps) {
	const [query, setQuery] = useState("");
	const to = usePageHash();
	const { changeModule } = useDashboardActions();
	const needle = query.trim().toLowerCase();
	const matches = (project: Project) => !needle || project.name.toLowerCase().includes(needle) || project.goal.toLowerCase().includes(needle);
	const open = state === null ? [] : openProjects(state).filter(matches);
	const archived = state === null ? [] : state.projects.filter(project => project.archivedAt !== undefined && matches(project));
	const links = (list: readonly Project[]) => list.map(project => <ProjectLink key={project.id} project={project} active={openId === project.id} />);
	return (
		<>
			<SidebarGroup className="flex-row items-center gap-1">
				<div className="min-w-0 flex-1">
					<SidebarSearch label="Filter the projects" placeholder="Search projects" query={query} onQuery={setQuery} />
				</div>
				<Tooltip content="All projects" side="bottom">
					<Button variant="ghost" size="icon-compact" className="shrink-0" render={<a href={hashForProject(null, to)} aria-label="All projects" aria-current={openId === null ? "page" : undefined} />}>
						<IconLayoutGrid1 />
					</Button>
				</Tooltip>
				<Tooltip content="New project" side="bottom">
					<Button {...activityControl("projects.new")} variant="ghost" size="icon-compact" className="shrink-0" aria-label="New project" disabled={disabled} onClick={() => createProject(changeModule, to, workspace)}>
						<IconPlusSmall />
					</Button>
				</Tooltip>
			</SidebarGroup>
			{state === null ? (
				<NavNote>Loading your projects…</NavNote>
			) : state.projects.length === 0 ? (
				<NavNote>No projects yet. Make one with the + button.</NavNote>
			) : open.length === 0 && archived.length === 0 ? (
				<NavNote>{`No projects match “${query.trim()}”`}</NavNote>
			) : (
				<>
					{open.length > 0 && (
						<SidebarGroup>
							<SidebarMenu aria-label="Open projects">{links(open)}</SidebarMenu>
						</SidebarGroup>
					)}
					{archived.length > 0 && (
						<SidebarGroup>
							<SidebarGroupLabel icon={IconArchive}>Archived</SidebarGroupLabel>
							<SidebarMenu aria-label="Archived projects">{links(archived)}</SidebarMenu>
						</SidebarGroup>
					)}
				</>
			)}
		</>
	);
}

function NavNote({ children }: { children: string }) {
	return (
		<SidebarGroup>
			<p className="px-2 py-1 text-xs text-muted-foreground">{children}</p>
		</SidebarGroup>
	);
}

/** A project's row: its name, which opens it beside the list, and how much of its plan is done. */
function ProjectLink({ project, active }: { project: Project; active: boolean }) {
	const to = usePageHash();
	const archived = project.archivedAt !== undefined;
	const done = project.steps.filter(step => step.done).length;
	const total = project.steps.length;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild isActive={active} className="gap-2">
				<a {...activityControl("projects.open")} href={hashForProject(project.id, to)} title={project.name}>
					<IconFlag1 className="size-3.5 shrink-0 text-muted-foreground" />
					<span className={cn("min-w-0 flex-1 truncate", archived && "text-muted-foreground")}>{project.name}</span>
					{total > 0 && (
						<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
							{done}/{total}
						</span>
					)}
				</a>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
