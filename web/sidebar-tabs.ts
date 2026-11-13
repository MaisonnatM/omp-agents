/** The sidebar's page list as the user arranged it in Settings › Preferences: the tabs' order, which ones it leaves out, and the keys they take. */
import { useEffect, useMemo } from "react";
import { isObject } from "../src/json";
import { connectionsOf, type IntegrationsAnswer, signedIn } from "../src/shared/accounts";
import type { View } from "../src/shared/sessions";
import { integrationsStore } from "./reads";
import { type Page, SIDEBAR_TABS, type SidebarTab } from "./routing";
import { type Binding, bindingLabel, SHORTCUTS, type ShortcutCategory, type ShortcutHandler, type ShortcutId, shortcutBindings, TAB_SHORTCUTS, type TabShortcut } from "./shortcuts";
import { useStoredState } from "./stored-state";

// A tab's own shortcut, the command the palette lists for it and the row the dialog shows, has the tab's id.
SIDEBAR_TABS satisfies readonly { value: ShortcutId }[];

const KEY = "omp-agents.sidebar-tabs";

/** The Email tab's id before its rename, which a layout stored before it still names. */
const LEGACY_EMAIL_TAB = "inbox";

/** The Notes tab's id, which a layout stored before the Notes page left still names. */
const LEGACY_NOTES_TAB = "notes";

/** The user's sidebar tabs: every tab once, in the order the sidebar's page list shows them, and whether the user hid it. */
export type TabLayout = readonly { tab: SidebarTab; hidden: boolean }[];

export const DEFAULT_TAB_LAYOUT: TabLayout = SIDEBAR_TABS.map(({ value }) => ({ tab: value, hidden: false }));

/** Each tab's row of {@link SIDEBAR_TABS}: its label, icon, and the integration it waits on. */
export const TAB_ROWS = Object.fromEntries(SIDEBAR_TABS.map(row => [row.value, row])) as Record<SidebarTab, (typeof SIDEBAR_TABS)[number]>;

/** Whether a page kind is a sidebar tab's, with a row in {@link TAB_ROWS}. */
export const isSidebarTab = (kind: string): kind is SidebarTab => kind in TAB_ROWS;

/** A row of the sidebar's page list: a tab's page, Settings, or the New session draft. */
export type NavRow = SidebarTab | "settings" | "new";

/**
 * The row of the page list that `page` selects: the panes, the empty home, a page with no row, and a page whose tab is
 * absent, signed out, select none.
 * A page whose tab the user hid in Preferences still selects it, so while its list nests in the sidebar it shows after the last row.
 */
export function navRowOf(page: Page | null, absentTabs: ReadonlySet<SidebarTab>): NavRow | null {
	if (page === null) return null;
	if (page.kind === "new" || page.kind === "settings") return page.kind;
	return isSidebarTab(page.kind) && !absentTabs.has(page.kind) ? page.kind : null;
}

