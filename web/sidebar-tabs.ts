/** The sidebar's page list as the user arranged it in Settings › Preferences: the tabs' order, which ones it leaves out, and the keys they take. */
import { useEffect, useMemo } from "react";
import { isObject } from "../src/json";
import { connectionsOf, type IntegrationsAnswer, signedIn } from "../src/shared/accounts";
import type { View } from "../src/shared/sessions";
import type { Space } from "../src/shared/workspaces";
import { integrationsStore } from "./reads";
import { type Page, SIDEBAR_TABS, type SidebarTab } from "./routing";
import { type Binding, bindingLabel, SHORTCUTS, type ShortcutCategory, type ShortcutHandler, type ShortcutId, shortcutBindings, TAB_SHORTCUTS, type TabShortcut } from "./shortcuts";
import { useStoredState } from "./stored-state";

// A tab's own shortcut, the command the palette lists for it and the row the dialog shows, has the tab's id.
SIDEBAR_TABS satisfies readonly { value: ShortcutId }[];

const KEY = "omp-agents.sidebar-tabs";

/** The Email tab's id before its rename, which a layout stored before it still names. */
const LEGACY_EMAIL_TAB = "inbox";

/** The user's sidebar tabs: every tab once, in the order the sidebar's page list shows them, and whether the user hid it. */
export type TabLayout = readonly { tab: SidebarTab; hidden: boolean }[];

export const DEFAULT_TAB_LAYOUT: TabLayout = SIDEBAR_TABS.map(({ value }) => ({ tab: value, hidden: false }));

/** Each tab's row of {@link SIDEBAR_TABS}: its label, icon, the integration it waits on, and the space it shows in alone. */
export const TAB_ROWS = Object.fromEntries(SIDEBAR_TABS.map(row => [row.value, row])) as Record<SidebarTab, (typeof SIDEBAR_TABS)[number]>;

/** The space tab `tab` shows in alone, Work for Tickets and Personal for Sport; `null` for a tab of both. */
export function tabSpace(tab: SidebarTab): Space | null {
	const row = TAB_ROWS[tab];
	return "space" in row ? row.space : null;
}

/** Whether a page kind is a sidebar tab's, with a row in {@link TAB_ROWS}. */
export const isSidebarTab = (kind: string): kind is SidebarTab => kind in TAB_ROWS;

/** The space page `page` shows in alone, its tab's {@link tabSpace}: Work for Tickets, Personal for Sport; `null` for a page of both. */
export const pageSpace = (page: Page): Space | null => (isSidebarTab(page.kind) ? tabSpace(page.kind) : null);

/** A row of the sidebar's page list: a tab's page, Settings, or the New session draft. */
export type NavRow = SidebarTab | "settings" | "new";

/**
 * The row of the page list that `page` selects, which holds the page's own list: the panes select Sessions, and the
 * empty home, a page with no row, and a page whose tab is absent, signed out or of the other space, select none.
 * A page whose tab the user hid in Preferences still selects it, so its list shows after the last row.
 */
export function navRowOf(page: Page | null, panes: readonly View[], absentTabs: ReadonlySet<SidebarTab>): NavRow | null {
	if (page === null) return panes.length > 0 ? "sessions" : null;
	if (page.kind === "new" || page.kind === "settings") return page.kind;
	return isSidebarTab(page.kind) && !absentTabs.has(page.kind) ? page.kind : null;
}

/**
 * The layout stored as `raw`. It keeps each known tab once, so a stored Settings tab from before the header's button drops out,
 * and reads a stored {@link LEGACY_EMAIL_TAB} as the Email tab, in its place and hidden as it was.
 * A tab missing from what is stored, such as one added since, takes its default place; anything unreadable gives the default.
 * A layout that still has Todo immediately before Notes, the slot it took in the old tab bar, puts Todo between Calendar and Sport,
 * and moves Email out from between them to just after Sport. Putting Todo back immediately before Notes moves it again.
 */
export function decodeTabLayout(raw: string | null): TabLayout {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return DEFAULT_TAB_LAYOUT;
	}
	if (!Array.isArray(stored)) return DEFAULT_TAB_LAYOUT;
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
	return todoBetweenCalendarAndSport(layout);
}

