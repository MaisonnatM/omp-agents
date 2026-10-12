/** The sidebar's tab bar as the user arranged it in Settings › Preferences: the tabs' order, and which ones it leaves out. */
import { isObject } from "../src/json";
import { type IntegrationsAnswer, signedIn } from "../src/shared/accounts";
import { SIDEBAR_TABS, type SidebarTab } from "./routing";
import { TAB_SHORTCUTS } from "./shortcuts";
import { useStoredState } from "./stored-state";

// Every tab the bar shows takes a position key, so a tab added to `SIDEBAR_TABS` needs one more `TAB_SHORTCUTS` entry.
TAB_SHORTCUTS.length satisfies (typeof SIDEBAR_TABS)["length"];

const KEY = "omp-agents.sidebar-tabs";

/** The user's sidebar tabs: every tab once, in the order the bar shows them, and whether the user hid it. */
export type TabLayout = readonly { tab: SidebarTab; hidden: boolean }[];

export const DEFAULT_TAB_LAYOUT: TabLayout = SIDEBAR_TABS.map(({ value }) => ({ tab: value, hidden: false }));

/** Each tab's row of {@link SIDEBAR_TABS}: its label, icon, and the integration it waits on. */
export const TAB_ROWS = Object.fromEntries(SIDEBAR_TABS.map(row => [row.value, row])) as Record<SidebarTab, (typeof SIDEBAR_TABS)[number]>;

/**
 * The layout stored as `raw`. It keeps each known tab once and never hides Settings, which leads back to the others.
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
		const tab = SIDEBAR_TABS.find(({ value }) => value === entry.tab)?.value;
		if (tab === undefined || layout.some(kept => kept.tab === tab)) continue;
		layout.push({ tab, hidden: tab !== "settings" && entry.hidden === true });
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

/** `layout` with `tab` hidden or shown; Settings always shows. */
export function hideTab(layout: TabLayout, tab: SidebarTab, hidden: boolean): TabLayout {
	if (tab === "settings") return layout;
	return layout.map(entry => (entry.tab === tab ? { tab, hidden } : entry));
}

/** The tabs the bar shows, in order: those the user did not hide, less those whose service omp holds no sign-in to. */
export const shownTabs = (layout: TabLayout, signedOut: ReadonlySet<SidebarTab>): SidebarTab[] =>
	layout.filter(({ tab, hidden }) => !hidden && !signedOut.has(tab)).map(({ tab }) => tab);

/** The tabs whose service omp holds no sign-in to, which then neither show nor take their shortcuts; all of them until the integrations answer. */
export const signedOutTabs = (integrations: IntegrationsAnswer["integrations"] | undefined): SidebarTab[] =>
	SIDEBAR_TABS.flatMap(row => ("integration" in row && !(integrations && signedIn(integrations[row.integration].connection)) ? [row.value] : []));

/** The tab layout, kept in this browser; every component that holds it sees a change at once. */
export const useTabLayout = () => useStoredState(KEY, decodeTabLayout, encodeTabLayout);
