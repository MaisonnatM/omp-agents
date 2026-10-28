/**
 * The Browser's `<webview>` guests of the dashboard window: what each gets when it attaches, where its navigations and
 * new windows go, and the ports its session runs servers on, which the page reports so a sign-in comes back to them.
 */
import { type BrowserWindow, ipcMain, type WebContents, type WebPreferences } from "electron";
import { appAddress, BROWSER_PORTS_CHANNEL, isLoopbackUrl, isWebUrl, PREVIEW_PARTITION } from "../src/shared/desktop-bridge";

/** A guest of the Browser, and the ports its session runs servers on. */
interface BrowserApp {
	guest: WebContents;
	ports: ReadonlySet<number>;
}

const GUEST_PREFS = { contextIsolation: true, sandbox: true, nodeIntegration: false, partition: PREVIEW_PARTITION } satisfies WebPreferences;

/**
 * Keeps `contents` within the Browser's rules for `app`: a sign-in popup, a `window.open` with window features, opens
 * as a child of `win` in the Browser's session, keeping its opener, and gets these rules too; any other new window goes
 * to `openOutside`. A navigation follows any web address, so a sign-in through a provider ends here, except one to a
 * loopback port the session runs nothing on, which {@link appAddress} sends to the session's server.
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
		const app: BrowserApp = { guest, ports: new Set() };
		apps.set(guest.id, app);
		guest.once("destroyed", () => apps.delete(guest.id));
		keepInBrowser(guest, app, win, openOutside);
	});
	ipcMain.on(BROWSER_PORTS_CHANNEL, (event, guestId: unknown, ports: unknown) => {
		const app = typeof guestId === "number" ? apps.get(guestId) : undefined;
		if (!app || event.sender !== contents || !isDashboard(event.senderFrame?.url ?? "")) return;
		if (Array.isArray(ports) && ports.every(port => Number.isInteger(port))) app.ports = new Set(ports);
	});
}
