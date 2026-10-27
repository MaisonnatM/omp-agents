import { type Dispatch, type SetStateAction, useMemo, useRef } from "react";
import type { View } from "../src/shared/sessions";
import type { PaletteEvent, PaletteState } from "./command-palette";
import { adjacentSession, type Layout, type Page, type SettingsRoute, type SidebarPanel, type SidebarTab } from "./routing";
import { type ShortcutHandler, type ShortcutHandlers, type ShortcutId, useShortcuts } from "./shortcuts";
import { positionHandlers } from "./sidebar-tabs";

/** What the page-wide shortcuts read when a key arrives, and what they call. */
export interface PageShortcutInput {
	page: Page | null;
	layout: Layout;
	/** A pane fills the grid. */
	maximized: boolean;
	tab: SidebarPanel;
	settings: SettingsRoute;
	/** The views of the Sessions tab, in order, and the focused one: what the session shortcuts step through. */
	listed: View[];
	view: View | null;
	/** The sidebar tabs whose service omp holds no sign-in to; their shortcuts and commands do not apply. */
	signedOutTabs: ReadonlySet<SidebarTab>;
	/** The tabs the sidebar's bar draws, the header switch's group's, in order: Cmd+1 goes to the first. */
	tabs: readonly SidebarTab[];
	/** The dashboard can create Linear issues, so the new-ticket shortcut applies. */
	linearCallable: boolean;
	/** The right sidebar has a session to show. */
	hasDetails: boolean;
	/** Sends the focused session **Open PR**'s prompt, or `null` while its header offers no **Open PR** to press. */
	openPullRequest: (() => void) | null;
	palette: PaletteState | null;
	dispatchPalette: Dispatch<PaletteEvent>;
	setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
	setNewTicket: Dispatch<SetStateAction<string | null>>;
	openNewSession: () => void;
	open: (view: View, mode: "replace") => void;
	show: (layout: Layout) => void;
	navigate: (page: Page) => void;
	showTab: (tab: SidebarTab) => void;
	toggleSidebar: (side: "left" | "right") => void;
	toggleTools: () => void;
	toggleHideTools: () => void;
	toggleHideThinking: () => void;
	toggleTerminal: () => void;
}

/**
 * The page-wide shortcuts, registered with the keyboard stack: App mounts first, so a page's own bindings take a key before these.
 * `handlers` keeps its identity across renders, as does `unavailable` until a command starts or stops applying, and a
 * handler reads what it needs from the render that last ran. The command palette runs the same `handlers`.
 */
export function usePageShortcuts(input: PageShortcutInput): { handlers: ShortcutHandlers; unavailable: ReadonlySet<ShortcutId> } {
	const latest = useRef(input);
	latest.current = input;
	const handlers = useMemo((): ShortcutHandlers => {
		const step = (by: 1 | -1): boolean | void => {
			const { listed, view, open } = latest.current;
			const next = adjacentSession(listed, view, by);
			if (next) open(next, "replace");
			else if (!listed.length) return false;
		};
		const goToTab = (tab: Exclude<SidebarTab, "sessions" | "pull-requests">): ShortcutHandler => () => {
			const { signedOutTabs, page, showTab } = latest.current;
			if (signedOutTabs.has(tab)) return false;
			if (page?.kind === tab) return;
			showTab(tab);
		};
		const goTo: Record<SidebarTab, ShortcutHandler> = {
			"pull-requests": () => {
				const { page } = latest.current;
				// The Pull requests page lists the pull requests itself; its shortcut then has nothing to open.
				if (page?.kind === "pull-requests" && !page.target) return;
				latest.current.showTab("pull-requests");
			},
			tickets: goToTab("tickets"),
			bots: goToTab("bots"),
			sessions: () => {
				const { tab, page } = latest.current;
				if (tab === "sessions" && !page) return;
				latest.current.showTab("sessions");
			},
			todo: goToTab("todo"),
			notes: goToTab("notes"),
			calendar: goToTab("calendar"),
			inbox: goToTab("inbox"),
		};
		const positions = positionHandlers(() => latest.current.tabs, goTo);
		return {
			help: () => latest.current.setShortcutsOpen(open => !open),
			switcher: () => latest.current.dispatchPalette(latest.current.palette ? { type: "close" } : { type: "open" }),
			newSession: () => latest.current.openNewSession(),
			previousSession: () => step(-1),
			nextSession: () => step(1),
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
			settings: () => {
				const { page, layout, settings, navigate, show } = latest.current;
				if (page?.kind === "settings") show(layout);
				else navigate({ kind: "settings", ...settings });
			},
			back: () => history.back(),
			forward: () => history.forward(),
			"pull-requests": goTo["pull-requests"],
			tickets: goTo.tickets,
			newTicket: () => {
				const { linearCallable, setNewTicket } = latest.current;
				if (!linearCallable) return false;
				setNewTicket(current => current ?? "");
			},
			bots: goTo.bots,
			sessions: goTo.sessions,
			todo: goTo.todo,
			notes: goTo.notes,
			calendar: goTo.calendar,
			inbox: goTo.inbox,
			...positions,
			restore: () => {
				const { maximized, layout, show } = latest.current;
				if (!maximized) return false;
				show({ ...layout, maximized: false });
			},
			terminal: () => latest.current.toggleTerminal(),
			openPullRequest: () => {
				const { openPullRequest } = latest.current;
				if (!openPullRequest) return false;
				openPullRequest();
			},
		};
	}, []);
	useShortcuts(handlers);
	const { signedOutTabs, linearCallable, hasDetails } = input;
	const canOpenPullRequest = input.openPullRequest !== null;
	/** Commands that would do nothing now. */
	const unavailable = useMemo(
		() =>
			new Set<ShortcutId>([
				// A sidebar tab's shortcut has the tab's id.
				...(signedOutTabs satisfies ReadonlySet<ShortcutId>),
				...(linearCallable ? [] : ["newTicket" as const]),
				...(hasDetails ? [] : ["detailsSidebar" as const]),
				...(canOpenPullRequest ? [] : ["openPullRequest" as const]),
			]),
		[signedOutTabs, linearCallable, hasDetails, canOpenPullRequest],
	);
	return { handlers, unavailable };
}
