import { useCallback, useRef, useState } from "react";
import type { Layout, Page, SettingsRoute, SidebarTab } from "./routing";

/** The sidebar tab that goes with each page; the panes keep the one you chose. A session's changes and the projects go with the sessions. */
const PAGE_TAB: Partial<Record<Page["kind"], SidebarTab>> = { "pull-requests": "pull-requests", tickets: "tickets", todo: "todo", calendar: "calendar", routines: "calendar", settings: "settings", changes: "sessions", projects: "sessions" };

/** The page each tab shows, but for Sessions, which shows the panes, and Settings, which keeps its section and workspace. */
const TAB_PAGE: Record<Exclude<SidebarTab, "sessions" | "settings">, Page> = {
	"pull-requests": { kind: "pull-requests", target: null },
	tickets: { kind: "tickets", target: null },
	todo: { kind: "todo", list: { kind: "all" }, open: null },
	calendar: { kind: "calendar" },
};

/** The settings section and workspace the Settings tab's links keep: the open page's, else Analytics and the focused session's directory. */
export function settingsRoute(page: Page | null, cwd: string | undefined): SettingsRoute {
	return { section: page?.kind === "settings" ? page.section : "analytics", cwd: page?.kind === "settings" ? page.cwd : cwd || null };
}

interface SidebarTabInput {
	page: Page | null;
	/** The Tickets tab shows; without it a tickets page keeps the tab the panes had. */
	ticketsShown: boolean;
	layout: Layout;
	settings: SettingsRoute;
	navigate: (page: Page) => void;
	show: (layout: Layout) => void;
}

/**
 * The tab the sidebar shows, and the way to show another: a page selects its tab, and `#pull-requests` picks the Pull requests tab, which
 * stays while you work in the panes until you choose Sessions. `showTab` keeps its identity across renders.
 */
export function useSidebarTab({ page, ticketsShown, layout, settings, navigate, show }: SidebarTabInput): { tab: SidebarTab; showTab: (tab: SidebarTab) => void } {
	const onPullRequests = page?.kind === "pull-requests";
	const [paneTab, setPaneTab] = useState<"sessions" | "pull-requests">(onPullRequests ? "pull-requests" : "sessions");
	const [wasOnPullRequests, setWasOnPullRequests] = useState(onPullRequests);
	if (onPullRequests !== wasOnPullRequests) {
		setWasOnPullRequests(onPullRequests);
		if (onPullRequests) setPaneTab("pull-requests");
	}
	const tab: SidebarTab = (page && !(page.kind === "tickets" && !ticketsShown) && PAGE_TAB[page.kind]) || paneTab;
	const latest = useRef({ layout, settings });
	latest.current = { layout, settings };
	const showTab = useCallback(
		(next: SidebarTab): void => {
			if (next === "settings") return navigate({ kind: "settings", ...latest.current.settings });
			if (next !== "sessions") return navigate(TAB_PAGE[next]);
			setPaneTab("sessions");
			show(latest.current.layout);
		},
		[navigate, show],
	);
	return { tab, showTab };
}
