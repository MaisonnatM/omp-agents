/** The header tabs' model, after Capy's desktop tabs: the tab on screen follows where you go, keeping its own Back and Forward, a session already open in another tab is focused there, only a new-tab request adds one, pinned tabs sit first and stay open, and a closed tab can come back where it was. */
import type { View } from "../src/shared/sessions";
import { focusedView, hashForView, type Page, routeFromHash } from "./routing";

/**
 * One header tab: `id` stays while you move from page to page in it; `hash` is what it shows now; a `pinned` one sits before the others and has no ×.
 * `back` and `forward` are the tab's own history, as a browser tab keeps one, each with its nearest entry last.
 */
export interface HeaderTab {
	id: string;
	hash: string;
	back: readonly string[];
	forward: readonly string[];
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

/** How many entries a tab's Back keeps, Chromium's limit for a tab, so the stored row stays small. */
export const TAB_HISTORY_LIMIT = 50;

const freshTab = (id: string, hash: string): HeaderTab => ({ id, hash, back: [], forward: [] });

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

/** The session `hash` focuses, the one thing going somewhere never opens in a second tab; `null` for a page or the home. */
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
 * How the dashboard went somewhere: `push` adds an entry to the tab's history and `replace` changes the one on screen, as the window's history
 * took the move, such as a page that picks what it opens or a move of the focus between panes; `new-tab` opens it in a new tab, as + does.
 */
export type HeaderTabVisit = "push" | "replace" | "new-tab";

/**
 * The row once the dashboard went to `to`: what the tab on screen shows stays, a session another tab shows focuses that tab, a new tab or an empty row
 * adds a tab `newId` at the end, and anything else shows in the tab on screen, a push leaving what it showed for Back and dropping its Forward, as a browser does.
 * The same object when nothing changes, so a render stores only a change. A session the tab on screen shows stays in it, since a duplicated tab shows it twice.
 */
export function visitHeaderTab(row: HeaderTabs, to: string, visit: HeaderTabVisit, newId: string): HeaderTabs {
	if (headerTabTarget(to) === null) return row;
	const newTab = visit === "new-tab";
	const current = row.tabs[row.active];
	if (!newTab && current?.hash === to) return row;
	const session = sessionOf(to);
	const showing = session === null ? -1 : current && sessionOf(current.hash) === session ? row.active : row.tabs.findIndex(tab => sessionOf(tab.hash) === session);
	if (showing !== -1 && (newTab || showing !== row.active)) return { ...row, tabs: row.tabs.map((tab, index) => (index === showing ? { ...tab, hash: to } : tab)), active: showing };
	if (newTab || !current) return { ...row, tabs: [...row.tabs, freshTab(newId, to)], active: row.tabs.length };
	const went: HeaderTab = visit === "replace" ? { ...current, hash: to } : { ...current, hash: to, back: [...current.back, current.hash].slice(-TAB_HISTORY_LIMIT), forward: [] };
	return { ...row, tabs: row.tabs.map((tab, index) => (index === row.active ? went : tab)) };
}

/** The row with the tab on screen one step `by` through its own history, and the hash to show; `null` when its history ends there. */
export function stepHeaderTab(row: HeaderTabs, by: -1 | 1): { row: HeaderTabs; go: string } | null {
	const tab = row.tabs[row.active];
	const from = by === -1 ? tab?.back : tab?.forward;
	const to = from?.at(-1);
	if (tab === undefined || from === undefined || to === undefined) return null;
	const rest = from.slice(0, -1);
	const stepped: HeaderTab = by === -1 ? { ...tab, hash: to, back: rest, forward: [...tab.forward, tab.hash] } : { ...tab, hash: to, back: [...tab.back, tab.hash], forward: rest };
	return { row: { ...row, tabs: row.tabs.map((each, index) => (index === row.active ? stepped : each)) }, go: to };
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
	if (tabs.length === 0) return { row: { tabs: [freshTab(newId, NEW_TAB_HASH)], active: 0, closed }, go: NEW_TAB_HASH };
	if (index !== row.active) return { row: { tabs, active: row.active > index ? row.active - 1 : row.active, closed }, go: null };
	const active = Math.min(index, tabs.length - 1);
	return { row: { tabs, active, closed }, go: tabs[active]?.hash ?? null };
}

/** The row with only the tabs `keep` holds and tab `focus` on screen, and where to go when it was not; `null` when that closes nothing. Reopen closed tab brings the others back from the left. */
function closeAllBut(row: HeaderTabs, keep: (tab: HeaderTab, index: number) => boolean, focus: string): { row: HeaderTabs; go: string | null } | null {
	const gone = row.tabs.flatMap((tab, index) => (keep(tab, index) ? [] : [{ tab, index }]));
	const tabs = row.tabs.filter(keep);
	const active = tabs.findIndex(tab => tab.id === focus);
	if (gone.length === 0 || active === -1) return null;
	return { row: { tabs, active, closed: remember(row.closed, gone.toReversed()) }, go: row.tabs[row.active]?.id === focus ? null : (tabs[active]?.hash ?? null) };
}

/** The row with only the pinned tabs and tab `id`, which goes on screen. */
export const closeOtherHeaderTabs = (row: HeaderTabs, id: string): { row: HeaderTabs; go: string | null } | null =>
	closeAllBut(row, tab => tab.pinned === true || tab.id === id, id);

/** The row without the unpinned tabs after tab `id`; when the one on screen goes, tab `id` takes its place on screen. */
export function closeRightHeaderTabs(row: HeaderTabs, id: string): { row: HeaderTabs; go: string | null } | null {
	const at = row.tabs.findIndex(tab => tab.id === id);
	const keep = (tab: HeaderTab, index: number): boolean => tab.pinned === true || index <= at;
	const current = row.tabs[row.active];
	return at === -1 ? null : closeAllBut(row, keep, current && keep(current, row.active) ? current.id : id);
}

/**
 * The row with a copy `newId` of tab `id` on screen, right after it, or first of the unpinned tabs when it is pinned, as Capy's Duplicate tab does; `go` is what it shows.
 * The copy is never pinned, and a session then shows in both tabs.
 */
export function duplicateHeaderTab(row: HeaderTabs, id: string, newId: string): { row: HeaderTabs; go: string } | null {
	const index = row.tabs.findIndex(tab => tab.id === id);
	const tab = row.tabs[index];
	if (!tab) return null;
	const { pinned, ...rest } = tab;
	const at = pinned ? row.tabs.filter(each => each.pinned).length : index + 1;
	return { row: { ...row, tabs: [...row.tabs.slice(0, at), { ...rest, id: newId }, ...row.tabs.slice(at)], active: at }, go: tab.hash };
}

/**
 * The row with the last closed tab back at its place, among the pinned tabs if it was pinned and after them if not, and on screen with its own Back and Forward; `go` is what it shows.
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

const isHashes = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === "string");

/** A stored tab, with an empty history for one stored before tabs kept theirs; `null` for anything else. */
function decodeTab(value: unknown): HeaderTab | null {
	if (typeof value !== "object" || value === null || !("id" in value) || !("hash" in value) || typeof value.id !== "string" || typeof value.hash !== "string") return null;
	if ("pinned" in value && value.pinned !== true) return null;
	const back = "back" in value && isHashes(value.back) ? value.back.slice(-TAB_HISTORY_LIMIT) : [];
	const forward = "forward" in value && isHashes(value.forward) ? value.forward.slice(-TAB_HISTORY_LIMIT) : [];
	return { id: value.id, hash: value.hash, back, forward, ...("pinned" in value && { pinned: true }) };
}

/** A stored closed tab with its place; `null` for anything else. */
function decodeClosed(value: unknown): ClosedHeaderTab | null {
	if (typeof value !== "object" || value === null || !("tab" in value) || !("index" in value)) return null;
	const tab = decodeTab(value.tab);
	return tab && typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0 ? { tab, index: value.index } : null;
}

const EMPTY: HeaderTabs = { tabs: [], active: 0, closed: [] };

export function decodeHeaderTabs(raw: string | null): HeaderTabs {
	try {
		const parsed: unknown = JSON.parse(raw ?? "null");
		if (typeof parsed !== "object" || parsed === null || !("tabs" in parsed) || !Array.isArray(parsed.tabs)) return EMPTY;
		const tabs = parsed.tabs.flatMap((value: unknown) => decodeTab(value) ?? []);
		const active = "active" in parsed && typeof parsed.active === "number" ? parsed.active : 0;
		const closed = "closed" in parsed && Array.isArray(parsed.closed) ? parsed.closed.flatMap((value: unknown) => decodeClosed(value) ?? []).slice(-CLOSED_TABS_KEPT) : [];
		const row = { tabs, active: Math.min(Math.max(active, 0), Math.max(tabs.length - 1, 0)), closed };
		return pinnedFirst(row, tabs);
	} catch {
		return EMPTY;
	}
}

export const encodeHeaderTabs = (row: HeaderTabs): string => JSON.stringify(row);
