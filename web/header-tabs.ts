/** The header tabs' model, after Capy's desktop tabs: the tab on screen follows where you go, a session already open in another tab is focused there, only a new-tab request adds one, pinned tabs sit first and stay open, and a closed tab can come back where it was. */
import type { View } from "../src/shared/sessions";
import { focusedView, hashForView, type Page, routeFromHash } from "./routing";

/** One header tab: `id` stays while you move from page to page in it; `hash` is what it shows now; a `pinned` one sits before the others and has no ×. */
export interface HeaderTab {
	id: string;
	hash: string;
	pinned?: true;
}

/** A tab Reopen closed tab can bring back, and the place it had in the row. */
export interface ClosedHeaderTab {
	tab: HeaderTab;
	index: number;
}

/** The row, the tab on screen, `active` an index into `tabs`, and the closed tabs, the latest last. */
export interface HeaderTabs {
	tabs: readonly HeaderTab[];
	active: number;
	closed: readonly ClosedHeaderTab[];
}

export const HEADER_TABS_KEY = "omp-agents.header-tabs";

/** What a fresh tab shows, and what closing the last tab leaves, as Capy's `/new`. */
export const NEW_TAB_HASH = "#new";

/** How many closed tabs Reopen closed tab can bring back, the oldest dropped first. */
export const CLOSED_TABS_KEPT = 20;

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

/** `tabs` with the pinned ones first, each group in its order, and `active` still on the tab it was on. */
function pinnedFirst(row: HeaderTabs, tabs: readonly HeaderTab[]): HeaderTabs {
	const id = row.tabs[row.active]?.id;
	const ordered = [...tabs.filter(tab => tab.pinned), ...tabs.filter(tab => !tab.pinned)];
	return { tabs: ordered, active: Math.max(0, ordered.findIndex(tab => tab.id === id)), closed: row.closed };
}

/** `closed` with `entries` added, the last of them reopening first, past {@link CLOSED_TABS_KEPT} dropping the oldest. */
const remember = (closed: readonly ClosedHeaderTab[], entries: readonly ClosedHeaderTab[]): ClosedHeaderTab[] => [...closed, ...entries].slice(-CLOSED_TABS_KEPT);

/**
 * The row once the dashboard went to `to`: a session another tab shows focuses that tab, `newTab` or an empty row adds a tab `newId` at the end,
 * and anything else shows in the tab on screen. The same object when nothing changes, so a render stores only a change.
 */
export function visitHeaderTab(row: HeaderTabs, to: string, newTab: boolean, newId: string): HeaderTabs {
	if (headerTabTarget(to) === null) return row;
	const session = sessionOf(to);
	const showing = session === null ? -1 : row.tabs.findIndex(tab => sessionOf(tab.hash) === session);
	const current = row.tabs[row.active];
	if (showing !== -1 && (newTab || showing !== row.active)) return { ...row, tabs: row.tabs.map((tab, index) => (index === showing ? { ...tab, hash: to } : tab)), active: showing };
	if (newTab || !current) return { ...row, tabs: [...row.tabs, { id: newId, hash: to }], active: row.tabs.length };
	if (current.hash === to) return row;
	return { ...row, tabs: row.tabs.map((tab, index) => (index === row.active ? { ...tab, hash: to } : tab)) };
}

/**
 * The row without tab `id`, and where to go when it was on screen: the tab now in its place, else the one before; closing the last tab leaves a fresh one on New session.
 * A pinned tab stays until it is unpinned. The closed tab is kept for {@link reopenHeaderTab}.
 */
export function closeHeaderTab(row: HeaderTabs, id: string, newId: string): { row: HeaderTabs; go: string | null } {
	const index = row.tabs.findIndex(tab => tab.id === id);
	const tab = row.tabs[index];
	if (!tab || tab.pinned) return { row, go: null };
	const tabs = row.tabs.filter(each => each.id !== id);
	const closed = remember(row.closed, [{ tab, index }]);
	if (tabs.length === 0) return { row: { tabs: [{ id: newId, hash: NEW_TAB_HASH }], active: 0, closed }, go: NEW_TAB_HASH };
	if (index !== row.active) return { row: { tabs, active: row.active > index ? row.active - 1 : row.active, closed }, go: null };
	const active = Math.min(index, tabs.length - 1);
	return { row: { tabs, active, closed }, go: tabs[active]?.hash ?? null };
}

