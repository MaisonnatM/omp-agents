/** The Projects page: every project in a table, or the open project's page. */
import { IconFlag1, IconPlusSmall } from "central-icons";
import { openProjects, type Project, type ProjectList } from "../../../src/shared/projects";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { activityControl } from "../../activity";
import { hashForProject } from "../../routing";
import { Age } from "../age";
import { useDashboardActions } from "../dashboard-context";
import { PageFrame } from "../list-page";
import type { CoreData } from "../module-views";
import { ProjectDetail } from "./detail";
import type { ProjectsRoute } from "./module";
import { createProject } from "./new-project";
import { type OnProjectChange, StatusBadge } from "./parts";

interface ProjectsPageProps {
	route: ProjectsRoute;
	core: CoreData;
	state: ProjectList | null;
	disabled: boolean;
	onChange: OnProjectChange;
	/** The empty state's title, for a page showing only some projects, such as a Board's Projects tab. */
	empty?: string;
	/** The Workspace a new project is made in, for a Board's Projects tab; absent on the Projects page. */
	workspace?: string;
}

const ABOUT = "Efforts that span sessions";

const HEAD = "h-10 font-medium whitespace-nowrap";

export function ProjectsPage({ route, core, state, disabled, onChange, empty = "No projects yet", workspace }: ProjectsPageProps) {
	if (state === null) {
		return (
			<PageFrame title="Projects" meta={ABOUT}>
				<p className="mx-auto w-full max-w-5xl px-6 py-6 text-sm text-muted-foreground">Loading your projects…</p>
			</PageFrame>
		);
	}
	const shown = route.open === null ? undefined : state.projects.find(project => project.id === route.open);
	if (shown) return <ProjectDetail key={shown.id} project={shown} sessions={core.sessions} disabled={disabled} onChange={onChange} />;
	const open = openProjects(state);
	const archived = state.projects.filter(project => project.archivedAt !== undefined);
	if (state.projects.length === 0) {
		return (
			<PageFrame title="Projects" meta={ABOUT}>
				<Empty className="mx-auto max-w-5xl px-6 py-16">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconFlag1 />
						</EmptyMedia>
						<EmptyTitle>{empty}</EmptyTitle>
						<EmptyDescription>A project gathers the sessions of one effort, with its goal, plan, decisions, and log, which each session in it gets at its start.</EmptyDescription>
					</EmptyHeader>
					<NewProjectButton disabled={disabled} workspace={workspace} />
				</Empty>
			</PageFrame>
		);
	}
	const live = new Set(core.sessions.hosts.map(host => host.sessionId));
	return (
		<PageFrame title="Projects" meta={open.length === 0 ? "No open project" : `${open.length} open`} actions={<NewProjectButton disabled={disabled} workspace={workspace} />}>
			<div className="@container mx-auto w-full max-w-5xl px-6 py-6">
				<section aria-label="Projects" className="overflow-hidden rounded-xl border border-border">
					<table className="w-full table-fixed text-sm">
						<caption className="sr-only">Every project, open ones first</caption>
						<thead>
							<tr className="border-b border-border text-left text-xs text-muted-foreground">
								<th scope="col" className={cn(HEAD, "px-4")}>
									Project
								</th>
								<th scope="col" className={cn(HEAD, "w-24 px-3 @max-4xl:hidden")}>
									Status
								</th>
								<th scope="col" className={cn(HEAD, "w-40 px-3")}>
									Progress
								</th>
								<th scope="col" className={cn(HEAD, "w-32 px-3 text-right @max-3xl:hidden")}>
									Sessions
								</th>
								<th scope="col" className={cn(HEAD, "w-28 px-4 text-right")}>
									Last update
								</th>
							</tr>
						</thead>
						<tbody>
							{[...open, ...archived].map(project => (
								<ProjectRow key={project.id} project={project} running={project.sessionIds.filter(id => live.has(id)).length} />
							))}
						</tbody>
					</table>
				</section>
			</div>
		</PageFrame>
	);
}

function NewProjectButton({ disabled, workspace }: { disabled: boolean; workspace?: string }) {
	const { changeModule } = useDashboardActions();
	return (
		<Button {...activityControl("projects.new")} size="compact" leadingIcon={IconPlusSmall} disabled={disabled} onClick={() => createProject(changeModule, workspace)}>
			New project
		</Button>
	);
}

/** A project's row: its name, which opens it, its status, how much of its plan is done, its sessions, and when it was last logged. */
function ProjectRow({ project, running }: { project: Project; running: number }) {
	const archived = project.archivedAt !== undefined;
	const done = project.steps.filter(step => step.done).length;
	const total = project.steps.length;
	const sessions = project.sessionIds.length;
	const last = project.log.at(-1);
	return (
		<tr className={cn("relative h-10 border-b border-border/60 last:border-b-0 hover:bg-accent/50 has-[:focus-visible]:bg-accent/50", archived && "text-muted-foreground")}>
			<td className="px-4">
				<a {...activityControl("projects.open")} href={hashForProject(project.id)} title={project.name} className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 hover:underline">
					<IconFlag1 className="size-3.5 shrink-0 text-muted-foreground" />
					<span className={cn("truncate", !archived && "font-medium")}>{project.name}</span>
				</a>
			</td>
			<td className="px-3 @max-4xl:hidden">
				<StatusBadge on={!archived}>{archived ? "Archived" : "Open"}</StatusBadge>
			</td>
			<td className="px-3">
				{total === 0 ? (
					<span className="text-xs text-muted-foreground">No steps</span>
				) : (
					<div className="flex items-center gap-2.5">
						<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${project.name} plan progress`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
							<div className={cn("h-full rounded-full", archived ? "bg-muted-foreground" : "bg-success")} style={{ width: `${(done / total) * 100}%` }} />
						</div>
						<span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
							{done}/{total}
						</span>
					</div>
				)}
			</td>
			<td className="px-3 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums @max-3xl:hidden">{sessions === 0 ? "None" : `${running} of ${sessions} running`}</td>
			<td className="px-4 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
				{last ? (
					<time dateTime={last.at}>
						<Age at={Date.parse(last.at)} compact exact className="tabular-nums" /> ago
					</time>
				) : (
					"—"
				)}
			</td>
		</tr>
	);
}
