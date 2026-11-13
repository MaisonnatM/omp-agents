import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import { hostLabel, pastLabel } from "./labels";
import { isModulePage, moduleOf } from "./modules";
import type { Page } from "./routing";

export const APP_NAME = "omp agents";

/** What page `page` is called: its own name, or what it shows, such as a pull request or a ticket. The tab title and a header tab both read it. */
export function pageTitle(page: Page): string {
	if (isModulePage(page)) return moduleOf(page).title(page);
	switch (page.kind) {
		case "get-started":
			return "Get started";
		case "new":
			return "New session";
		case "scheduled":
			return "Scheduled session";
		case "settings":
			return "Settings";
		case "pull-requests":
			return page.target ? `${page.target.owner}/${page.target.repo}#${page.target.number}` : "Pull requests";
		case "tickets":
			return page.target ?? "Tickets";
		case "todo":
			return "Todo";
		case "bots":
			if (page.target === null) return page.adding ? "New Bot" : "Bots";
			if (page.routine === null) return "Bot";
			return page.routine.kind === "list" || page.routine.kind === "open" ? "Routines" : "Routine";
		case "calendar":
			return "Calendar";
		case "email":
			return "Email";
		default: {
			const never: never = page;
			return never;
		}
	}
}

/**
 * What the conversation `view` is called, `null` for none. The tab title and a header tab both read it.
 * `host` and `past` are the rows of `view`, `null` once the roster no longer lists them.
 */
export function viewTitle(view: View | null, host: RosterHost | null, past: PastSession | null): string | null {
	if (view?.kind === "past") return past ? pastLabel(past) : null;
	if (view?.kind !== "live") return null;
	const session = host ? hostLabel(host) : null;
	return view.agentId === null ? session : session ? `${view.agentId} · ${session}` : view.agentId;
}

/** The tab title, which the desktop app's window shows too: the open page or the focused conversation, then the app. */
export function documentTitle(page: Page | null, view: View | null, host: RosterHost | null, past: PastSession | null): string {
	const context = page ? pageTitle(page) : viewTitle(view, host, past);
	return context ? `${context} · ${APP_NAME}` : APP_NAME;
}
