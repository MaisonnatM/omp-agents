/**
 * The sessions that need you, outside the page: the desktop app's Dock badge counts them, and each moment one asks or
 * ends a turn raises a system notification while the window is not focused, through the desktop shell or else the
 * browser's Notifications API. Showing a session in a focused window reads its turn.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from "react";
import type { DesktopBridge, SessionAlert } from "../src/shared/desktop-bridge";
import type { ClientMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import { type Attention, attend, needsYou, unreadShown, yourSessions } from "./attention";
import type { DashboardState } from "./dashboard-state";
import type { Page } from "./routing";
import { useStoredState } from "./stored-state";

declare global {
	interface Window {
		/** The desktop shell's bridge, from `desktop/preload.ts`; absent in a browser. */
		ompDesktop?: DesktopBridge;
	}
}

const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : window.ompDesktop;

const NOTIFICATIONS_KEY = "omp-agents.session-notifications";

/** On in the desktop app until you turn it off; off in a browser until you turn it on there. */
const decodeOn = (raw: string | null): boolean => (raw === null ? desktop !== undefined : raw === "on");

/** The browser's permission to notify; the desktop app needs none. */
const browserPermission = (): NotificationPermission | "unsupported" => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);

export interface SessionNotifications {
	/** Whether a session that needs you raises a system notification while the window is not focused. */
	on: boolean;
	/** Why the browser shows none, or `null`. */
	blocked: string | null;
	/** Turning them on in a browser first asks it for the permission, and stays off without it. */
	set(on: boolean): void;
}

/** The Settings › Preferences switch for session notifications, kept in this browser. */
export function useSessionNotifications(): SessionNotifications {
	const [stored, store] = useStoredState(NOTIFICATIONS_KEY, decodeOn, on => (on ? "on" : "off"));
	// The permission is read on each render; an answer to the request renders again to show it.
	const [, answered] = useReducer((count: number) => count + 1, 0);
	const permission = desktop ? "granted" : browserPermission();
	const set = useCallback(
		(on: boolean) => {
			if (!on || desktop || browserPermission() === "granted") {
				store(on);
				return;
			}
			if (browserPermission() === "unsupported") return;
			void Notification.requestPermission().then(answer => {
				if (answer === "granted") store(true);
				answered();
			});
		},
		[store],
	);
	const blocked =
		permission === "unsupported" ? "This browser shows no notifications." : permission === "denied" ? "This browser blocks notifications from the dashboard: allow them in its site settings." : null;
	return { on: stored && permission === "granted", blocked, set };
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

function raise(alert: SessionAlert): void {
	if (desktop) {
		desktop.alert(alert);
		return;
	}
	if (browserPermission() !== "granted") return;
	// One notification per session: a newer one replaces the one before.
	const notification = new Notification(alert.title, { body: alert.body, tag: alert.hash });
	notification.onclick = () => {
		window.focus();
		location.hash = alert.hash;
		notification.close();
	};
}

const NO_VIEWS: View[] = [];

/** Keeps the Dock badge, the notifications, and the read turns in step with the roster. */
export function useAttention(state: DashboardState, page: Page | null, send: (msg: ClientMsg) => void): void {
	const { hosts, projects, connected, layout } = state;
	const { on } = useSessionNotifications();
	const focused = useSyncExternalStore(subscribeFocus, () => document.hasFocus());
	const yours = useMemo(() => yourSessions(hosts, projects), [hosts, projects]);
	const count = connected ? yours.filter(needsYou).length : 0;
	useEffect(() => desktop?.badge(count), [count]);

	const attention = useRef<Attention>(new Map());
	const raising = useRef(false);
	// The desktop shell asks its window instead, which knows whether the app is in front.
	raising.current = on && (desktop !== undefined || !focused);
	useEffect(() => {
		const { raise: fresh, attention: next } = attend(attention.current, yours);
		attention.current = next;
		if (raising.current) for (const alert of fresh) raise(alert);
	}, [yours]);

	// A maximized pane hides the others, and a page hides them all.
	const shown = useMemo(() => (page ? NO_VIEWS : layout.maximized ? layout.panes.slice(layout.focus, layout.focus + 1) : layout.panes), [page, layout]);
	useEffect(() => {
		if (focused) for (const instanceId of unreadShown(hosts, shown)) send({ t: "read", instanceId });
	}, [focused, hosts, shown, send]);
}
