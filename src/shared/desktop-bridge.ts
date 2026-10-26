/**
 * What the desktop shell's preload (`desktop/preload.ts`) gives the page as `window.ompDesktop`: the Dock badge and the
 * system notifications of the sessions that need you, which the shell's main process (`desktop/attention.ts`) shows,
 * and the sign-in of a page that holds no token the server takes.
 */
import { fields, type Guard, isString } from "../json";

/** The name the bridge takes on `window`; absent in a page no desktop window loaded. */
export const DESKTOP_BRIDGE = "ompDesktop";
export const BADGE_CHANNEL = "omp-agents:badge";
export const ALERT_CHANNEL = "omp-agents:alert";
export const TARGET_URL_CHANNEL = "omp-agents:target-url";
export const SIGN_IN_CHANNEL = "omp-agents:sign-in";
/** Asked synchronously by the preload before the page's scripts run: the localStorage entries that sign the page in, or `null`. */
export const ACCESS_CHANNEL = "omp-agents:access";

/** The moment a live session came to need you: it asks you something, or it ended a turn. */
export interface SessionAlert {
	/** The page's hash that opens the session, `#session/<session id>`; it also names the session, whose newer alert replaces its older one. */
	hash: string;
	title: string;
	body: string;
}

export const isSessionAlert: Guard<SessionAlert> = fields<SessionAlert>({ hash: isString, title: isString, body: isString });

export interface DesktopBridge {
	/** Shows `count` on the Dock icon, nothing for 0. */
	badge(count: number): void;
	/** Shows `alert` as a system notification, whose click brings the window up on the session. */
	alert(alert: SessionAlert): void;
	/** Reports the hovered or focused link's URL; an empty string clears it. Returns the subscription's cleanup; absent in an app built before it. */
	onTargetURL?(listener: (url: string) => void): () => void;
	/** Loads the page again with the current token, keeping its hash, when the token file holds a newer one; absent in an app built before it. */
	signIn?(): void;
	/** The window hides the system's title bar, so the page draws its own, with the window's buttons inset at its left; absent in an app built before it. */
	titleBar?: boolean;
}
