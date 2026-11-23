/** The sidebar's page list as the user arranged it in Settings › Preferences: the tabs' order, and which ones it leaves out. */
import { useEffect, useMemo } from "react";
import { isObject } from "../src/json";
import { useModulesOff } from "./modules-off";
import { type Page, SIDEBAR_TABS, type SidebarTab } from "./routing";
import type { ShortcutId } from "./shortcuts";
import { useStoredState } from "./stored-state";

// A tab's own shortcut, the command the palette lists for it and the row the dialog shows, has the tab's id.
SIDEBAR_TABS satisfies readonly { value: ShortcutId }[];

const KEY = "omp-agents.sidebar-tabs";

/** The Notes tab's id, which a layout stored before the Notes page left still names. */
const LEGACY_NOTES_TAB = "notes";

/** The user's sidebar tabs: every tab once, in the order the sidebar's page list shows them, and whether the user hid it. */
export type TabLayout = readonly { tab: SidebarTab; hidden: boolean }[];

export const DEFAULT_TAB_LAYOUT: TabLayout = SIDEBAR_TABS.map(({ value }) => ({ tab: value, hidden: false }));

/** Each tab's row of {@link SIDEBAR_TABS}: its label and icon. */
export const TAB_ROWS = Object.fromEntries(SIDEBAR_TABS.map(row => [row.value, row])) as Record<SidebarTab, (typeof SIDEBAR_TABS)[number]>;

/** Whether a page kind is a sidebar tab's, with a row in {@link TAB_ROWS}. */
export const isSidebarTab = (kind: string): kind is SidebarTab => kind in TAB_ROWS;

/** A row of the sidebar's page list: a tab's page, Notifications, Settings, or the New session draft. */
export type NavRow = SidebarTab | "notifications" | "settings" | "new";

/**
 * The row of the page list that `page` selects: the panes, the empty home, a page with no row, and a page whose tab is
 * absent, its module turned off, select none.
 * A page whose tab the user hid in Preferences still selects it, so while its list nests in the sidebar it shows after the last row.
 */
export function navRowOf(page: Page | null, absentTabs: ReadonlySet<SidebarTab>): NavRow | null {
	if (page === null) return null;
	if (page.kind === "new" || page.kind === "notifications" || page.kind === "settings") return page.kind;
	return isSidebarTab(page.kind) && !absentTabs.has(page.kind) ? page.kind : null;
}

/**
 * The layout stored as `raw`. It keeps each known tab once, so a stored tab of a page that left, such as Settings, Notes, Calendar, or Email, drops out.
 * A tab missing from what is stored, such as one added since, takes its default place; anything unreadable gives the default.
 * A layout that still has Todo immediately before {@link LEGACY_NOTES_TAB}, the slot it took in the old tab bar, puts Todo just before Sport.
 */
export function decodeTabLayout(raw: string | null): TabLayout {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return DEFAULT_TAB_LAYOUT;
	}
	if (!Array.isArray(stored)) return DEFAULT_TAB_LAYOUT;
	const ids = stored.map(entry => (isObject(entry) ? entry.tab : undefined)).filter(id => id === LEGACY_NOTES_TAB || SIDEBAR_TABS.some(({ value }) => value === id));
	const todoInOldSlot = ids.some((id, index) => id === "todo" && ids[index + 1] === LEGACY_NOTES_TAB);
	const layout: { tab: SidebarTab; hidden: boolean }[] = [];
	for (const entry of stored as unknown[]) {
		if (!isObject(entry)) continue;
		const tab = SIDEBAR_TABS.find(({ value }) => value === entry.tab)?.value;
		if (tab === undefined || layout.some(kept => kept.tab === tab)) continue;
		layout.push({ tab, hidden: entry.hidden === true });
	}
	for (const [index, { value }] of SIDEBAR_TABS.entries()) {
		if (!layout.some(kept => kept.tab === value)) layout.splice(Math.min(index, layout.length), 0, { tab: value, hidden: false });
	}
	return todoInOldSlot ? todoBeforeSport(layout) : layout;
}

/** `layout`, which held Todo in its old slot, with Todo moved to just before Sport. */
function todoBeforeSport(layout: { tab: SidebarTab; hidden: boolean }[]): TabLayout {
	const todoAt = layout.findIndex(entry => entry.tab === "todo");
	if (todoAt < 0) return layout;
	const todo = layout[todoAt]!;
	const next = layout.filter((_, index) => index !== todoAt);
	const sportAt = next.findIndex(entry => entry.tab === "sport");
	if (sportAt < 0) return layout;
	next.splice(sportAt, 0, todo);
	return next;
}

export const encodeTabLayout = (layout: TabLayout): string => JSON.stringify(layout);

/** `layout` with `tab` moved one place earlier or later; at either end it stays. */
export function moveTab(layout: TabLayout, tab: SidebarTab, by: -1 | 1): TabLayout {
	const from = layout.findIndex(entry => entry.tab === tab);
	const to = from + by;
	if (from === -1 || to < 0 || to >= layout.length) return layout;
	const next = [...layout];
	[next[from], next[to]] = [next[to]!, next[from]!];
	return next;
}

/** `layout` with `tab` hidden or shown. */
export const hideTab = (layout: TabLayout, tab: SidebarTab, hidden: boolean): TabLayout => layout.map(entry => (entry.tab === tab ? { tab, hidden } : entry));

/**
 * The tabs with no row in the page list or in Settings › Preferences: the sidebar's own Projects section, just below the list, already lists the projects
 * and starts a new one, and the sidebar's Sessions | Board switch opens the Board.
 */
export const ROWLESS_TABS: ReadonlySet<SidebarTab> = new Set<SidebarTab>(["projects", "board"]);

/** The tabs shown, in order: those the user did not hide, less the `absent` ones, whose module is turned off, and the {@link ROWLESS_TABS}. */
export const shownTabs = (layout: TabLayout, absent: ReadonlySet<SidebarTab>): SidebarTab[] =>
	layout.filter(({ tab, hidden }) => !hidden && !absent.has(tab) && !ROWLESS_TABS.has(tab)).map(({ tab }) => tab);

/**
 * The tab layout, kept in this browser, and the tabs it shows; every component that holds it sees a change at once.
 * `absent` stays the same set until a module turns on or off, and `shown` with it until the layout changes.
 * A stored layout that differs from how it decodes, such as one naming a tab that left or {@link LEGACY_NOTES_TAB}, is stored again, so old ids leave this browser and Settings › Sync.
 */
export function useSidebarTabs(): {
	layout: TabLayout;
	setLayout: (next: TabLayout | ((prev: TabLayout) => TabLayout)) => void;
	/** The tabs that neither show nor take their shortcuts: those of the modules turned off. */
	absent: ReadonlySet<SidebarTab>;
	shown: readonly SidebarTab[];
} {
	const [layout, setLayout] = useStoredState(KEY, decodeTabLayout, encodeTabLayout);
	useEffect(() => {
		const raw = localStorage.getItem(KEY);
		if (raw !== null && raw !== encodeTabLayout(layout)) setLayout(layout);
	}, [layout, setLayout]);
	const [absent] = useModulesOff();
	const shown = useMemo(() => shownTabs(layout, absent), [layout, absent]);
	return { layout, setLayout, absent, shown };
}