/**
 * The layout stored as `raw`. It keeps each known tab once, so a stored Settings or Notes tab from before they left drops out,
 * and reads a stored {@link LEGACY_EMAIL_TAB} as the Email tab, in its place and hidden as it was.
 * A tab missing from what is stored, such as one added since, takes its default place; anything unreadable gives the default.
 * A layout that still has Todo immediately before {@link LEGACY_NOTES_TAB}, the slot it took in the old tab bar, puts Todo between
 * Calendar and Sport, and moves Email out from between them to just after Sport.
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
		const id = entry.tab === LEGACY_EMAIL_TAB ? "email" : entry.tab;
		const tab = SIDEBAR_TABS.find(({ value }) => value === id)?.value;
		if (tab === undefined || layout.some(kept => kept.tab === tab)) continue;
		layout.push({ tab, hidden: entry.hidden === true });
	}
	for (const [index, { value }] of SIDEBAR_TABS.entries()) {
		if (!layout.some(kept => kept.tab === value)) layout.splice(Math.min(index, layout.length), 0, { tab: value, hidden: false });
	}
	return todoInOldSlot ? todoBetweenCalendarAndSport(layout) : layout;
}

/** `layout`, which held Todo in its old slot, with Todo moved to between Calendar and Sport. Email leaves that gap for just after Sport. */
function todoBetweenCalendarAndSport(layout: { tab: SidebarTab; hidden: boolean }[]): TabLayout {
	const todoAt = layout.findIndex(entry => entry.tab === "todo");
	if (todoAt < 0) return layout;
	const todo = layout[todoAt]!;
	const next = layout.filter((_, index) => index !== todoAt);
	const calendarAt = next.findIndex(entry => entry.tab === "calendar");
	const sportAt = next.findIndex(entry => entry.tab === "sport");
	if (calendarAt < 0 || sportAt < calendarAt) return layout;
	const emailAt = next.findIndex(entry => entry.tab === "email");
	if (emailAt > calendarAt && emailAt < sportAt) {
		const email = next[emailAt]!;
		next.splice(emailAt, 1);
		next.splice(next.findIndex(entry => entry.tab === "sport") + 1, 0, email);
	}
	next.splice(next.findIndex(entry => entry.tab === "sport"), 0, todo);
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

/** The tabs shown, in order: those the user did not hide, less the `absent` ones, whose service omp holds no sign-in to. */
export const shownTabs = (layout: TabLayout, absent: ReadonlySet<SidebarTab>): SidebarTab[] =>
	layout.filter(({ tab, hidden }) => !hidden && !absent.has(tab)).map(({ tab }) => tab);

/** The tabs whose service omp holds no sign-in to, on any of its accounts, which then neither show nor take their shortcuts; all of them until the integrations answer. */
export const tabsSignedOut = (integrations: IntegrationsAnswer["integrations"] | undefined): SidebarTab[] =>
	SIDEBAR_TABS.flatMap(row => (row.integration !== undefined && !(integrations && connectionsOf(integrations[row.integration]).some(signedIn)) ? [row.value] : []));

/** The tabs whose service omp holds no sign-in to, as {@link tabsSignedOut} names them; the same set until one signs in or out, whatever the integrations' polls answer. */
export function useSignedOutTabs(): ReadonlySet<SidebarTab> {
	const names = tabsSignedOut(integrationsStore.usePolling().read?.data.integrations);
	const namesKey = names.join();
	return useMemo((): ReadonlySet<SidebarTab> => new Set(names), [namesKey]);
}

/**
 * The tab layout, kept in this browser, and the tabs it shows; every component that holds it sees a change at once.
 * `signedOut`, the {@link useSignedOutTabs}, stays the same set until one signs in or out; and `shown` stays with it until the layout changes.
 * A stored layout that differs from how it decodes, such as one naming {@link LEGACY_EMAIL_TAB} or {@link LEGACY_NOTES_TAB}, is stored again, so old ids leave this browser and Settings › Sync.
 */
export function useSidebarTabs(): {
	layout: TabLayout;
	setLayout: (next: TabLayout | ((prev: TabLayout) => TabLayout)) => void;
	/** The tabs that neither show nor take their shortcuts, whose service omp holds no sign-in to. */
	signedOut: ReadonlySet<SidebarTab>;
	shown: readonly SidebarTab[];
} {
	const [layout, setLayout] = useStoredState(KEY, decodeTabLayout, encodeTabLayout);
	useEffect(() => {
		const raw = localStorage.getItem(KEY);
		if (raw !== null && raw !== encodeTabLayout(layout)) setLayout(layout);
	}, [layout, setLayout]);
	const signedOut = useSignedOutTabs();
	const shown = useMemo(() => shownTabs(layout, signedOut), [layout, signedOut]);
	return { layout, setLayout, signedOut, shown };
}

/** The position key `id` takes while the sidebar shows `shown`: Cmd+1 for the first tab; none for a tab not shown or a shortcut that is no tab. */
export function positionKey(id: ShortcutId, shown: readonly SidebarTab[]): TabShortcut | undefined {
	const ids: readonly ShortcutId[] = shown;
	return TAB_SHORTCUTS[ids.indexOf(id)];
}

/** The keys that run `id` while the sidebar shows `shown`: its {@link positionKey}, if any, then its own keys. */
function tabBindings(id: ShortcutId, shown: readonly SidebarTab[]): readonly Binding[] {
	const position = positionKey(id, shown);
	return position === undefined ? shortcutBindings(id) : [...shortcutBindings(position), ...shortcutBindings(id)];
}

/** {@link tabBindings} as a tooltip's chips draw them: `["⌘5", "G then M"]`. */
export const tabShortcutLabels = (id: ShortcutId, shown: readonly SidebarTab[]): readonly string[] => tabBindings(id, shown).map(bindingLabel);

const positions: readonly ShortcutId[] = TAB_SHORTCUTS;

/** One row of Settings › Keyboard: the shortcut, the category that lists it, what it does, and the keys that run it. */
export interface ShortcutRow {
	id: ShortcutId;
	category: ShortcutCategory;
	label: string;
	keys: readonly Binding[];
}

/**
 * Every shortcut's row of Settings › Keyboard while the sidebar shows `shown`, in {@link SHORTCUTS} order: each tab's
 * row carries the position key it takes, so the position keys have no rows of their own, and a row left with no key is out.
 */
export const shortcutRows = (shown: readonly SidebarTab[]): ShortcutRow[] =>
	SHORTCUTS.flatMap(({ id, category, label }) => {
		const keys = positions.includes(id) ? [] : tabBindings(id, shown);
		return keys.length > 0 ? [{ id, category, label, keys }] : [];
	});

/** A handler for each position key: it runs `goTo`'s handler for the tab at that place in `shown()`, as that tab's first key does, and declines past the last tab. */
export const positionHandlers = (shown: () => readonly SidebarTab[], goTo: Record<SidebarTab, ShortcutHandler>): Record<TabShortcut, ShortcutHandler> =>
	Object.fromEntries(
		TAB_SHORTCUTS.map((id, index): [TabShortcut, ShortcutHandler] => [
			id,
			() => {
				const tab: SidebarTab | undefined = shown()[index];
				return tab === undefined ? false : goTo[tab](0);
			},
		]),
	) as Record<TabShortcut, ShortcutHandler>;
