/**
 * The sessions that need you, outside the page: the desktop app's Dock badge counts them, and each moment one asks or
 * ends a turn raises a system notification through the desktop shell, which shows it while the window is not in front.
 * Showing a session in a focused window reads its turn.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { DesktopBridge } from "../src/shared/desktop-bridge";
import type { ClientMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import { type Attention, attend, needsYou, unreadShown } from "./attention";
import type { DashboardState } from "./dashboard-state";
import type { Page } from "./routing";
import { useStoredState } from "./stored-state";

declare global {
	interface Window {
		/** The desktop shell's bridge, from `desktop/preload.ts`; absent in a page no desktop window loaded, such as an automated browser's. */
		ompDesktop?: DesktopBridge;
	}
}

const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : window.ompDesktop;

const NOTIFICATIONS_KEY = "omp-agents.session-notifications";

/** On until you turn it off. */
const decodeOn = (raw: string | null): boolean => raw !== "off";

export interface SessionNotifications {
	/** Whether a session that needs you raises a system notification while the window is not in front. */
	on: boolean;
	set(on: boolean): void;
}

/** The Settings › Preferences switch for session notifications, kept in this app. */
export function useSessionNotifications(): SessionNotifications {
	const [on, set] = useStoredState(NOTIFICATIONS_KEY, decodeOn, value => (value ? "on" : "off"));
	return { on, set };
}

function subscribeFocus(change: () => void): () => void {
	window.addEventListener("focus", change);
	window.addEventListener("blur", change);
	document.addEventListener("visibilitychange", change);
	return () => {
		window.removeEventListener("focus", change);
		window.removeEventListener("blur", change);
		document.removeEventListener("visibilitychange", change);
	};
}

const NO_VIEWS: View[] = [];

/** Keeps the Dock badge, the notifications, and the read turns in step with the roster. */
export function useAttention(state: DashboardState, page: Page | null, send: (msg: ClientMsg) => void): void {
	const { hosts, connected, layout } = state;
	const { on } = useSessionNotifications();
	const focused = useSyncExternalStore(subscribeFocus, () => document.hasFocus());
	const count = connected ? hosts.filter(needsYou).length : 0;
	useEffect(() => desktop?.badge(count), [count]);

	const attention = useRef<Attention>(new Map());
	const raising = useRef(false);
	raising.current = on;
	useEffect(() => {
		const { raise, attention: next } = attend(attention.current, hosts);
		attention.current = next;
		if (raising.current) for (const alert of raise) desktop?.alert(alert);
	}, [hosts]);

	// A maximized pane hides the others, and a page hides them all.
	const shown = useMemo(() => (page ? NO_VIEWS : layout.maximized ? layout.panes.slice(layout.focus, layout.focus + 1) : layout.panes), [page, layout]);
	useEffect(() => {
		if (focused) for (const instanceId of unreadShown(hosts, shown)) send({ t: "read", instanceId });
	}, [focused, hosts, shown, send]);
}
