import { type Dispatch, type SetStateAction, useMemo, useRef } from "react";
import type { View } from "../src/shared/sessions";
import type { PaletteEvent, PaletteState } from "./command-palette";
import { adjacentSession, type Layout, type Page, type SettingsRoute, type SidebarTab } from "./routing";
import { type ShortcutHandlers, type ShortcutId, TAB_SHORTCUTS, useShortcuts } from "./shortcuts";

/** What the page-wide shortcuts read when a key arrives, and what they call. */
export interface PageShortcutInput {
	page: Page | null;
	layout: Layout;
	/** A pane fills the grid. */
	maximized: boolean;
	tab: SidebarTab;
	settings: SettingsRoute;
	/** The views of the Sessions tab, in order, and the focused one: what the session shortcuts step through. */
	listed: View[];
	view: View | null;
	/** The sidebar tabs whose service omp holds no sign-in to; their shortcuts and commands do not apply. */
	signedOutTabs: ReadonlySet<SidebarTab>;
	/** The tabs the sidebar shows, in order: Cmd+1 goes to the first. */
	tabs: readonly SidebarTab[];
	/** The dashboard can create Linear issues, so the new-ticket shortcut applies. */
	linearCallable: boolean;
	/** The right sidebar has a session to show. */
	hasDetails: boolean;
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
		const goToTab = (tab: Exclude<SidebarTab, "sessions" | "settings" | "pull-requests">) => (): boolean | void => {
			const { signedOutTabs, page, showTab } = latest.current;
			if (signedOutTabs.has(tab)) return false;
			if (page?.kind === tab) return;
			showTab(tab);
		};
		const goTo: Record<SidebarTab, () => boolean | void> = {
			settings: () => {
				const { page, layout, settings, navigate, show } = latest.current;
				if (page?.kind === "settings") show(layout);
				else navigate({ kind: "settings", ...settings });
			},
			"pull-requests": () => {
				const { page } = latest.current;
				// The Pull requests page lists the pull requests itself; its shortcut then has nothing to open.
				if (page?.kind === "pull-requests" && !page.target) return;
				latest.current.showTab("pull-requests");
			},
			tickets: goToTab("tickets"),
			sessions: () => {
				const { tab, page } = latest.current;
				if (tab === "sessions" && !page) return;
				latest.current.showTab("sessions");
			},
			todo: goToTab("todo"),
			calendar: goToTab("calendar"),
			inbox: goToTab("inbox"),
		};
		const positions = Object.fromEntries(
			TAB_SHORTCUTS.map((id, index) => [
				id,
				(): boolean | void => {
					const tab: SidebarTab | undefined = latest.current.tabs[index];
					return tab === undefined ? false : goTo[tab]();
				},
			]),
		);
		return {
			...goTo,
			...positions,
			help: () => latest.current.setShortcutsOpen(open => !open),
			switcher: () => latest.current.dispatchPalette(latest.current.palette ? { type: "close" } : { type: "open" }),
			newSession: () => latest.current.openNewSession(),
			previousSession: () => step(-1),
			nextSession: () => step(1),
			tools: () => latest.current.toggleTools(),
			hideTools: () => latest.current.toggleHideTools(),
			hideThinking: () => latest.current.toggleHideThinking(),
			sessionsSidebar: () => latest.current.toggleSidebar("left"),
			detailsSidebar: () => {
				if (!latest.current.hasDetails) return false;
				latest.current.toggleSidebar("right");
			},
			newTicket: () => {
				const { linearCallable, setNewTicket } = latest.current;
				if (!linearCallable) return false;
				setNewTicket(current => current ?? "");
			},
			routines: () => {
				const { page, navigate } = latest.current;
				if (page?.kind === "routines") return false;
				navigate({ kind: "routines", target: null });
			},
			projects: () => {
				const { page, navigate } = latest.current;
				if (page?.kind === "projects" && page.target.kind === "list") return false;
				navigate({ kind: "projects", target: { kind: "list" } });
			},
			restore: () => {
				const { maximized, layout, show } = latest.current;
				if (!maximized) return false;
				show({ ...layout, maximized: false });
			},
			terminal: () => latest.current.toggleTerminal(),
		};
	}, []);
	useShortcuts(handlers);
	const { signedOutTabs, linearCallable, hasDetails } = input;
	/** Commands that would do nothing now. */
	const unavailable = useMemo(
		() =>
			new Set<ShortcutId>([
				// A sidebar tab's shortcut has the tab's id.
				...(signedOutTabs satisfies ReadonlySet<ShortcutId>),
				...(linearCallable ? [] : ["newTicket" as const]),
				...(hasDetails ? [] : ["detailsSidebar" as const]),
			]),
		[signedOutTabs, linearCallable, hasDetails],
	);
	return { handlers, unavailable };
}
