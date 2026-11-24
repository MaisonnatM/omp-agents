import { hashForProject } from "../../routing";
import type { DashboardActions } from "../dashboard-context";

/** The project {@link createProject} made last, until its page takes it to select its name. */
let justCreated: string | null = null;

/** Creates a project named "New project" and opens its page, whose name field {@link takeJustCreated} selects for you to type over. */
export function createProject(changeModule: DashboardActions["changeModule"]): void {
	const id = crypto.randomUUID();
	justCreated = id;
	changeModule("projects", { op: "create", id, name: "New project", goal: "", at: new Date().toISOString() });
	location.hash = hashForProject(id);
}

/** Whether project `id` is the one {@link createProject} just made; true once, for the page that opens it. */
export function takeJustCreated(id: string): boolean {
	if (id !== justCreated) return false;
	justCreated = null;
	return true;
}
