import { useEffect, useMemo } from "react";
import type { Project } from "../src/shared/projects";
import type { PastSession, RosterHost } from "../src/shared/sessions";
import type { DashboardState } from "./dashboard-state";
import { useProject } from "./project";
import { pullRequestsStore } from "./reads";
import { discoverableSessions, projectSwitch, workspaces } from "./sessions";

/** The directories the sidebar, the palette, and the pages list, and the project they are scoped to. */
export interface Workspace {
	/** The sessions in neither a temporary nor a hidden directory. The raw lists keep the others for what links to them. */
	visible: { hosts: RosterHost[]; past: PastSession[] };
	hiddenCwds: ReadonlySet<string>;
	/** The projects, as {@link workspaces} lists them. */
	projects: Project[];
	/** The project `cwd` the sidebar and the Pull requests page show, `null` for all projects. */
	project: string | null;
	pickProject: (cwd: string | null) => void;
}

/**
 * The visible sessions, the projects they form, and the selected project. It polls that project's pull requests, which keeps the
 * Pull requests tab's count current on every page, and follows a session this page starts into its project.
 */
export function useWorkspace(state: DashboardState): Workspace {
	// Temporary and hidden workspaces remain in the raw sessions; only discoverable sessions enter the project and sidebar view.
	const hiddenCwds = useMemo(() => new Set(state.projectList.hidden.map(hidden => hidden.cwd)), [state.projectList.hidden]);
	const visible = useMemo(() => discoverableSessions(state.hosts, state.past, hiddenCwds), [state.hosts, state.past, hiddenCwds]);
	const projects = useMemo(
		() => workspaces(visible.hosts, visible.past, state.projectList.added.filter(added => !hiddenCwds.has(added.cwd))),
		[visible, state.projectList.added, hiddenCwds],
	);
	const [project, pickProject] = useProject(projects);
	// Until the sessions are listed, the saved project reads as all projects.
	pullRequestsStore.usePolling(project, state.listed);
	const { started } = state;
	useEffect(() => {
		if (!started) return;
		const next = projectSwitch(project, started.cwd, hiddenCwds);
		if (next !== null) pickProject(next);
	}, [started]);
	return useMemo(() => ({ visible, hiddenCwds, projects, project, pickProject }), [visible, hiddenCwds, projects, project, pickProject]);
}
