import { useCallback, useEffect, useMemo, useRef } from "react";
import type { View } from "../src/shared/sessions";
import { isWebModuleId, moduleHome, type WebModuleId } from "./modules";
import { type CorePage, type Layout, openView, type Page, type SettingsRoute, settingsSection, type SidebarTab } from "./routing";
import { type NavRow, navRowOf } from "./sidebar-tabs";
import { useStoredState } from "./stored-state";

/** The page each core tab shows, but for Sessions, which shows the panes, and Bots while it has one to open; a module's tab shows its home. */
const TAB_PAGE: Record<Exclude<SidebarTab, WebModuleId>, CorePage> = {
	"pull-requests": { kind: "pull-requests", target: null },
	bots: { kind: "bots", target: null, adding: false },
	todo: { kind: "todo", list: { kind: "all" }, open: null },
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
	/** The tabs that neither show nor apply, since they are signed out; a page of one selects no row. */
	absentTabs: ReadonlySet<SidebarTab>;
	layout: Layout;
	/** The session the Sessions tab opens when no pane shows one; `null` for none. */
	latestSession: View | null;
	/** The Bot the Bots tab opens, the first of its list, the one spoken to most recently; `null` for the gallery while there is none. */
	latestBot: string | null;
	navigate: (page: Page) => void;
	show: (layout: Layout) => void;
}

/**
 * The row of the page list the page on screen selects, {@link navRowOf}, and the way to show another tab or the sessions.
 * Sessions keeps the panes, or opens the latest session when no pane shows one; Bots opens the latest Bot's page.
 * `showTab` keeps its identity across renders.
 */
export function useSidebarTab({ page, absentTabs, layout, latestSession, latestBot, navigate, show }: SidebarTabInput): {
	row: NavRow | null;
	showTab: (tab: SidebarTab | "sessions") => void;
} {
	const row = navRowOf(page, absentTabs);
	const latest = useRef({ layout, latestSession, latestBot });
	latest.current = { layout, latestSession, latestBot };
	const showTab = useCallback(
		(next: SidebarTab | "sessions"): void => {
			const bot = latest.current.latestBot;
			if (next === "bots" && bot !== null) return navigate({ kind: "bots", target: bot, routine: null });
			if (next !== "sessions") return navigate(isWebModuleId(next) ? moduleHome(next) : TAB_PAGE[next]);
			const { layout: panes, latestSession: session } = latest.current;
			show(panes.panes.length === 0 && session ? openView(panes, session, "replace") : panes);
		},
		[navigate, show],
	);
	return { row, showTab };
}
