import type { Project } from "../src/shared/projects";
import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import { hostLabel, pastLabel } from "./labels";
import type { Page } from "./routing";

export const APP_NAME = "omp agents";

/** What the page or conversation in front is called, or `null` when nothing is open. */
function contextOf(page: Page | null, view: View | null, host: RosterHost | null, past: PastSession | null, projects: readonly Project[]): string | null {
	switch (page?.kind) {
		case "new":
			return "New session";
		case "settings":
			return "Settings";
		case "pull-requests":
			return page.target ? `${page.target.owner}/${page.target.repo}#${page.target.number}` : "Pull requests";
		case "tickets":
			return page.target ?? "Tickets";
		case "todo":
			return "Todo";
		case "routines":
			return "Routines";
		case "projects": {
			const { target } = page;
			if (target.kind === "new") return "New project";
			return (target.kind === "project" && projects.find(({ id }) => id === target.id)?.name) || "Projects";
		}
		case "calendar":
			return "Calendar";
		case "changes":
			return page.path ? `${page.path.split("/").pop()} · Changes` : "Changes";
		case undefined: {
			if (view?.kind === "past") return past ? pastLabel(past) : null;
			if (view?.kind !== "live") return null;
			const session = host ? hostLabel(host) : null;
			return view.agentId === null ? session : session ? `${view.agentId} · ${session}` : view.agentId;
		}
	}
}

/**
 * The tab title, which the desktop app's window shows too: the open page or the focused conversation, then the app.
 * `host` and `past` are the rows of `view`, `null` once the roster no longer lists them; `projects` name a project's page.
 */
export function documentTitle(page: Page | null, view: View | null, host: RosterHost | null, past: PastSession | null, projects: readonly Project[]): string {
	const context = contextOf(page, view, host, past, projects);
	return context ? `${context} · ${APP_NAME}` : APP_NAME;
}
