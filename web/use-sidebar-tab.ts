import { useCallback, useRef, useState } from "react";
import type { View } from "../src/shared/sessions";
import { type Layout, openView, type Page, type SettingsRoute, type SidebarTab } from "./routing";

/** The sidebar tab that goes with each page; the panes keep the one you chose. A session's changes and the projects go with the sessions. */
const PAGE_TAB: Partial<Record<Page["kind"], SidebarTab>> = { "pull-requests": "pull-requests", tickets: "tickets", todo: "todo", calendar: "calendar", routines: "calendar", inbox: "inbox", settings: "settings", projects: "sessions" };

/** The page each tab shows, but for Sessions, which shows the panes, and Settings, which keeps its section and workspace. */
const TAB_PAGE: Record<Exclude<SidebarTab, "sessions" | "settings">, Page> = {
	"pull-requests": { kind: "pull-requests", target: null },
	tickets: { kind: "tickets", target: null },
	todo: { kind: "todo", list: { kind: "all" }, open: null },
	calendar: { kind: "calendar" },
	inbox: { kind: "inbox", target: null },
};

/** The settings section the Settings tab's links keep: the open page's, else Analytics. */
export function settingsRoute(page: Page | null): SettingsRoute {
	return { section: page?.kind === "settings" ? page.section : "analytics" };
}

interface SidebarTabInput {
	page: Page | null;
	/** The tabs whose service omp holds no sign-in to; a page of one keeps the tab the panes had. */
	signedOutTabs: ReadonlySet<SidebarTab>;
	layout: Layout;
	/** The session the Sessions tab opens when no pane shows one; `null` for none. */
	latestSession: View | null;
	settings: SettingsRoute;
	navigate: (page: Page) => void;
	show: (layout: Layout) => void;
}

/**
 * The tab the sidebar shows, and the way to show another: a page selects its tab, and `#pull-requests` picks the Pull requests tab, which
 * stays while you work in the panes until you choose Sessions. Sessions keeps the panes, or opens the latest session when no pane shows one.
 * `showTab` keeps its identity across renders.
 * A page whose tab the user hid in Preferences still selects that tab, so its panel, such as the Todo lists, shows with no trigger
 * in the bar; a page whose service is signed out keeps the tab the panes had.
 */
export function useSidebarTab({ page, signedOutTabs, layout, latestSession, settings, navigate, show }: SidebarTabInput): { tab: SidebarTab; showTab: (tab: SidebarTab) => void } {
	const onPullRequests = page?.kind === "pull-requests";
	const [paneTab, setPaneTab] = useState<"sessions" | "pull-requests">(onPullRequests ? "pull-requests" : "sessions");
	const [wasOnPullRequests, setWasOnPullRequests] = useState(onPullRequests);
	if (onPullRequests !== wasOnPullRequests) {
		setWasOnPullRequests(onPullRequests);
		if (onPullRequests) setPaneTab("pull-requests");
	}
	const pageTab = page ? PAGE_TAB[page.kind] : undefined;
	const tab: SidebarTab = pageTab && !signedOutTabs.has(pageTab) ? pageTab : paneTab;
	const latest = useRef({ layout, latestSession, settings });
	latest.current = { layout, latestSession, settings };
	const showTab = useCallback(
		(next: SidebarTab): void => {
			if (next === "settings") return navigate({ kind: "settings", ...latest.current.settings });
			if (next !== "sessions") return navigate(TAB_PAGE[next]);
			setPaneTab("sessions");
			const { layout: shown, latestSession: session } = latest.current;
			show(shown.panes.length === 0 && session ? openView(shown, session, "replace") : shown);
		},
		[navigate, show],
	);
	return { tab, showTab };
}
