/**
 * The sessions that need you, outside the page: the desktop app's Dock badge counts them, and each moment one asks or
 * ends a turn raises a system notification through the desktop shell while the window is not in front, or, while it
 * is, plays the chosen sound alone if you asked for that. Showing a session in a focused window reads its turn.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { isNotificationSound, type DesktopBridge, type NotificationSound } from "../src/shared/desktop-bridge";
import type { ClientMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import { type Attention, attend, needsYou, unreadShown } from "./attention";
import { openBotView } from "./bots-model";
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
const TURNS_KEY = "omp-agents.notify-turns";
const SOUND_KEY = "omp-agents.notification-sound";
const FOCUSED_SOUND_KEY = "omp-agents.notification-sound-focused";

const encodeOn = (value: boolean): string => (value ? "on" : "off");
const decodeSound = (raw: string | null): NotificationSound => (isNotificationSound(raw) ? raw : "default");

export interface SessionNotifications {
	/** Whether a session that needs you raises a system notification while the window is not in front; on until you turn it off. */
	on: boolean;
	setOn(on: boolean): void;
	/** Whether a finished turn raises one too, besides a question; on until you turn it off. */
	turns: boolean;
	setTurns(turns: boolean): void;
	/** What a notification plays, the system's sound by default. */
	sound: NotificationSound;
	setSound(sound: NotificationSound): void;
	/** Whether the sound plays alone while the window is in front, where no notification shows; off until you turn it on. */
	soundWhenFocused: boolean;
	setSoundWhenFocused(soundWhenFocused: boolean): void;
}

/** The Settings › Preferences choices for session notifications and their sound, kept in this app. */
export function useSessionNotifications(): SessionNotifications {
	const [on, setOn] = useStoredState(NOTIFICATIONS_KEY, raw => raw !== "off", encodeOn);
	const [turns, setTurns] = useStoredState(TURNS_KEY, raw => raw !== "off", encodeOn);
	const [sound, setSound] = useStoredState(SOUND_KEY, decodeSound);
	const [soundWhenFocused, setSoundWhenFocused] = useStoredState(FOCUSED_SOUND_KEY, raw => raw === "on", encodeOn);
	return { on, setOn, turns, setTurns, sound, setSound, soundWhenFocused, setSoundWhenFocused };
}

/** Plays `sound` through the desktop app, as Settings' preview of it; nothing outside the app or in one built before it. */
export const playSound = (sound: NotificationSound): void => desktop?.playSound?.(sound);

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
	const { on, turns, sound, soundWhenFocused } = useSessionNotifications();
	const focused = useSyncExternalStore(subscribeFocus, () => document.hasFocus());
	const count = connected ? hosts.filter(needsYou).length : 0;
	useEffect(() => desktop?.badge(count), [count]);

	const attention = useRef<Attention>(new Map());
	// Only a new roster raises: changing a preference raises nothing, and a turn it muted stays heard.
	useEffect(() => {
		const { raise, attention: next } = attend(attention.current, hosts);
		attention.current = next;
		const alerts = on ? raise.filter(raised => turns || !raised.turn) : [];
		if (alerts.length === 0) return;
		if (!focused) for (const { alert } of alerts) desktop?.alert({ ...alert, sound });
		else if (soundWhenFocused) playSound(sound);
	}, [hosts]);

	// A maximized pane hides the others, and a page hides them all, but a Bot's page shows its conversation.
	const botConversation = openBotView(page, state.bots, hosts);
	const botInstance = botConversation?.kind === "live" ? botConversation.instanceId : null;
	const shown = useMemo<View[]>(
		() => (botInstance !== null ? [{ kind: "live", instanceId: botInstance, agentId: null }] : page ? NO_VIEWS : layout.maximized ? layout.panes.slice(layout.focus, layout.focus + 1) : layout.panes),
		[botInstance, page, layout],
	);
	useEffect(() => {
		if (focused) for (const instanceId of unreadShown(hosts, shown)) send({ t: "read", instanceId });
	}, [focused, hosts, shown, send]);
}
