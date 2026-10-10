import { useStoredState } from "./stored-state";

/** The project the sidebar and the Pull requests page are scoped to, by `cwd`; absent for all projects. */
const PROJECT_KEY = "omp-agents.sidebar-project";

const decodeProject = (raw: string | null): string | null => raw;
const encodeProject = (cwd: string | null): string => cwd ?? "";

/** The project `cwd` the sidebar and the Pull requests page show, `null` for all projects, and its setter, which localStorage keeps. */
export function useProject(projects: { cwd: string }[]): [string | null, (cwd: string | null) => void] {
	const [stored, pick] = useStoredState(PROJECT_KEY, decodeProject, encodeProject);
	// A stored project with no sessions left, or not yet loaded, shows all of them.
	return [projects.some(({ cwd }) => cwd === stored) ? stored : null, pick];
}
