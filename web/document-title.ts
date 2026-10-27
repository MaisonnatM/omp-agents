import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import { hostLabel, pastLabel } from "./labels";
import type { Page } from "./routing";

export const APP_NAME = "omp agents";

/** What the page or conversation in front is called, or `null` when nothing is open. */
function contextOf(page: Page | null, view: View | null, host: RosterHost | null, past: PastSession | null): string | null {
	switch (page?.kind) {
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
		case "notes":
			return "Notes";
		case "bots":
			if (page.target === null) return "New Bot";
			if (page.routine === null) return "Bot";
			return page.routine.kind === "list" || page.routine.kind === "open" ? "Routines" : "Routine";
		case "calendar":
			return "Calendar";
		case "email":
			return "Email";
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
 * `host` and `past` are the rows of `view`, `null` once the roster no longer lists them.
 */
export function documentTitle(page: Page | null, view: View | null, host: RosterHost | null, past: PastSession | null): string {
	const context = contextOf(page, view, host, past);
	return context ? `${context} · ${APP_NAME}` : APP_NAME;
}
