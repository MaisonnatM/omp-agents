/** The header tabs' model: each tab follows where you go in it, as a browser tab does, kept in this browser in the order you dragged them. */
import type { View } from "../src/shared/sessions";
import { focusedView, hashForView, type Page, routeFromHash } from "./routing";

/** One header tab: `id` stays while you move from page to page in it; `hash` is what it shows now. */
export interface HeaderTab {
	id: string;
	hash: string;
}

export const HEADER_TABS_KEY = "omp-agents.header-tabs";

/** What a tab's `hash` shows: a page, the session focused in the panes, or the home with no pane; `null` for `#session/<id>`, which the dashboard replaces with the panes it opens. */
export type HeaderTabTarget = { kind: "page"; page: Page } | { kind: "view"; view: View } | { kind: "home" };

export function headerTabTarget(hash: string): HeaderTabTarget | null {
	const route = routeFromHash(hash);
	switch (route.kind) {
		case "page":
			return { kind: "page", page: route.page };
		case "session":
			return null;
		case "panes": {
			const view = focusedView(route.layout);
			return view ? { kind: "view", view } : { kind: "home" };
		}
		default: {
			const never: never = route;
			return never;
		}
	}
}

/** What `target` is, one per page kind or per focused session, so no two tabs show the same thing. */
export function headerTabKey(target: HeaderTabTarget): string {
	switch (target.kind) {
		case "page":
			return `page:${target.page.kind}`;
		case "view":
			return `view:${hashForView(target.view)}`;
		case "home":
			return "home";
		default: {
			const never: never = target;
			return never;
		}
	}
}

/** The key of what `hash` shows, `null` for a hash no tab shows. */
export function headerTabKeyOf(hash: string): string | null {
	const target = headerTabTarget(hash);
	return target && headerTabKey(target);
}

/** The tab showing what `hash` names, if one does. */
export function headerTabShowing(tabs: readonly HeaderTab[], hash: string): HeaderTab | undefined {
	const key = headerTabKeyOf(hash);
	return key === null ? undefined : tabs.find(tab => headerTabKeyOf(tab.hash) === key);
}

/**
 * `tabs` once the dashboard went from `from` to `to`: the tab already showing `to`'s page or session takes it, else the tab that showed `from` goes there,
 * else a new tab opens at the end, with id `newId`. A `from` of `null` asks for a new tab.
 * `tabs` itself when nothing changes, so the row can work out the visit each render and store only a change.
 */
export function visitHeaderTab(tabs: readonly HeaderTab[], from: string | null, to: string, newId: string): readonly HeaderTab[] {
	if (headerTabTarget(to) === null) return tabs;
	const known = headerTabShowing(tabs, to) ?? (from === null ? undefined : headerTabShowing(tabs, from));
	if (!known) return [...tabs, { id: newId, hash: to }];
	if (known.hash === to) return tabs;
	return tabs.map(tab => (tab === known ? { id: tab.id, hash: to } : tab));
}

/** `tabs` without the tab `id`, and where to go when it was the one on screen, `activeId`: the tab now in its place, else the one before it, else the home. `null` stays put. */
export function closeHeaderTab(tabs: readonly HeaderTab[], id: string, activeId: string | null): { tabs: readonly HeaderTab[]; go: string | null } {
	const index = tabs.findIndex(tab => tab.id === id);
	const rest = tabs.filter(tab => tab.id !== id);
	if (id !== activeId) return { tabs: rest, go: null };
	return { tabs: rest, go: rest[Math.min(index, rest.length - 1)]?.hash ?? "" };
}

export function decodeHeaderTabs(raw: string | null): readonly HeaderTab[] {
	try {
		const parsed: unknown = JSON.parse(raw ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((tab): tab is HeaderTab => typeof tab?.id === "string" && typeof tab.hash === "string");
	} catch {
		return [];
	}
}

export const encodeHeaderTabs = (tabs: readonly HeaderTab[]): string => JSON.stringify(tabs);
