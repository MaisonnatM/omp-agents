import { type Dispatch, useEffect, useMemo, useRef } from "react";
import type { View } from "../src/shared/sessions";
import type { PaletteEvent, PaletteState } from "./command-palette";
import { followMouseHistoryButtons, goInHeaderTab, useHeaderTabHistory } from "./header-tab-history";
import { MODULE_LIST, type WebModuleId } from "./modules";
import { adjacentSession, closePane, type Layout, type Page, type SettingsRoute, type SidebarTab } from "./routing";
import { type ShortcutHandler, type ShortcutHandlers, type ShortcutId, useShortcuts } from "./shortcuts";

const dialogOpen = (): boolean => document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;

/** What the page-wide shortcuts read when a key arrives, and what they call. */
export interface PageShortcutInput {
	page: Page | null;
	layout: Layout;
	/** A pane fills the grid. */
	maximized: boolean;
	settings: SettingsRoute;
	/** The views of the Sessions tab, in order, and the focused one: what the session shortcuts step through, and ⌥1 to ⌥9 count. */
	listed: View[];
	view: View | null;
	/** The sidebar tabs of the modules turned off; their shortcuts and commands do not apply. */
	absentTabs: ReadonlySet<SidebarTab>;
	/** The right sidebar has a session to show. */
	hasDetails: boolean;
	/** Sends the focused session **Open pull request**'s prompt, or `null` while its branch can take no pull request, as `offeredPrompt` says, or a press of it is under way. */
	openPullRequest: (() => void) | null;
	/** Opens the focused live dashboard session's goal editor, or `null` when unavailable. */
	setGoal: (() => void) | null;
	palette: PaletteState | null;
	dispatchPalette: Dispatch<PaletteEvent>;
	openNewSession: (cwd?: string) => void;
	open: (view: View, mode: "replace") => void;
	show: (layout: Layout) => void;
	navigate: (page: Page) => void;
	showTab: (tab: SidebarTab | "sessions") => void;
	toggleSidebar: (side: "left" | "right") => void;
	/** Opens the details sidebar on its Browser tab. */
	showBrowser: () => void;
	toggleTools: () => void;
	toggleHideTools: () => void;
	toggleHideThinking: () => void;
}

/**
 * The page-wide shortcuts, registered with the keyboard stack: App mounts first, so a page's own bindings take a key before these.
 * The handlers keep their identity across renders, and each reads what it needs from the render that last ran. Returns
 * the commands that would do nothing now, which keeps its identity until one starts or stops applying.
 */
export function usePageShortcuts(input: PageShortcutInput): ReadonlySet<ShortcutId> {
	const latest = useRef(input);
	latest.current = input;
	const handlers = useMemo((): ShortcutHandlers => {
		const step = (by: 1 | -1): boolean | void => {
			const { listed, view, open } = latest.current;
			const next = adjacentSession(listed, view, by);
			if (next) open(next, "replace");
			else if (!listed.length) return false;
		};
		const goToTab = (tab: Exclude<SidebarTab, "pull-requests">): ShortcutHandler => () => {
			const { absentTabs, page, showTab } = latest.current;
			if (absentTabs.has(tab)) return false;
			if (page?.kind === tab) return;
			showTab(tab);
		};
		const moduleGoTo = Object.fromEntries(MODULE_LIST.map(({ id }) => [id, goToTab(id)])) as Record<WebModuleId, ShortcutHandler>;
		return {
			help: () => {
				const { page, layout, navigate, show } = latest.current;
				if (page?.kind === "settings" && page.section === "keyboard") show(layout);
				else navigate({ kind: "settings", section: "keyboard" });
			},
			switcher: () => latest.current.dispatchPalette(latest.current.palette ? { type: "close" } : { type: "open" }),
			newSession: () => latest.current.openNewSession(),
			getStarted: () => latest.current.navigate({ kind: "get-started" }),
			previousSession: () => step(-1),
			nextSession: () => step(1),
			jumpToSession: key => {
				const { listed, open } = latest.current;
				const next = listed[key];
				if (!next) return false;
				open(next, "replace");
			},
			// ↑ and ↓ step only while the panes show with no dialog over them: a page's list, a dialog, or native scrolling keeps them.
			sessionsNext: () => (latest.current.page || dialogOpen() ? false : step(1)),
			sessionsPrevious: () => (latest.current.page || dialogOpen() ? false : step(-1)),
			tools: () => latest.current.toggleTools(),
			hideTools: () => latest.current.toggleHideTools(),
			hideThinking: () => latest.current.toggleHideThinking(),
			sessionsSidebar: () => latest.current.toggleSidebar("left"),
			detailsSidebar: () => {
				if (!latest.current.hasDetails) return false;
				latest.current.toggleSidebar("right");
			},
			detailsBrowser: () => {
				if (!latest.current.hasDetails) return false;
				latest.current.showBrowser();
			},
			settings: () => {
				const { page, layout, settings, navigate, show } = latest.current;
				if (page?.kind === "settings") show(layout);
				else navigate({ kind: "settings", ...settings });
			},
			back: () => goInHeaderTab(-1),
			forward: () => goInHeaderTab(1),
			"pull-requests": () => {
				const { page } = latest.current;
				// The Pull requests page lists the pull requests itself; its shortcut then has nothing to open.
				if (page?.kind === "pull-requests" && !page.target) return;
				latest.current.showTab("pull-requests");
			},
			sessions: () => {
				if (!latest.current.page) return;
				latest.current.showTab("sessions");
			},
			...moduleGoTo,
			restore: () => {
				const { page, maximized, layout, show } = latest.current;
				if (page) return false;
				if (maximized) {
					show({ ...layout, maximized: false });
					return;
				}
				if (layout.panes.length < 2) return false;
				show(closePane(layout, layout.panes.length - 1));
			},
			maximizePane: () => {
				const { page, maximized, layout, show } = latest.current;
				if (page || layout.panes.length < 2) return false;
				show({ ...layout, maximized: !maximized });
			},
			openPullRequest: () => {
				const { openPullRequest } = latest.current;
				if (!openPullRequest) return false;
				openPullRequest();
			},
			setGoal: () => {
				const { setGoal } = latest.current;
				if (!setGoal) return false;
				setGoal();
			},
		};
	}, []);
	useShortcuts(handlers);
	useEffect(followMouseHistoryButtons, []);
	const { absentTabs, hasDetails } = input;
	const canOpenPullRequest = input.openPullRequest !== null;
	const canSetGoal = input.setGoal !== null;
	const canMaximize = input.page === null && input.layout.panes.length > 1;
	const { canGoBack, canGoForward } = useHeaderTabHistory();
	/** Commands that would do nothing now. */
	const unavailable = useMemo(
		() =>
			new Set<ShortcutId>([
				// A sidebar tab's shortcut has the tab's id.
				...(absentTabs satisfies ReadonlySet<ShortcutId>),
				...(hasDetails ? [] : ["detailsSidebar" as const, "detailsBrowser" as const]),
				...(canMaximize ? [] : ["maximizePane" as const]),
				...(canOpenPullRequest ? [] : ["openPullRequest" as const]),
				...(canSetGoal ? [] : ["setGoal" as const]),
				...(canGoBack ? [] : ["back" as const]),
				...(canGoForward ? [] : ["forward" as const]),
			]),
		[absentTabs, hasDetails, canMaximize, canOpenPullRequest, canSetGoal, canGoBack, canGoForward],
	);
	return unavailable;
}
