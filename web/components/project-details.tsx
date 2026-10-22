import { GitPullRequest, NotebookText, Users } from "lucide-react";
import { type LinkedPullRequest, samePullRequest } from "../../src/shared/github";
import type { Project } from "../../src/shared/projects";
import type { PastSession, RosterHost, View } from "../../src/shared/sessions";
import { modeOf, SPLIT_CLICK } from "../labels";
import { projectSession } from "../sessions";
import { DetailsEmpty, DetailsSidebarFrame } from "./details-sidebar-frame";
import { useDashboardActions } from "./dashboard-context";
import { PHASE_LABEL, ProjectNotesList } from "./projects/project-parts";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";

/** The coordinator sidebar's tab, kept apart from a session's, since the two sidebars offer different tabs. */
const TAB_KEY = "omp-agents.project-tab";

/** What the project's workers submitted or worked on, each pull request once, in worker order. */
function workerPullRequests(project: Project, hosts: RosterHost[], past: PastSession[]): LinkedPullRequest[] {
	const found: LinkedPullRequest[] = [];
	for (const worker of project.workers) {
		const { row } = projectSession(worker.sessionId, hosts, past);
		const pullRequests = row === null ? [] : row.kind === "live" ? row.host.pullRequests : row.session.pullRequests;
		for (const pr of pullRequests) if (!found.some(seen => samePullRequest(seen, pr))) found.push(pr);
	}
	return found;
}

/** Each worker with its phase and the first line of its last reply; a click opens its session. */
function WorkersTab({ project, hosts, past }: { project: Project; hosts: RosterHost[]; past: PastSession[] }) {
	const { open } = useDashboardActions();
	if (project.workers.length === 0) return <DetailsEmpty icon={Users} title="No workers yet" description="The coordinator starts them as it plans." />;
	return (
		<ul aria-label="Workers" className="space-y-0.5 px-2">
			{project.workers.map(worker => {
				const { view, phase } = projectSession(worker.sessionId, hosts, past);
				const reply = worker.lastReply?.text.trim().split("\n")[0];
				return (
					<li key={worker.id}>
						<button
							type="button"
							disabled={view === null}
							title={view ? `Open the session (${SPLIT_CLICK} to split)` : undefined}
							className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:hover:bg-transparent"
							onClick={event => view && open(view, modeOf(event))}
						>
							<span className="flex w-full items-baseline gap-2">
								<span className="shrink-0 font-mono text-xs text-muted-foreground">{worker.id}</span>
								<span className="min-w-0 flex-1 truncate font-medium">{worker.title}</span>
								<span className="shrink-0 text-xs text-muted-foreground">{PHASE_LABEL[phase]}</span>
							</span>
							<span className="truncate text-xs text-muted-foreground" title={worker.lastReply?.text}>
								{reply || "No reply yet"}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

interface ProjectDetailsProps {
	project: Project;
	working: boolean;
	/** The coordinator's directory, which relative paths in its tabs resolve against. */
	cwd: string | null;
	workspace: string | null;
	hosts: RosterHost[];
	past: PastSession[];
	/** The coordinator's `instanceId`, `null` for a past coordinator. */
	current: string | null;
}

/**
 * The right sidebar for a project's coordinator, which changes no code itself: its workers, the project's notes, and
 * the pull requests its workers opened, each tab apart.
 */
export function ProjectDetails({ project, working, cwd, workspace, hosts, past, current }: ProjectDetailsProps) {
	const pullRequests = workerPullRequests(project, hosts, past);
	return (
		<DetailsSidebarFrame
			label="Project details"
			storageKey={TAB_KEY}
			defaultTab="workers"
			cwd={cwd}
			tabs={[
				{ value: "workers", icon: Users, name: "Workers", count: project.workers.length, content: <WorkersTab project={project} hosts={hosts} past={past} /> },
				{
					value: "notes",
					icon: NotebookText,
					name: "Notes",
					count: 0,
					content: (
						<div className="space-y-2 px-3">
							<ProjectNotesList project={project} />
						</div>
					),
				},
				{
					value: "pull-requests",
					icon: GitPullRequest,
					name: "PRs",
					count: pullRequests.length,
					pinned: true,
					content: <SessionPullRequestsTab pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} current={current} scope={`project:${project.id}`} />,
				},
			]}
		/>
	);
}
