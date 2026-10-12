import { GitPullRequest, NotebookText, TableOfContents, Users } from "lucide-react";
import { type LinkedPullRequest, samePullRequest } from "../../src/shared/github";
import type { Project } from "../../src/shared/projects";
import type { PastSession, RosterHost, View } from "../../src/shared/sessions";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { modeOf, SPLIT_CLICK } from "../labels";
import { useTurnCount } from "../pane-store";
import { projectSession } from "../sessions";
import { useStoredState } from "../stored-state";
import { useDashboardActions } from "./dashboard-context";
import { OutlineTab } from "./outline-tab";
import { PHASE_LABEL, ProjectNotesList } from "./projects/project-parts";
import { SessionPullRequestsTab } from "./session-pull-requests-tab";
import { PANEL_VIEWPORT, PINNED_VIEWPORT, TAB_CLASS, tabLabel } from "./session-details";

/** The coordinator sidebar's tab, kept apart from a session's, since the two sidebars offer different tabs. */
const TAB_KEY = "omp-agents.project-tab";

const PROJECT_TABS = ["outline", "workers", "notes", "pull-requests"] as const;
type ProjectTab = (typeof PROJECT_TABS)[number];

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
	if (project.workers.length === 0) return <p className="px-4 py-2 text-sm text-muted-foreground">No workers yet. The coordinator starts them as it plans.</p>;
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
	/** The coordinator's view, whose conversation the outline follows. */
	view: View;
	working: boolean;
	workspace: string | null;
	hosts: RosterHost[];
	past: PastSession[];
}

/**
 * The right sidebar for a project's coordinator, which changes no code itself: an outline of its conversation, its
 * workers, the project's notes, and the pull requests its workers opened, each tab apart.
 */
export function ProjectDetails({ project, view, working, workspace, hosts, past }: ProjectDetailsProps) {
	const turnCount = useTurnCount(view);
	const pullRequests = workerPullRequests(project, hosts, past);
	const [tab, setTab] = useStoredState<ProjectTab>(TAB_KEY, raw => PROJECT_TABS.find(tab => tab === raw) ?? "workers");
	return (
		<Tabs value={tab} onValueChange={value => setTab(value as ProjectTab)} className="@container/sidebar flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="h-(--page-header-height) flex-row items-center gap-2 border-b border-border px-2 py-0">
				<h2 className="sr-only">Project details</h2>
				<SizeProvider size="compact">
					<TabsList aria-label="Project details">
						<TabItem value="outline" icon={TableOfContents} className={TAB_CLASS} {...tabLabel("Outline", turnCount)} />
						<TabItem value="workers" icon={Users} className={TAB_CLASS} {...tabLabel("Workers", project.workers.length)} />
						<TabItem value="notes" icon={NotebookText} className={TAB_CLASS} {...tabLabel("Notes", 0)} />
						<TabItem value="pull-requests" icon={GitPullRequest} className={TAB_CLASS} {...tabLabel("PRs", pullRequests.length)} />
					</TabsList>
				</SizeProvider>
			</SidebarHeader>
			<TabPanel value="outline" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<OutlineTab view={view} working={working} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="workers" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<WorkersTab project={project} hosts={hosts} past={past} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="notes" asChild>
				<SidebarContent viewportClassName={PANEL_VIEWPORT}>
					<div className="space-y-2 px-3">
						<ProjectNotesList project={project} />
					</div>
				</SidebarContent>
			</TabPanel>
			<TabPanel value="pull-requests" asChild>
				<SidebarContent viewportClassName={PINNED_VIEWPORT}>
					<SessionPullRequestsTab pullRequests={pullRequests} workspace={workspace} hosts={hosts} version={working} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
