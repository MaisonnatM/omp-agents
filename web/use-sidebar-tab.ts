import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { View } from "../src/shared/sessions";
import { type Layout, openView, type Page, type SettingsRoute, settingsSection, type SidebarPanel, type SidebarTab } from "./routing";
import { useStoredState } from "./stored-state";

/** The sidebar panel that goes with each page; the panes keep the tab you chose. A session's changes go with the sessions. */
const PAGE_TAB: Partial<Record<Page["kind"], SidebarPanel>> = { "pull-requests": "pull-requests", tickets: "tickets", todo: "todo", bots: "bots", notes: "notes", calendar: "calendar", email: "email", settings: "settings" };

/** The page each tab shows, but for Sessions, which shows the panes, and Bots while it has one to open. */
const TAB_PAGE: Record<Exclude<SidebarTab, "sessions">, Page> = {
	"pull-requests": { kind: "pull-requests", target: null },
	tickets: { kind: "tickets", target: null },
	bots: { kind: "bots", target: null, adding: false },
	todo: { kind: "todo", list: { kind: "all" }, open: null },
	notes: { kind: "notes", list: { kind: "all" }, open: null },
	calendar: { kind: "calendar" },
	email: { kind: "email", target: null },
};

/** The settings section the header's Settings button, `G ,`, and the sidebar keep: the open page's, else the last one open, which this browser remembers, else Analytics. */
export function useSettingsRoute(page: Page | null): SettingsRoute {
	const [last, setLast] = useStoredState("omp-agents.settings-section", settingsSection);
	const open = page?.kind === "settings" ? page.section : null;
	useEffect(() => {
		if (open) setLast(open);
	}, [open, setLast]);
	const section = open ?? last;
	return useMemo(() => ({ section }), [section]);
}

interface SidebarTabInput {
	page: Page | null;
	/** The tabs whose service omp holds no sign-in to; a page of one keeps the tab the panes had. */
	signedOutTabs: ReadonlySet<SidebarTab>;
	layout: Layout;
	/** The session the Sessions tab opens when no pane shows one; `null` for none. */
	latestSession: View | null;
	/** The Bot the Bots tab opens, the first of its list, the one spoken to most recently; `null` for the gallery while there is none. */
	latestBot: string | null;
	navigate: (page: Page) => void;
	show: (layout: Layout) => void;
}

/**
 * The panel the sidebar shows, and the way to show another tab: a page selects its tab, and `#pull-requests` picks the
 * Pull requests tab, which stays while you work in the panes until you choose Sessions. Sessions keeps the panes, or
 * opens the latest session when no pane shows one; Bots opens the latest Bot's page. `showTab` keeps its identity across renders.
 * A page whose tab the user hid in Preferences still selects that tab, so its panel shows with no tab of the bar selected,
 * and a page whose trigger sits in the header shows its panel, such as the Notes nav, with no bar; a page whose service is signed out keeps the tab the panes had.
 */
export function useSidebarTab({ page, signedOutTabs, layout, latestSession, latestBot, navigate, show }: SidebarTabInput): {
	tab: SidebarPanel;
	showTab: (tab: SidebarTab) => void;
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
	const latest = useRef({ layout, latestSession, latestBot });
	latest.current = { layout, latestSession, latestBot };
	const showTab = useCallback(
		(next: SidebarTab): void => {
			const bot = latest.current.latestBot;
			if (next === "bots" && bot !== null) return navigate({ kind: "bots", target: bot, routine: null });
			if (next !== "sessions") return navigate(TAB_PAGE[next]);
			setPaneTab("sessions");
			const { layout: panes, latestSession: session } = latest.current;
			show(panes.panes.length === 0 && session ? openView(panes, session, "replace") : panes);
		},
		[navigate, show],
	);
	return { tab, showTab };
}
