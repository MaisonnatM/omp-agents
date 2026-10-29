/** The sidebar's tab bar as the user arranged it in Settings › Preferences: the tabs' order, which ones it leaves out, and the keys they take. */
import { useEffect, useMemo } from "react";
import { isObject } from "../src/json";
import { connectionsOf, type IntegrationsAnswer, signedIn } from "../src/shared/accounts";
import { integrationsStore } from "./reads";
import { SIDEBAR_TABS, type SidebarPanel, type SidebarTab, type TabPlace } from "./routing";
import { type Binding, bindingLabel, SHORTCUTS, type ShortcutCategory, type ShortcutHandler, type ShortcutId, shortcutBindings, TAB_SHORTCUTS, type TabShortcut } from "./shortcuts";
import { useStoredState } from "./stored-state";

// A tab's own shortcut, the command the palette lists for it and the row the dialog shows, has the tab's id.
SIDEBAR_TABS satisfies readonly { value: ShortcutId }[];

const KEY = "omp-agents.sidebar-tabs";

/** The Email tab's id before its rename, which a layout stored before it still names; this goes when the new Inbox tab takes the id. */
const LEGACY_EMAIL_TAB = "inbox";

/** The user's sidebar tabs: every tab once, in the order the bar and the header show them, and whether the user hid it. */
export type TabLayout = readonly { tab: SidebarTab; hidden: boolean }[];

export const DEFAULT_TAB_LAYOUT: TabLayout = SIDEBAR_TABS.map(({ value }) => ({ tab: value, hidden: false }));

/** Each tab's row of {@link SIDEBAR_TABS}: its label, icon, place, and the integration it waits on. */
export const TAB_ROWS = Object.fromEntries(SIDEBAR_TABS.map(row => [row.value, row])) as Record<SidebarTab, (typeof SIDEBAR_TABS)[number]>;

/**
 * The layout stored as `raw`. It keeps each known tab once, so a stored Settings tab from before the header's button drops out,
 * and reads a stored {@link LEGACY_EMAIL_TAB} as the Email tab, in its place and hidden as it was.
 * A tab missing from what is stored, such as one added since, takes its default place; anything unreadable gives the default.
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
	return layout;
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

/** The tabs shown, in order: those the user did not hide, less those whose service omp holds no sign-in to. */
export const shownTabs = (layout: TabLayout, signedOut: ReadonlySet<SidebarTab>): SidebarTab[] =>
	layout.filter(({ tab, hidden }) => !hidden && !signedOut.has(tab)).map(({ tab }) => tab);

/** The tabs of `shown` whose triggers sit at `place`, in their order. */
export const placedTabs = (shown: readonly SidebarTab[], place: TabPlace): SidebarTab[] => shown.filter(tab => TAB_ROWS[tab].place === place);

/** Whether `panel` belongs to the tab bar, which the sidebar draws above it; Settings and the header's tabs show their panel alone. */
export const panelOnBar = (panel: SidebarPanel): boolean => panel !== "settings" && TAB_ROWS[panel].place === "bar";

/** The tabs whose service omp holds no sign-in to, on any of its accounts, which then neither show nor take their shortcuts; all of them until the integrations answer. */
export const tabsSignedOut = (integrations: IntegrationsAnswer["integrations"] | undefined): SidebarTab[] =>
	SIDEBAR_TABS.flatMap(row => ("integration" in row && !(integrations && connectionsOf(integrations[row.integration]).some(signedIn)) ? [row.value] : []));

/**
 * The tab layout, kept in this browser, and the tabs it shows; every component that holds it sees a change at once.
 * `signedOut` stays the same set until a tab's service signs in or out, whatever the integrations' polls answer, and
 * `shown` stays with it until the layout changes. A stored layout that still names {@link LEGACY_EMAIL_TAB} is stored
 * again as it decodes, so the old id leaves this browser and Settings › Sync before the new Inbox tab takes it.
 */
export function useSidebarTabs(): {
	layout: TabLayout;
	setLayout: (next: TabLayout | ((prev: TabLayout) => TabLayout)) => void;
	signedOut: ReadonlySet<SidebarTab>;
	shown: readonly SidebarTab[];
} {
	const [layout, setLayout] = useStoredState(KEY, decodeTabLayout, encodeTabLayout);
	useEffect(() => {
		if (localStorage.getItem(KEY)?.includes(`"tab":"${LEGACY_EMAIL_TAB}"`)) setLayout(layout);
	}, [layout, setLayout]);
	const names = tabsSignedOut(integrationsStore.usePolling().read?.data.integrations);
	const namesKey = names.join();
	const signedOut = useMemo((): ReadonlySet<SidebarTab> => new Set(names), [namesKey]);
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
