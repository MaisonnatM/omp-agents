/** The header tabs' model: one tab per page or focused session you opened, kept in this browser in the order you dragged them. */
import { focusedView, hashForView, routeFromHash } from "./routing";

/** One header tab: `key` names what it shows, one per page kind or per focused session; `hash` is where you last saw it, and `at` when. */
export interface HeaderTab {
	key: string;
	hash: string;
	at: number;
}

export const HEADER_TABS_KEY = "omp-agents.header-tabs";

/** The most tabs the header keeps; opening one more drops the one seen longest ago. */
export const MAX_HEADER_TABS = 8;

/** The tab `hash` belongs to; `null` for `#session/<id>`, which the dashboard replaces with the panes it opens. */
export function headerTabKey(hash: string): string | null {
	const route = routeFromHash(hash);
	switch (route.kind) {
		case "page":
			return `page:${route.page.kind}`;
		case "session":
			return null;
		case "panes": {
			const view = focusedView(route.layout);
			return view ? `view:${hashForView(view)}` : "home";
		}
		default: {
			const never: never = route;
			return never;
		}
	}
}

/** `tabs` with the one `hash` names brought up to date at `now`, or added at the end; past {@link MAX_HEADER_TABS}, the one seen longest ago goes. */
export function visitHeaderTab(tabs: readonly HeaderTab[], hash: string, now: number): readonly HeaderTab[] {
	const key = headerTabKey(hash);
	if (key === null) return tabs;
	const known = tabs.find(tab => tab.key === key);
	const seen = { key, hash, at: now };
	const next = known ? tabs.map(tab => (tab === known ? seen : tab)) : [...tabs, seen];
	if (next.length <= MAX_HEADER_TABS) return next;
	const oldest = next.reduce((a, b) => (b.at < a.at ? b : a));
	return next.filter(tab => tab !== oldest);
}

/** `tabs` with the tab keyed `from` moved to where the tab keyed `to` is. */
export function moveHeaderTab(tabs: readonly HeaderTab[], from: string, to: string): readonly HeaderTab[] {
	const moved = tabs.find(tab => tab.key === from);
	const target = tabs.findIndex(tab => tab.key === to);
	if (!moved || target < 0 || from === to) return tabs;
	const rest = tabs.filter(tab => tab !== moved);
	return [...rest.slice(0, target), moved, ...rest.slice(target)];
}

/** `tabs` without the tab keyed `key`, and where to go when it was the one on screen, `activeKey`: the tab now in its place, else the one before it, else the home. `null` stays put. */
export function closeHeaderTab(tabs: readonly HeaderTab[], key: string, activeKey: string | null): { tabs: readonly HeaderTab[]; go: string | null } {
	const index = tabs.findIndex(tab => tab.key === key);
	const rest = tabs.filter(tab => tab.key !== key);
	if (key !== activeKey) return { tabs: rest, go: null };
	return { tabs: rest, go: rest[Math.min(index, rest.length - 1)]?.hash ?? "" };
}

export function decodeHeaderTabs(raw: string | null): readonly HeaderTab[] {
	try {
		const parsed: unknown = JSON.parse(raw ?? "[]");
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((tab): tab is HeaderTab => typeof tab?.key === "string" && typeof tab.hash === "string" && typeof tab.at === "number").slice(0, MAX_HEADER_TABS);
	} catch {
		return [];
	}
}

export const encodeHeaderTabs = (tabs: readonly HeaderTab[]): string => JSON.stringify(tabs);
