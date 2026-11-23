/** The Projects page, which `WEB_MODULES` in `web/modules.ts` lists: a view of the Board's project channels, whose state and changes are the Board module's. See docs/architecture/projects.md. */
import { IconFlag1 } from "central-icons";
import { decodeSegment } from "../../hash-segment";
import type { PageModule } from "../../modules";

/** The Projects page: every project, or the page of project channel `open`. */
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

export const PROJECTS_PAGE: PageModule<"projects", ProjectsRoute, never, ProjectsControlId> = {
	id: "projects",
	tab: { label: "Projects", icon: IconFlag1, place: 80 },
	about: "Efforts that span sessions and workspaces, each with a goal, a plan, decisions, and a log every session in it gets at its start.",
	listsItself: true,
	home: { open: null },
	/** `#projects` lists every project, and `#projects/<channelId>` opens that project's page. */
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
		{ id: "projects.step.start", label: "Project plan Start session button", area: "Projects" },
		{ id: "projects.decision.add", label: "Project Add decision field", area: "Projects" },
		{ id: "projects.decision.remove", label: "Project decision Remove button", area: "Projects" },
		{ id: "projects.log.add", label: "Project Add log line field", area: "Projects" },
		{ id: "projects.session.open", label: "Project session row", area: "Projects" },
		{ id: "projects.session.new", label: "Project New session button", area: "Projects" },
		{ id: "projects.archive", label: "Project Archive and Restore button", area: "Projects" },
	],
};