/** `layout` with Todo moved from immediately before Notes to between Calendar and Sport. Email leaves that gap for just after Sport. */
function todoBetweenCalendarAndSport(layout: { tab: SidebarTab; hidden: boolean }[]): TabLayout {
	const todoAt = layout.findIndex(entry => entry.tab === "todo");
	const notesAt = layout.findIndex(entry => entry.tab === "notes");
	if (todoAt < 0 || notesAt !== todoAt + 1) return layout;
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

/** The tabs shown, in order: those the user did not hide, less the `absent` ones, whose service omp holds no sign-in to or that belong to the other space. */
export const shownTabs = (layout: TabLayout, absent: ReadonlySet<SidebarTab>): SidebarTab[] =>
	layout.filter(({ tab, hidden }) => !hidden && !absent.has(tab)).map(({ tab }) => tab);

/** The tabs whose service omp holds no sign-in to, on any of its accounts, which then neither show nor take their shortcuts; all of them until the integrations answer. */
export const tabsSignedOut = (integrations: IntegrationsAnswer["integrations"] | undefined): SidebarTab[] =>
	SIDEBAR_TABS.flatMap(row => ("integration" in row && !(integrations && connectionsOf(integrations[row.integration]).some(signedIn)) ? [row.value] : []));

/** The tabs of the space other than `space`, which then neither show nor take their shortcuts. */
export const tabsOutOfSpace = (space: Space): SidebarTab[] => SIDEBAR_TABS.flatMap(row => ("space" in row && row.space !== space ? [row.value] : []));

/** The tabs whose service omp holds no sign-in to, as {@link tabsSignedOut} names them; the same set until one signs in or out, whatever the integrations' polls answer. */
export function useSignedOutTabs(): ReadonlySet<SidebarTab> {
	const names = tabsSignedOut(integrationsStore.usePolling().read?.data.integrations);
	const namesKey = names.join();
	return useMemo((): ReadonlySet<SidebarTab> => new Set(names), [namesKey]);
}

/**
 * The tab layout, kept in this browser, and the tabs it shows in `space`; every component that holds it sees a change at once.
 * `absent`, the {@link useSignedOutTabs} and the other space's tabs, stays the same set until one of those changes; and `shown` stays with them until the layout changes.
 * A stored layout that still names {@link LEGACY_EMAIL_TAB} is stored again as it decodes, so the old id leaves this browser and Settings › Sync.
 */
export function useSidebarTabs(space: Space): {
	layout: TabLayout;
	setLayout: (next: TabLayout | ((prev: TabLayout) => TabLayout)) => void;
	signedOut: ReadonlySet<SidebarTab>;
	/** The tabs that neither show nor take their shortcuts: those signed out, and those of the other space. */
	absent: ReadonlySet<SidebarTab>;
	shown: readonly SidebarTab[];
} {
	const [layout, setLayout] = useStoredState(KEY, decodeTabLayout, encodeTabLayout);
	useEffect(() => {
		const raw = localStorage.getItem(KEY);
		let legacyTodo = false;
		if (raw !== null) {
			try {
				const stored: unknown = JSON.parse(raw);
				if (Array.isArray(stored)) {
					const tabs = stored.flatMap(entry => (isObject(entry) && typeof entry.tab === "string" ? [entry.tab] : []));
					const todoAt = tabs.indexOf("todo");
					legacyTodo = todoAt >= 0 && tabs[todoAt + 1] === "notes";
				}
			} catch {
				legacyTodo = false;
			}
		}
		if ((raw !== null && raw.includes(`"tab":"${LEGACY_EMAIL_TAB}"`)) || legacyTodo) setLayout(layout);
	}, [layout, setLayout]);
	const signedOut = useSignedOutTabs();
	const absent = useMemo((): ReadonlySet<SidebarTab> => new Set([...signedOut, ...tabsOutOfSpace(space)]), [signedOut, space]);
	const shown = useMemo(() => shownTabs(layout, absent), [layout, absent]);
	return { layout, setLayout, signedOut, absent, shown };
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

/** One row of the reference dialog: the shortcut, the dialog tab that lists it, what it does, and the keys that run it. */
export interface ShortcutRow {
	id: ShortcutId;
	category: ShortcutCategory;
	label: string;
	keys: readonly Binding[];
}

/**
 * Every shortcut's row of the reference dialog while the sidebar shows `shown`, in {@link SHORTCUTS} order: each tab's
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
