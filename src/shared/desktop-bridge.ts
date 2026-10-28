/**
 * What the desktop shell's preload (`desktop/preload.ts`) gives the page as `window.ompDesktop`: the Dock badge and the
 * system notifications of the sessions that need you, which the shell's main process (`desktop/attention.ts`) shows,
 * the sign-in of a page that holds no token the server takes, and what the page's Preview and the shell agree on.
 */
import { fields, type Guard, isString, oneOf, optional } from "../json";

/** The name the bridge takes on `window`; absent in a page no desktop window loaded. */
export const DESKTOP_BRIDGE = "ompDesktop";
export const BADGE_CHANNEL = "omp-agents:badge";
export const ALERT_CHANNEL = "omp-agents:alert";
export const TARGET_URL_CHANNEL = "omp-agents:target-url";
export const SOUND_CHANNEL = "omp-agents:sound";
export const SIGN_IN_CHANNEL = "omp-agents:sign-in";
/** Asked synchronously by the preload before the page's scripts run: the localStorage entries that sign the page in, or `null`. */
export const ACCESS_CHANNEL = "omp-agents:access";
/** The `ipc-message` channel of the Preview's webview, which carries each element react-grab copied in it, and the key of the page's message to its preload. */
export const PREVIEW_GRAB_CHANNEL = "omp-agents:preview-grab";
/** The Preview webview's session, apart from the dashboard's, and kept across launches, so a sign-in to the app lasts. */
export const PREVIEW_PARTITION = "persist:omp-preview";
/** The page's report of the ports a Browser's session runs servers on, for the shell's {@link appAddress}. */
export const BROWSER_PORTS_CHANNEL = "omp-agents:browser-ports";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `url` is an http or https address on this computer, the only kind the Preview loads. */
export function isLoopbackUrl(url: string): boolean {
	const parsed = URL.parse(url);
	return (parsed?.protocol === "http:" || parsed?.protocol === "https:") && LOOPBACK_HOSTS.has(parsed.hostname);
}

function portOf(url: URL): number {
	return url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
}

/**
 * Where the Browser goes instead of `target`, leaving `from`: the same address on `home`, the port of the session's
 * server it last showed, when `target` is on this computer at a port the session runs nothing on, and `from` is a page
 * off this computer, such as a sign-in provider, or one of the session's servers. An app whose sign-in names the port
 * it usually runs on, such as `localhost:3000`, so comes back to the session's server. `null` loads `target` as is.
 */
export function appAddress(target: string, from: string, home: number | null, sessionPorts: ReadonlySet<number>): string | null {
	const to = URL.parse(target);
	if (home === null || to === null || !isLoopbackUrl(target) || sessionPorts.has(portOf(to))) return null;
	const leaving = URL.parse(from);
	if (leaving !== null && isLoopbackUrl(from) && !sessionPorts.has(portOf(leaving))) return null;
	to.port = String(home);
	return to.href;
}

/** What a session notification plays: `off` for nothing, `default` for the system's sound, else one of macOS's sounds in `/System/Library/Sounds`. */
export const NOTIFICATION_SOUNDS = ["off", "default", "Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"] as const;
export type NotificationSound = (typeof NOTIFICATION_SOUNDS)[number];
export const isNotificationSound: Guard<NotificationSound> = oneOf(NOTIFICATION_SOUNDS);

/** The moment a live session came to need you: it asks you something, or it ended a turn. */
export interface SessionAlert {
	/** The page's hash that opens the session, `#session/<session id>`; it also names the session, whose newer alert replaces its older one. */
	hash: string;
	title: string;
	body: string;
	/** What it plays; absent from a page built before it, which gets the system's sound. */
	sound?: NotificationSound;
}

export const isSessionAlert: Guard<SessionAlert> = fields<SessionAlert>({ hash: isString, title: isString, body: isString, sound: optional(isNotificationSound) });

export interface DesktopBridge {
	/** Shows `count` on the Dock icon, nothing for 0. */
	badge(count: number): void;
	/** Shows `alert` as a system notification, whose click brings the window up on the session. */
	alert(alert: SessionAlert): void;
	/** Plays `sound` now, for a preview or an alert while the window has focus; absent in an app built before it. */
	playSound?(sound: NotificationSound): void;
	/** Reports the hovered or focused link's URL; an empty string clears it. Returns the subscription's cleanup; absent in an app built before it. */
	onTargetURL?(listener: (url: string) => void): () => void;
	/** Loads the page again with the current token, keeping its hash, when the token file holds a newer one; absent in an app built before it. */
	signIn?(): void;
	/** Tells the shell the ports the session of the Browser's guest `guestId` runs servers on, for {@link appAddress}; absent in an app built before it. */
	browserPorts?(guestId: number, ports: readonly number[]): void;
	/** The window hides the system's title bar, so the page draws its own, with the window's buttons inset at its left; absent in an app built before it. */
	titleBar?: boolean;
	/** The window's page can embed a session's app in a `<webview>` for its Preview; absent in an app built before it. */
	preview?: true;
}