/**
 * The row with only the pinned tabs and tab `id`, which goes on screen, and where to go when it was not; `null` when that closes nothing.
 * Reopen closed tab brings the others back from the left.
 */
export function closeOtherHeaderTabs(row: HeaderTabs, id: string): { row: HeaderTabs; go: string | null } | null {
	const keep = (tab: HeaderTab): boolean => tab.pinned === true || tab.id === id;
	const gone = row.tabs.flatMap((tab, index) => (keep(tab) ? [] : [{ tab, index }]));
	const tabs = row.tabs.filter(keep);
	const active = tabs.findIndex(tab => tab.id === id);
	if (gone.length === 0 || active === -1) return null;
	return { row: { tabs, active, closed: remember(row.closed, gone.toReversed()) }, go: row.tabs[row.active]?.id === id ? null : (tabs[active]?.hash ?? null) };
}

/**
 * The row with the last closed tab back at its place, among the pinned tabs if it was pinned and after them if not, and on screen; `go` is what it shows.
 * A session another tab shows by now focuses that tab instead, so no two tabs show it. `null` with no closed tab.
 */
export function reopenHeaderTab(row: HeaderTabs): { row: HeaderTabs; go: string } | null {
	const last = row.closed.at(-1);
	if (!last) return null;
	const closed = row.closed.slice(0, -1);
	const session = sessionOf(last.tab.hash);
	const showing = session === null ? -1 : row.tabs.findIndex(tab => sessionOf(tab.hash) === session);
	const shown = row.tabs[showing];
	if (shown) return { row: { ...row, active: showing, closed }, go: shown.hash };
	const pinned = row.tabs.filter(tab => tab.pinned).length;
	const index = last.tab.pinned ? Math.min(last.index, pinned) : Math.min(Math.max(last.index, pinned), row.tabs.length);
	return { row: { tabs: [...row.tabs.slice(0, index), last.tab, ...row.tabs.slice(index)], active: index, closed }, go: last.tab.hash };
}

/** The row with tab `id` pinned, last of the pinned tabs, or unpinned, first of the others; the same tab stays on screen. */
export function pinHeaderTab(row: HeaderTabs, id: string, pinned: boolean): HeaderTabs {
	const tab = row.tabs.find(each => each.id === id);
	if (!tab || (tab.pinned === true) === pinned) return row;
	const { pinned: _, ...rest } = tab;
	const changed: HeaderTab = pinned ? { ...rest, pinned: true } : rest;
	const others = row.tabs.filter(each => each.id !== id);
	const at = others.filter(each => each.pinned).length;
	return pinnedFirst(row, [...others.slice(0, at), changed, ...others.slice(at)]);
}

/** `row` with its tabs reordered to `tabs`, the pinned ones kept first and the same tab still on screen, so a tab dragged across the line between them stays on its side. */
export const reorderHeaderTabs = (row: HeaderTabs, tabs: readonly HeaderTab[]): HeaderTabs => pinnedFirst(row, tabs);

const isTab = (tab: unknown): tab is HeaderTab =>
	typeof tab === "object" && tab !== null && "id" in tab && typeof tab.id === "string" && "hash" in tab && typeof tab.hash === "string" && (!("pinned" in tab) || tab.pinned === true);

const EMPTY: HeaderTabs = { tabs: [], active: 0, closed: [] };

export function decodeHeaderTabs(raw: string | null): HeaderTabs {
	try {
		const parsed: unknown = JSON.parse(raw ?? "null");
		if (typeof parsed !== "object" || parsed === null || !("tabs" in parsed) || !Array.isArray(parsed.tabs)) return EMPTY;
		const tabs = parsed.tabs.filter(isTab);
		const active = "active" in parsed && typeof parsed.active === "number" ? parsed.active : 0;
		const closed =
			"closed" in parsed && Array.isArray(parsed.closed)
				? parsed.closed.filter((entry): entry is ClosedHeaderTab => isTab(entry?.tab) && Number.isInteger(entry.index) && entry.index >= 0)
				: [];
		const row = { tabs, active: Math.min(Math.max(active, 0), Math.max(tabs.length - 1, 0)), closed };
		return pinnedFirst(row, tabs);
	} catch {
		return EMPTY;
	}
}

export const encodeHeaderTabs = (row: HeaderTabs): string => JSON.stringify(row);
