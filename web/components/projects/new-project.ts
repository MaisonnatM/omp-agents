import { hashForProject, type PageHash } from "../../routing";
import type { DashboardActions } from "../dashboard-context";

/** The project {@link createProject} made last, until its page takes it to select its name. */
let justCreated: string | null = null;

/** Creates a project named "New project", in Workspace `workspace` when a Board's Projects tab makes it, and opens its page, whose name field {@link takeJustCreated} selects for you to type over. */
export function createProject(changeModule: DashboardActions["changeModule"], to: PageHash, workspace?: string): void {
	const id = crypto.randomUUID();
	justCreated = id;
	changeModule("projects", { op: "create", id, name: "New project", goal: "", at: new Date().toISOString(), ...(workspace ? { workspace } : {}) });
	location.hash = hashForProject(id, to);
}

/** Whether project `id` is the one {@link createProject} just made; true once, for the page that opens it. */
export function takeJustCreated(id: string): boolean {
	if (id !== justCreated) return false;
	justCreated = null;
	return true;
}
