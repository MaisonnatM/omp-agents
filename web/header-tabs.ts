/** The header tabs' model, after Capy's desktop tabs: the tab on screen follows where you go, a session already open in another tab is focused there, and only a new-tab request adds one. */
import type { View } from "../src/shared/sessions";
import { focusedView, hashForView, type Page, routeFromHash } from "./routing";

/** One header tab: `id` stays while you move from page to page in it; `hash` is what it shows now. */
export interface HeaderTab {
	id: string;
	hash: string;
}

/** The row and the tab on screen, `active` an index into `tabs`. */
export interface HeaderTabs {
	tabs: readonly HeaderTab[];
	active: number;
}

export const HEADER_TABS_KEY = "omp-agents.header-tabs";

/** What a fresh tab shows, and what closing the last tab leaves, as Capy's `/new`. */
export const NEW_TAB_HASH = "#new";

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

/** The session `hash` focuses, the one thing two tabs never both show; `null` for a page or the home. */
function sessionOf(hash: string): string | null {
	const target = headerTabTarget(hash);
	return target?.kind === "view" ? hashForView(target.view) : null;
}

/**
 * The row once the dashboard went to `to`: a session another tab shows focuses that tab, `newTab` or an empty row adds a tab `newId` at the end,
 * and anything else shows in the tab on screen. The same object when nothing changes, so a render stores only a change.
 */
export function visitHeaderTab(row: HeaderTabs, to: string, newTab: boolean, newId: string): HeaderTabs {
	if (headerTabTarget(to) === null) return row;
	const session = sessionOf(to);
	const showing = session === null ? -1 : row.tabs.findIndex(tab => sessionOf(tab.hash) === session);
	const current = row.tabs[row.active];
	if (showing !== -1 && (newTab || showing !== row.active)) return { tabs: row.tabs.map((tab, index) => (index === showing ? { id: tab.id, hash: to } : tab)), active: showing };
	if (newTab || !current) return { tabs: [...row.tabs, { id: newId, hash: to }], active: row.tabs.length };
	if (current.hash === to) return row;
	return { tabs: row.tabs.map((tab, index) => (index === row.active ? { id: tab.id, hash: to } : tab)), active: row.active };
}

/** The row without tab `id`, and where to go when it was on screen: the tab now in its place, else the one before; closing the last tab leaves a fresh one on New session. */
export function closeHeaderTab(row: HeaderTabs, id: string, newId: string): { row: HeaderTabs; go: string | null } {
	const index = row.tabs.findIndex(tab => tab.id === id);
	if (index === -1) return { row, go: null };
	const tabs = row.tabs.filter(tab => tab.id !== id);
	if (tabs.length === 0) return { row: { tabs: [{ id: newId, hash: NEW_TAB_HASH }], active: 0 }, go: NEW_TAB_HASH };
	if (index !== row.active) return { row: { tabs, active: row.active > index ? row.active - 1 : row.active }, go: null };
	const active = Math.min(index, tabs.length - 1);
	return { row: { tabs, active }, go: tabs[active]?.hash ?? null };
}

/** `row` with its tabs reordered to `tabs`, the same tab still on screen. */
export function reorderHeaderTabs(row: HeaderTabs, tabs: readonly HeaderTab[]): HeaderTabs {
	const id = row.tabs[row.active]?.id;
	return { tabs, active: Math.max(0, tabs.findIndex(tab => tab.id === id)) };
}

export function decodeHeaderTabs(raw: string | null): HeaderTabs {
	try {
		const parsed: unknown = JSON.parse(raw ?? "null");
		if (typeof parsed !== "object" || parsed === null || !("tabs" in parsed) || !Array.isArray(parsed.tabs)) return { tabs: [], active: 0 };
		const tabs = parsed.tabs.filter((tab): tab is HeaderTab => typeof tab?.id === "string" && typeof tab.hash === "string");
		const active = "active" in parsed && typeof parsed.active === "number" ? parsed.active : 0;
		return { tabs, active: Math.min(Math.max(active, 0), Math.max(tabs.length - 1, 0)) };
	} catch {
		return { tabs: [], active: 0 };
	}
}

export const encodeHeaderTabs = (row: HeaderTabs): string => JSON.stringify(row);
