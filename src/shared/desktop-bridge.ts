/**
 * What the desktop shell's preload (`desktop/preload.ts`) gives the page as `window.ompDesktop`: the Dock badge and the
 * system notifications of the sessions that need you, which the shell's main process (`desktop/attention.ts`) shows,
 * and whether the page takes the window's Close key.
 */
import { fields, type Guard, isString } from "../json";

/** The name the bridge takes on `window`; absent in a browser. */
export const DESKTOP_BRIDGE = "ompDesktop";
export const BADGE_CHANNEL = "omp-agents:badge";
export const ALERT_CHANNEL = "omp-agents:alert";
export const OWNS_CLOSE_CHANNEL = "omp-agents:owns-close";
export const TARGET_URL_CHANNEL = "omp-agents:target-url";

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
	/** Whether the page handles Cmd+W (Ctrl+W) itself, so the window's Close menu item lets it through; absent in an app built before it. */
	ownsClose?(owns: boolean): void;
	/** Reports the hovered or focused link's URL; an empty string clears it. Returns the subscription's cleanup. */
	onTargetURL(listener: (url: string) => void): () => void;
}
