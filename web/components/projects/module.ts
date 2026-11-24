/** The Projects module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. See docs/architecture/projects.md. */
import { IconFlag1 } from "central-icons";
import { applyProjectChange, type ProjectChange, type ProjectList } from "../../../src/shared/projects";
import { decodeSegment } from "../../hash-segment";
import type { StoredPageModule } from "../../modules";

/** The Projects page: every project, or project `open`'s page. */
export interface ProjectsRoute {
	open: string | null;
}

export type ProjectsControlId =
	| "projects.new"
	| "projects.open"
	| "projects.name"
	| "projects.goal"
	| "projects.step.toggle"
	| "projects.step.add"
	| "projects.step.edit"
	| "projects.step.remove"
	| "projects.step.add-sub"
	| "projects.step.select"
	| "projects.step.start"
	| "projects.decision.add"
	| "projects.decision.remove"
	| "projects.log.add"
	| "projects.session.open"
	| "projects.session.new"
	| "projects.archive";

export const PROJECTS_PAGE: StoredPageModule<"projects", ProjectsRoute, ProjectList, ProjectChange, never, ProjectsControlId> = {
	id: "projects",
	tab: { label: "Projects", icon: IconFlag1, place: 80 },
	about: "Efforts that span sessions and workspaces, each with a goal, a plan, decisions, and a log every session in it gets at its start.",
	offNote: "While Projects is off, the sidebar no longer groups sessions by project; sessions already in one still get its brief.",
	listsItself: true,
	home: { open: null },
	/** `#projects` lists every project, and `#projects/<id>` opens that project's page. */
	address: {
		parse: rest => ({ open: rest ? decodeSegment(rest) : null }),
		rest: route => (route.open === null ? null : encodeURIComponent(route.open)),
		query: () => null,
	},
	title: () => "Projects",
	views: [
		{ key: "projects", label: "Projects" },
		{ key: "projects/item", label: "A project" },
	],
	view: route => (route.open === null ? "projects" : "projects/item"),
	shortcuts: {
		category: "Projects",
		goTo: { label: "Go to your projects", command: "Go to projects", keys: [] },
		rows: [],
	},
	controls: [
		{ id: "projects.new", label: "Projects New project button, on the page or the sidebar", area: "Projects" },
		{ id: "projects.open", label: "Projects project row or sidebar folder", area: "Projects" },
		{ id: "projects.name", label: "Project name field", area: "Projects" },
		{ id: "projects.goal", label: "Project goal field", area: "Projects" },
		{ id: "projects.step.toggle", label: "Project step checkbox", area: "Projects" },
		{ id: "projects.step.add", label: "Project Add step field", area: "Projects" },
		{ id: "projects.step.edit", label: "Project step text", area: "Projects" },
		{ id: "projects.step.remove", label: "Project step Remove button", area: "Projects" },
		{ id: "projects.step.add-sub", label: "Project step Add a sub-step button", area: "Projects" },
		{ id: "projects.step.select", label: "Project plan Select button, or a step's box or text while selecting", area: "Projects" },
		{ id: "projects.step.start", label: "Project plan Start session button, or a step's play button", area: "Projects" },
		{ id: "projects.decision.add", label: "Project Add decision field", area: "Projects" },
		{ id: "projects.decision.remove", label: "Project decision Remove button", area: "Projects" },
		{ id: "projects.log.add", label: "Project Add log line field", area: "Projects" },
		{ id: "projects.session.open", label: "Project session row", area: "Projects" },
		{ id: "projects.session.new", label: "Project New session button", area: "Projects" },
		{ id: "projects.archive", label: "Project Archive and Restore button", area: "Projects" },
	],
	store: {
		apply(list, change) {
			const applied = applyProjectChange(list, change);
			return "ok" in applied ? applied.ok : null;
		},
	},
};
