import { type Dispatch, type SetStateAction, useMemo, useRef } from "react";
import type { View } from "../src/shared/sessions";
import type { PaletteEvent, PaletteState } from "./command-palette";
import { adjacentSession, closePane, type Layout, type Page, type SettingsRoute, type SidebarTab } from "./routing";
import { type ShortcutHandler, type ShortcutHandlers, type ShortcutId, useShortcuts } from "./shortcuts";
import { useHistoryPosition } from "./use-history-position";

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
	/** The sidebar tabs whose service omp holds no sign-in to; their shortcuts and commands do not apply. */
	absentTabs: ReadonlySet<SidebarTab>;
	/** The dashboard can create Linear issues, and the sidebar shows Tickets, so the new-ticket shortcut applies. */
	ticketsCallable: boolean;
	/** The right sidebar has a session to show. */
	hasDetails: boolean;
	/** Sends the focused session **Open pull request**'s prompt, or `null` while its branch can take no pull request, as `offeredPrompt` says, or a press of it is under way. */
	openPullRequest: (() => void) | null;
	/** Opens the focused live dashboard session's goal editor, or `null` when unavailable. */
	setGoal: (() => void) | null;
	palette: PaletteState | null;
	dispatchPalette: Dispatch<PaletteEvent>;
	setNewTicket: Dispatch<SetStateAction<string | null>>;
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
	toggleTerminal: () => void;
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
			// ↑ and ↓ step only while the panes show: a page's list, or its native scrolling, keeps them.
			sessionsNext: () => (latest.current.page ? false : step(1)),
			sessionsPrevious: () => (latest.current.page ? false : step(-1)),
			tools: () => latest.current.toggleTools(),
			hideTools: () => latest.current.toggleHideTools(),
			hideThinking: () => latest.current.toggleHideThinking(),
			sessionsSidebar: () => latest.current.toggleSidebar("left"),
			detailsSidebar: () => {
				if (!latest.current.hasDetails) return false;
				latest.current.toggleSidebar("right");
			},
			openBrowser: () => {
				if (!latest.current.hasDetails) return false;
				latest.current.showBrowser();
			},
			settings: () => {
				const { page, layout, settings, navigate, show } = latest.current;
				if (page?.kind === "settings") show(layout);
				else navigate({ kind: "settings", ...settings });
			},
			back: () => history.back(),
			forward: () => history.forward(),
			"pull-requests": () => {
				const { page } = latest.current;
				// The Pull requests page lists the pull requests itself; its shortcut then has nothing to open.
				if (page?.kind === "pull-requests" && !page.target) return;
				latest.current.showTab("pull-requests");
			},
			tickets: goToTab("tickets"),
			newTicket: () => {
				const { ticketsCallable, setNewTicket } = latest.current;
				if (!ticketsCallable) return false;
				setNewTicket(current => current ?? "");
			},
			bots: goToTab("bots"),
			sessions: () => {
				if (!latest.current.page) return;
				latest.current.showTab("sessions");
			},
			todo: goToTab("todo"),
			calendar: goToTab("calendar"),
			email: goToTab("email"),
			sport: goToTab("sport"),
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
			terminal: () => latest.current.toggleTerminal(),
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
	const { absentTabs, ticketsCallable, hasDetails } = input;
	const canOpenPullRequest = input.openPullRequest !== null;
	const canSetGoal = input.setGoal !== null;
	const canMaximize = input.page === null && input.layout.panes.length > 1;
	const { canGoBack, canGoForward } = useHistoryPosition();
	/** Commands that would do nothing now. */
	const unavailable = useMemo(
		() =>
			new Set<ShortcutId>([
				// A sidebar tab's shortcut has the tab's id.
				...(absentTabs satisfies ReadonlySet<ShortcutId>),
				...(ticketsCallable ? [] : ["newTicket" as const]),
				...(hasDetails ? [] : ["detailsSidebar" as const, "openBrowser" as const]),
				...(canMaximize ? [] : ["maximizePane" as const]),
				...(canOpenPullRequest ? [] : ["openPullRequest" as const]),
				...(canSetGoal ? [] : ["setGoal" as const]),
				...(canGoBack ? [] : ["back" as const]),
				...(canGoForward ? [] : ["forward" as const]),
			]),
		[absentTabs, ticketsCallable, hasDetails, canMaximize, canOpenPullRequest, canSetGoal, canGoBack, canGoForward],
	);
	return unavailable;
}
