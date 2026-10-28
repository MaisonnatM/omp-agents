/**
 * The Browser's `<webview>` guests of the dashboard window: what each gets when it attaches, where its navigations and
 * new windows go, the ports its session and other servers listen on, which the page reports so a sign-in comes back
 * to the session's server, and the captures of what it shows that the page asks for.
 */
import type { BrowserWindow, WebContents, WebPreferences } from "electron";
import { appAddress, BROWSER_CAPTURE_CHANNEL, BROWSER_PORTS_CHANNEL, type BrowserPorts, isLoopbackUrl, isWebUrl, PREVIEW_PARTITION } from "../src/shared/desktop-bridge";

/** A guest of the Browser, and the ports its session and other servers listen on. */
interface BrowserApp {
	guest: WebContents;
	ports: BrowserPorts;
}

const isPorts = (value: unknown): value is readonly number[] => Array.isArray(value) && value.every(port => Number.isInteger(port));

const GUEST_PREFS = { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: PREVIEW_PARTITION } satisfies WebPreferences;

/**
 * Keeps `contents` within the Browser's rules for `app`: a sign-in popup, a `window.open` with window features, opens
 * as a child of `win` in the Browser's session, keeping its opener, and gets these rules too; any other new window goes
 * to `openOutside`. A navigation follows any web address, so a sign-in through a provider ends here, except one to a
 * loopback port that {@link appAddress} sends to the session's server.
 */
function keepInBrowser(contents: WebContents, app: BrowserApp, win: BrowserWindow, openOutside: (url: string) => void): void {
	contents.setWindowOpenHandler(({ url, disposition }) => {
		if (disposition === "new-window" && isWebUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { parent: win, webPreferences: GUEST_PREFS } };
		openOutside(url);
		return { action: "deny" };
	});
	contents.on("did-create-window", child => keepInBrowser(child.webContents, app, win, openOutside));
	const follow = (navigation: Electron.Event<{ url: string }>): void => {
		// Other schemes go nowhere.
		if (!isWebUrl(navigation.url)) return navigation.preventDefault();
		const shown = app.guest.isDestroyed() ? [] : app.guest.navigationHistory.getAllEntries().map(entry => entry.url);
		const instead = appAddress(navigation.url, contents.getURL(), shown, app.ports);
		if (instead === null) return;
		navigation.preventDefault();
		contents.loadURL(instead).catch(() => {});
	};
	contents.on("will-navigate", follow);
	contents.on("will-redirect", follow);
}

/** Gives the Browser's guests that the dashboard in `win` attaches their preload, sandbox, partition, and rules. */
export function trackBrowserGuests(win: BrowserWindow, { preload, isDashboard, openOutside }: {
	preload: string;
	isDashboard: (url: string) => boolean;
	openOutside: (url: string) => void;
}): void {
	const contents = win.webContents;
	const apps = new Map<number, BrowserApp>();
	// Whatever the page asks, a guest gets our preload in the sandbox, its own session, and a loopback address to start on.
	contents.on("will-attach-webview", (event, prefs, params) => {
		Object.assign(prefs, { ...GUEST_PREFS, preload });
		params.partition = PREVIEW_PARTITION;
		if (!isDashboard(contents.getURL()) || !isLoopbackUrl(params.src ?? "")) event.preventDefault();
	});
	contents.on("did-attach-webview", (_event, guest) => {
		const app: BrowserApp = { guest, ports: { session: [], other: [] } };
		apps.set(guest.id, app);
		guest.once("destroyed", () => apps.delete(guest.id));
		keepInBrowser(guest, app, win, openOutside);
	});
	contents.ipc.on(BROWSER_PORTS_CHANNEL, (event, guestId: unknown, ports: unknown) => {
		const app = typeof guestId === "number" ? apps.get(guestId) : undefined;
		if (!app || !isDashboard(event.senderFrame?.url ?? "")) return;
		if (typeof ports === "object" && ports !== null && "session" in ports && "other" in ports && isPorts(ports.session) && isPorts(ports.other)) {
			app.ports = { session: ports.session, other: ports.other };
		}
	});
	contents.ipc.handle(BROWSER_CAPTURE_CHANNEL, async (event, guestId: unknown) => {
		const app = typeof guestId === "number" ? apps.get(guestId) : undefined;
		if (!app || !isDashboard(event.senderFrame?.url ?? "")) return null;
		const image = await app.guest.capturePage();
		return image.isEmpty() ? null : image.toPNG();
	});
}
