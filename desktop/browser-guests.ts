/**
 * The Browser's `<webview>` guests of the dashboard window: what each gets when it attaches, where its navigations and
 * new windows go, the ports its session and other servers listen on, which the page reports so a sign-in comes back
 * to the session's server, the **Screen size** each emulates, and the captures of what it shows that the page asks for.
 */
import type { BrowserWindow, WebContents, WebPreferences } from "electron";
import {
	appAddress,
	BROWSER_CAPTURE_CHANNEL,
	BROWSER_PORTS_CHANNEL,
	BROWSER_SCREEN_CHANNEL,
	type BrowserPorts,
	type BrowserScreen,
	isBrowserScreen,
	isLoopbackUrl,
	isWebUrl,
	PREVIEW_PARTITION,
	screenOf,
} from "../src/shared/desktop-bridge";

/** A guest of the Browser, the ports its session and other servers listen on, and the screen it emulates, `null` before the page asked for one. */
interface BrowserApp {
	guest: WebContents;
	ports: BrowserPorts;
	screen: BrowserScreen | null;
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

/**
 * Has `app`'s guest emulate `next` through the DevTools protocol: its size, pixel density, touch screen, orientation,
 * and user agent, or none for `fit`. Turning picking on or off only switches whether the mouse acts as a finger, so the
 * app keeps its layout and state; any other change starts again from no emulation, which detaching restores.
 * The page names the size once the guest's first page is ready, so a guest that opens on a size loads that page again
 * under it, as a script reading the user agent or touch support at load would otherwise see the window's.
 */
function emulate(app: BrowserApp, next: BrowserScreen): void {
	const before = app.screen;
	const screen = screenOf(next);
	const tools = app.guest.debugger;
	app.screen = next;
	const send = (method: string, params: object): Promise<unknown> => tools.sendCommand(method, params).catch(() => {});
	if (screen && before?.size === next.size && before.landscape === next.landscape && tools.isAttached()) {
		if (screen.device.touch) void send("Emulation.setEmitTouchEventsForMouse", { enabled: !next.picking, configuration: "mobile" });
		return;
	}
	if (tools.isAttached()) tools.detach();
	if (!screen) return;
	try {
		tools.attach("1.3");
	} catch {
		// Another debugger holds the guest: it shows the app as it fits.
		app.screen = null;
		return;
	}
	const { device, width, height } = screen;
	const landscape = width > height;
	const sent = [send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		screenWidth: width,
		screenHeight: height,
		deviceScaleFactor: device.deviceScaleFactor,
		mobile: device.touch,
		...(device.touch && { screenOrientation: landscape ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } }),
	})];
	if (device.touch) {
		sent.push(send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }));
		sent.push(send("Emulation.setEmitTouchEventsForMouse", { enabled: !next.picking, configuration: "mobile" }));
	}
	if (device.agent) sent.push(send("Emulation.setUserAgentOverride", device.agent));
	// The guest's own reload: the protocol's `Page.reload` from a guest reloads the dashboard that embeds it.
	if (before === null) void Promise.all(sent).then(() => app.screen === next && !app.guest.isDestroyed() && app.guest.reload());
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
		const app: BrowserApp = { guest, ports: { session: [], other: [] }, screen: null };
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
	contents.ipc.on(BROWSER_SCREEN_CHANNEL, (event, guestId: unknown, screen: unknown) => {
		const app = typeof guestId === "number" ? apps.get(guestId) : undefined;
		if (app && isDashboard(event.senderFrame?.url ?? "") && isBrowserScreen(screen)) emulate(app, screen);
	});
	contents.ipc.handle(BROWSER_CAPTURE_CHANNEL, async (event, guestId: unknown) => {
		const app = typeof guestId === "number" ? apps.get(guestId) : undefined;
		if (!app || !isDashboard(event.senderFrame?.url ?? "")) return null;
		const image = await app.guest.capturePage();
		if (image.isEmpty()) return null;
		// At a screen size, the picture keeps its CSS size at 1×, whatever pixel density the window or the device has.
		const screen = app.screen && screenOf(app.screen);
		return (screen ? image.resize({ width: screen.width, quality: "best" }) : image).toPNG();
	});
}
