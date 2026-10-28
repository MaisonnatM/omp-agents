/**
 * What the desktop shell's preload (`desktop/preload.ts`) gives the page as `window.ompDesktop`: the Dock badge and the
 * system notifications of the sessions that need you, which the shell's main process (`desktop/attention.ts`) shows,
 * the sign-in of a page that holds no token the server takes, and what the page's Preview and the shell agree on.
 */
import { arrayOf, fields, type Guard, isBoolean, isNumber, isString, oneOf, optional } from "../json";

/** The name the bridge takes on `window`; absent in a page no desktop window loaded. */
export const DESKTOP_BRIDGE = "ompDesktop";
export const BADGE_CHANNEL = "omp-agents:badge";
export const ALERT_CHANNEL = "omp-agents:alert";
export const TARGET_URL_CHANNEL = "omp-agents:target-url";
export const SOUND_CHANNEL = "omp-agents:sound";
export const SIGN_IN_CHANNEL = "omp-agents:sign-in";
/** Asked synchronously by the preload before the page's scripts run: the localStorage entries that sign the page in, or `null`. */
export const ACCESS_CHANNEL = "omp-agents:access";
/**
 * Where `desktop/preview-pick.ts` puts its {@link PreviewPicker} in the main world of the Browser's app, which the page
 * reaches through the webview's `executeJavaScript`.
 */
export const PREVIEW_PICKER_GLOBAL = "__OMP_PICK__";
/** The Browser's Select, run in the app's page, since only there can it find elements and their React components. */
export interface PreviewPicker {
	/** Turns Select on, drawing the outlines in `color`, or off, keeping the elements already selected. */
	select(on: boolean, color: string): void;
	deselect(id: number): void;
	/** Drops every selected element and turns Select off. */
	clear(): void;
	/** What the selected elements are, read through react-grab's `getElementContext`, with the hover outline hidden for the capture. */
	resolve(): Promise<PreviewElement[]>;
}
/** A selected element as the prompt gets it: the name of its React component or tag, and react-grab's text of it. */
export interface PreviewElement {
	id: number;
	name: string;
	snippet: string;
}
/** A {@link PreviewElement}, as the page checks what the picker in the app resolves, which any script there can replace. */
export const isPreviewElement: Guard<PreviewElement> = fields<PreviewElement>({ id: isNumber, name: isString, snippet: isString });
/** Where a selected element shows in the app, in its CSS pixels from the top left of what the webview shows. */
export interface PreviewElementBox {
	id: number;
	x: number;
	y: number;
	width: number;
	height: number;
}
/** The `ipc-message` channel, and the key of the app's message to its preload, of each change to Select, as a {@link PreviewSelection}. */
export const PREVIEW_SELECTION_CHANNEL = "omp-agents:preview-selection";
/** Whether Select is on, and where the selected elements show, sent again as the app scrolls. */
export interface PreviewSelection {
	selecting: boolean;
	boxes: PreviewElementBox[];
}
const isPreviewElementBox: Guard<PreviewElementBox> = fields<PreviewElementBox>({ id: isNumber, x: isNumber, y: isNumber, width: isNumber, height: isNumber });
/** A {@link PreviewSelection}, as the guest's preload checks what any script in the app can post, and the page what the preload sends. */
export const isPreviewSelection: Guard<PreviewSelection> = fields<PreviewSelection>({ selecting: isBoolean, boxes: arrayOf(isPreviewElementBox) });
/** The `ipc-message` channel on which the Browser's webview reports an Escape its app left unhandled. */
export const PREVIEW_ESCAPE_CHANNEL = "omp-agents:preview-escape";
/** The pick mode keys, V, R, D, and E, pressed in the app while Select is on, which never reach the page otherwise. */
export const PREVIEW_PICK_KEY_CHANNEL = "omp-agents:preview-pick-key";
/**
 * The keys the guest hands over on {@link PREVIEW_PICK_KEY_CHANNEL}, the shortcuts of T3 Code's pick modes: the chords
 * of the `browserPick*` shortcuts in `web/shortcuts.ts`, by which the page finds the mode.
 */
export const PICK_MODE_KEYS: readonly string[] = ["v", "r", "d", "e"];
/** Whether `target` is a text field, where a key types instead of running a shortcut, as the page's shortcuts and the Browser's preload both read it. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
/** The Preview webview's session, apart from the dashboard's, and kept across launches, so a sign-in to the app lasts. */
export const PREVIEW_PARTITION = "persist:omp-preview";
/** The page's report of a Browser's {@link BrowserPorts}, for the shell's {@link appAddress}. */
export const BROWSER_PORTS_CHANNEL = "omp-agents:browser-ports";
/** The page's request for a PNG of what a Browser's guest shows, answered by the shell. */
export const BROWSER_CAPTURE_CHANNEL = "omp-agents:browser-capture";

/** The ports a Browser's session runs servers on, and the ones other servers on this computer listen on. */
export interface BrowserPorts {
	session: readonly number[];
	/** Every listener but the session's and another checkout of its app, such as the app's API, which a redirect stays on. */
	other: readonly number[];
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `url` is an http or https address. */
export function isWebUrl(url: string): boolean {
	const protocol = URL.parse(url)?.protocol;
	return protocol === "http:" || protocol === "https:";
}

/** Whether `url` is an http or https address on this computer, the only kind the Preview loads. */
export function isLoopbackUrl(url: string): boolean {
	return isWebUrl(url) && LOOPBACK_HOSTS.has(URL.parse(url)?.hostname ?? "");
}

/** The port of `url` when it is on this computer at one of `ports`, else `null`. */
function portIn(url: string, ports: readonly number[]): number | null {
	const parsed = URL.parse(url);
	if (parsed === null || !isLoopbackUrl(url)) return null;
	const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
	return ports.includes(port) ? port : null;
}

/**
 * Where the Browser goes instead of `target`, leaving `from`, having shown `shown` oldest first: the same address on the
 * session's port it last showed, when `target` is on this computer at a port neither the session nor another server
 * listens on, or one another checkout of the session's app listens on, and `from` is a page off this computer, such as
 * a sign-in provider, or one of the session's servers. An app whose sign-in names the port it usually runs on, such as
 * `localhost:3000`, so comes back to the session's server, while its API's callback, such as on `localhost:8000`, stays
 * where it is. `null` loads `target` as is.
 */
export function appAddress(target: string, from: string, shown: readonly string[], ports: BrowserPorts): string | null {
	if (!isLoopbackUrl(target) || portIn(target, ports.session) !== null || portIn(target, ports.other) !== null) return null;
	if (isLoopbackUrl(from) && portIn(from, ports.session) === null) return null;
	const home = shown.findLast(url => portIn(url, ports.session) !== null);
	if (home === undefined) return null;
	const to = new URL(target);
	to.port = String(portIn(home, ports.session));
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
	/** Tells the shell the {@link BrowserPorts} of the Browser's guest `guestId`, for {@link appAddress}; absent in an app built before it. */
	browserPorts?(guestId: number, ports: BrowserPorts): void;
	/** A PNG of what the Browser's guest `guestId` shows, at the screen's pixel density, or `null` when it shows nothing; absent in an app built before it. */
	captureBrowser?(guestId: number): Promise<Uint8Array | null>;
	/** The window hides the system's title bar, so the page draws its own, with the window's buttons inset at its left; absent in an app built before it. */
	titleBar?: boolean;
	/** The window's page can embed a session's app in a `<webview>` for its Preview; absent in an app built before it. */
	preview?: true;
}
