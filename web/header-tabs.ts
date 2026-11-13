/** The header tabs' model: one tab per page or focused session you opened, kept in this browser in the order you dragged them. */
import type { View } from "../src/shared/sessions";
import { focusedView, hashForView, type Page, routeFromHash } from "./routing";

/** One header tab: `key` names what it shows, one per page kind or per focused session; `hash` is where you last saw it, and `at` when. */
export interface HeaderTab {
	key: string;
	hash: string;
	at: number;
}

export const HEADER_TABS_KEY = "omp-agents.header-tabs";

/** The most tabs the header keeps; opening one more drops the one seen longest ago. */
export const MAX_HEADER_TABS = 8;

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

/** The tab `target` belongs to, one per page kind or per focused session; stored tabs keep these strings. */
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

/**
 * `tabs` with the one `hash` names brought up to date at `now`, or added at the end; past {@link MAX_HEADER_TABS}, the one seen longest ago goes.
 * `tabs` itself when that tab already says so, so the row can work out the visit each render and store only a change.
 */
export function visitHeaderTab(tabs: readonly HeaderTab[], hash: string, now: number): readonly HeaderTab[] {
	const target = headerTabTarget(hash);
	if (target === null) return tabs;
	const key = headerTabKey(target);
	const known = tabs.find(tab => tab.key === key);
	if (known?.hash === hash && known.at === now) return tabs;
	const seen = { key, hash, at: now };
	const next = known ? tabs.map(tab => (tab === known ? seen : tab)) : [...tabs, seen];
	if (next.length <= MAX_HEADER_TABS) return next;
	const oldest = next.reduce((a, b) => (b.at < a.at ? b : a));
	return next.filter(tab => tab !== oldest);
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
