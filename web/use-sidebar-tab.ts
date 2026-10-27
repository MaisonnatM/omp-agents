import { useCallback, useRef, useState } from "react";
import type { View } from "../src/shared/sessions";
import { type Layout, openView, type Page, type SettingsRoute, type TabGroup, type SidebarPanel, type SidebarTab } from "./routing";
import { groupEntry, TAB_ROWS } from "./sidebar-tabs";

/** The sidebar panel that goes with each page; the panes keep the tab you chose. A session's changes go with the sessions. */
const PAGE_TAB: Partial<Record<Page["kind"], SidebarPanel>> = { "pull-requests": "pull-requests", tickets: "tickets", todo: "todo", routines: "routines", notes: "notes", calendar: "calendar", email: "email", settings: "settings" };

/** The page each tab shows, but for Sessions, which shows the panes. */
const TAB_PAGE: Record<Exclude<SidebarTab, "sessions">, Page> = {
	"pull-requests": { kind: "pull-requests", target: null },
	tickets: { kind: "tickets", target: null },
	todo: { kind: "todo", list: { kind: "all" }, open: null },
	routines: { kind: "routines", target: null },
	notes: { kind: "notes", list: { kind: "all" }, open: null },
	calendar: { kind: "calendar" },
	email: { kind: "email", target: null },
};

/** The settings section the header's Settings button keeps: the open page's, else Analytics. */
export function settingsRoute(page: Page | null): SettingsRoute {
	return { section: page?.kind === "settings" ? page.section : "analytics" };
}

interface SidebarTabInput {
	page: Page | null;
	/** The tabs whose service omp holds no sign-in to; a page of one keeps the tab the panes had. */
	signedOutTabs: ReadonlySet<SidebarTab>;
	/** The tabs the bar shows, in order, which the header's switch picks from. */
	shown: readonly SidebarTab[];
	layout: Layout;
	/** The session the Sessions tab opens when no pane shows one; `null` for none. */
	latestSession: View | null;
	navigate: (page: Page) => void;
	show: (layout: Layout) => void;
}

/** The header switch's group and the tab each group was last left on, which switching back reopens. */
interface GroupMemory {
	group: TabGroup;
	last: Record<TabGroup, SidebarTab>;
}

/**
 * The panel the sidebar shows and the header switch's group, and the ways to show another tab or group: a page selects its tab, and
 * `#pull-requests` picks the Pull requests tab, which stays while you work in the panes until you choose Sessions. Sessions keeps the
 * panes, or opens the latest session when no pane shows one. The group follows the tab, and stays while Settings is open.
 * `showTab` and `showGroup` keep their identity across renders.
 * A page whose tab the user hid in Preferences still selects that tab, so its panel, such as the Todo lists, shows with no trigger
 * in the bar; a page whose service is signed out keeps the tab the panes had.
 */
export function useSidebarTab({ page, signedOutTabs, shown, layout, latestSession, navigate, show }: SidebarTabInput): {
	tab: SidebarPanel;
	showTab: (tab: SidebarTab) => void;
	group: TabGroup;
	showGroup: (group: TabGroup) => void;
} {
	const onPullRequests = page?.kind === "pull-requests";
	const [paneTab, setPaneTab] = useState<"sessions" | "pull-requests">(onPullRequests ? "pull-requests" : "sessions");
	const [wasOnPullRequests, setWasOnPullRequests] = useState(onPullRequests);
	if (onPullRequests !== wasOnPullRequests) {
		setWasOnPullRequests(onPullRequests);
		if (onPullRequests) setPaneTab("pull-requests");
	}
	const pageTab = page ? PAGE_TAB[page.kind] : undefined;
	const tab: SidebarPanel = pageTab && (pageTab === "settings" || !signedOutTabs.has(pageTab)) ? pageTab : paneTab;
	const [memory, setMemory] = useState<GroupMemory>(() => ({ group: tab === "settings" ? "dev" : TAB_ROWS[tab].group, last: { dev: "sessions", ops: "notes" } }));
	if (tab !== "settings") {
		const group = TAB_ROWS[tab].group;
		if (memory.group !== group || memory.last[group] !== tab) setMemory({ group, last: { ...memory.last, [group]: tab } });
	}
	const latest = useRef({ layout, latestSession, shown, last: memory.last });
	latest.current = { layout, latestSession, shown, last: memory.last };
	const showTab = useCallback(
		(next: SidebarTab): void => {
			if (next !== "sessions") return navigate(TAB_PAGE[next]);
			setPaneTab("sessions");
			const { layout: panes, latestSession: session } = latest.current;
			show(panes.panes.length === 0 && session ? openView(panes, session, "replace") : panes);
		},
		[navigate, show],
	);
	const showGroup = useCallback(
		(next: TabGroup): void => {
			const { shown: tabs, last } = latest.current;
			const target = groupEntry(tabs, next, last[next]);
			if (target) showTab(target);
		},
		[showTab],
	);
	return { tab, showTab, group: memory.group, showGroup };
}
