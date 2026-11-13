/**
 * The desktop shell: the dashboard in a native window. It starts the server, from the app's resources when packaged or
 * from this checkout otherwise, or uses an omp-agents server that already listens on the port. It opens another
 * omp-agents server's page in an app of its own, and every other address in the default browser.
 */
// First: a packaged app takes the login shell's environment before `src/paths.ts` reads it.
import { refreshExecutableEnv } from "./shell-env";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	app,
	BrowserWindow,
	type ContextMenuParams,
	clipboard,
	dialog,
	globalShortcut,
	ipcMain,
	Menu,
	type MenuItem,
	type MenuItemConstructorOptions,
	type Rectangle,
	screen,
	session,
	shell,
	type WebContents,
} from "electron";
import { errorText, isObject, num } from "../src/json";
import { ACCESS_CHANNEL, INSTALL_STARTER_KIT_CHANNEL, isWebUrl, OPEN_DASHBOARD_CHANNEL, PICK_DIRECTORY_CHANNEL, PREVIEW_PARTITION, SIGN_IN_CHANNEL, type StarterKitInstallResult, TARGET_URL_CHANNEL } from "../src/shared/desktop-bridge";
import { tokenFile } from "../src/paths";
import { dashboardHosts, originOf, portFromEnv, QUICK_TODO_EVENT } from "../src/server/address";
import { helloProof, loadToken, pageAccess } from "../src/server/auth";
import { showAttention } from "./attention";
import { trackBrowserGuests } from "./browser-guests";
import { ServerSupervisor, type SupervisorEvent } from "./server-supervisor";
import { startUpdates, type Updates } from "./updates";
import { OMP_INSTALL_COMMAND } from "../src/shared/startup";

/** The port and hash of `url` when it names an omp-agents page, `http://127.0.0.1:<port>/` with any hash, under any name the server answers to; else `null`. */
function dashboardPageOf(url: string): { port: number; hash: string } | null {
	const parsed = URL.parse(url);
	if (parsed?.protocol !== "http:" || parsed.pathname !== "/" || parsed.port === "") return null;
	const port = Number(parsed.port);
	return dashboardHosts(port).includes(parsed.host) ? { port, hash: parsed.hash } : null;
}

/**
 * The page the app was launched on, `bun run desktop http://127.0.0.1:<port>/#…`, as {@link openOwnApp} launches it: the
 * app then shows that port's server, such as an agent's smoke server, and never starts one of its own there.
 */
const LAUNCH_PAGE = process.argv.slice(1).map(dashboardPageOf).find(page => page !== null) ?? null;
const PORT = LAUNCH_PAGE?.port ?? portFromEnv();
const ORIGIN = originOf(PORT);
/** What scripts/build-desktop-artifact.ts built, which electron-builder copies into the bundle; `null` when the shell runs from a checkout. */
const RESOURCES = app.isPackaged ? join(process.resourcesPath, "server") : null;
/** The checkout this shell runs when not packaged: Electron runs the app in its `desktop/` directory. */
const REPO_DIR = resolve(app.getAppPath(), "..");
/**
 * The server: the bundled script on the Bun the app ships when packaged, else the checkout's source on the PATH's Bun.
 * omp's sessions run on the same Bun, as the server starts them through `process.execPath` (src/omp/install.ts).
 */
const SERVER = RESOURCES
	? { bun: join(RESOURCES, "bin", "bun"), script: join(RESOURCES, "server.js"), cwd: homedir(), env: { OMP_AGENTS_RESOURCES: RESOURCES } }
	: { bun: "bun", script: join(REPO_DIR, "src", "server.ts"), cwd: REPO_DIR, env: {} };
/** The omp starter kit's installer, which the app menu runs. */
const KIT_INSTALLER = RESOURCES ? join(RESOURCES, "templates", "omp", "install.js") : join(REPO_DIR, "templates", "omp", "install.ts");
/** Where `bun run desktop`'s Open at Login wrote its LaunchAgents, before the packaged app used its own login item. */
const OLD_LOGIN_AGENTS = join(homedir(), "Library", "LaunchAgents");
const OLD_LOGIN_AGENT = /^dev\.omp-agents\.desktop\.port-\d+\.plist$/;
const PROBE_TIMEOUT_MS = 2_000;
/** The error page's Retry link, which never loads: `will-navigate` catches it. */
const RETRY_URL = "omp-agents:retry";
const COPY_OMP_URL = "omp-agents:copy-omp-install";
/** A navigation that another one replaced, which is no failure. */
const ERR_ABORTED = -3;
const IS_MAC = process.platform === "darwin";
/** `icon.svg` rendered at 1024 px; Electron reads no SVG. */
const ICON = join(app.getAppPath(), "icon.png");
/** `preload.ts` as `bun run build` bundles it. */
const PRELOAD = join(app.getAppPath(), "dist", "preload.cjs");
/** `preview-preload.ts` as `bun run build` bundles it, the preload of every webview the page attaches. */
const PREVIEW_PRELOAD = join(app.getAppPath(), "dist", "preview-preload.cjs");
const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };
/** Brings the window up with the command palette open on Create todo, from any app. */
const QUICK_TODO_SHORTCUT = "Alt+Shift+CommandOrControl+T";
/** `OMP_AGENTS_HEADLESS=1` keeps the window hidden and the app out of the Dock, without notifications, sounds, or the quick-capture shortcut, for agents' smoke checks, which drive it over CDP. */
const HEADLESS = process.env.OMP_AGENTS_HEADLESS === "1";

// Each port is its own server, so each gets its own localStorage, window bounds, and single-instance lock.
app.setPath("userData", join(app.getPath("userData"), `port-${PORT}`));
const BOUNDS_FILE = join(app.getPath("userData"), "window.json");

/** The server this shell starts when nothing listens on the port; a checkout's server rolls back an update whose build does not start. */
const supervisor = new ServerSupervisor({ command: { bun: SERVER.bun, args: [SERVER.script], cwd: SERVER.cwd, env: SERVER.env, port: PORT }, checkout: RESOURCES ? null : REPO_DIR });
let quitting = false;

/** Whether `url` is the dashboard's own page, under any name the server answers to. */
function isDashboard(url: string): boolean {
	const parsed = URL.parse(url);
	return parsed?.protocol === "http:" && dashboardHosts(PORT).includes(parsed.host);
}

/** What the dashboard's own page may use: its Copy buttons and a video's full screen. */
const DASHBOARD_PERMISSIONS: ReadonlySet<string> = new Set(["clipboard-sanitized-write", "fullscreen"]);

/** Whether `contents` may use `permission`: only the dashboard, and only what {@link DASHBOARD_PERMISSIONS} names. */
const permitted = (contents: WebContents | null, permission: string): boolean => contents !== null && DASHBOARD_PERMISSIONS.has(permission) && isDashboard(contents.getURL());

/** Whether `contents` may use `permission` in the Browser: only a webview the dashboard attached, and only to copy, for the app's own Copy buttons. */
const previewPermitted = (contents: WebContents | null, permission: string): boolean =>
	permission === "clipboard-sanitized-write" && contents?.getType() === "webview" && isDashboard(contents.hostWebContents?.getURL() ?? "");

/**
 * Who answers on `port`. `ours`: an omp-agents server that holds this token, since only it can answer
 * `/api/hello` with {@link helloProof} for a fresh nonce. `free`: nothing listens. `taken`: anything else. The probe
 * sends no token, so a program that took the port learns nothing from it.
 */
async function probe(token: string, port = PORT): Promise<"ours" | "free" | "taken"> {
	const nonce = randomBytes(24).toString("base64url");
	try {
		const res = await fetch(`${originOf(port)}/api/hello?nonce=${nonce}`, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		const body: unknown = await res.json().catch(() => null);
		return res.ok && isObject(body) && body.proof === helloProof(token, port, nonce) ? "ours" : "taken";
	} catch (err) {
		const cause = isObject(err) && isObject(err.cause) ? err.cause : undefined;
		return cause?.code === "ECONNREFUSED" ? "free" : "taken";
	}
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, ch => HTML_ESCAPES[ch] ?? ch);

/** A page of the shell's own, for while the dashboard cannot show. */
const notice = (title: string, body = ""): string =>
	`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>omp agents</title>
<style>:root{color-scheme:light dark;font:15px system-ui}body{max-width:44rem;margin:4rem auto;padding:0 1.5rem}
pre{font-size:12px;white-space:pre-wrap;padding:.75rem;border-radius:6px;background:color-mix(in srgb,currentColor 8%,transparent)}</style>
<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}`)}`;

/** Whether `url` is one of {@link notice}'s pages, the only pages whose links the shell acts on. */
const isNotice = (url: string): boolean => url.startsWith("data:text/html");

function showError(win: BrowserWindow, title: string, detail: string): void {
	const log = supervisor.log.length ? `<pre>${escapeHtml(supervisor.log.join("\n"))}</pre>` : "";
	void win.loadURL(notice(title, `<p>${escapeHtml(detail)}</p>${log}<p><a href="${RETRY_URL}">Retry</a></p>`));
}

/** This page needs no server, token, or renderer privileges. Its two actions carry no user input. */
async function showOmpMissing(win: BrowserWindow): Promise<void> {
	// Checked off the main thread, which `spawnSync` would block for up to 2 s.
	const { promise: bun, resolve: ran } = Promise.withResolvers<boolean>();
	execFile("bun", ["--version"], { timeout: 2_000 }, err => ran(!err));
	const prerequisite = await bun
		? "<p>Run this command in your terminal. It needs Bun.</p>"
		: '<p>Install <a href="https://bun.sh">Bun</a> first, then run this command in your terminal.</p>';
	const detail = supervisor.log.length ? `<details><summary>Technical details</summary><pre>${escapeHtml(supervisor.log.join("\n"))}</pre></details>` : "";
	void win.loadURL(notice("Install omp to get started", `<p>omp agents uses omp to run your sessions.</p>${prerequisite}<pre>${escapeHtml(OMP_INSTALL_COMMAND)}</pre><p><a href="${COPY_OMP_URL}" aria-live="polite">Copy command</a> · <a href="${RETRY_URL}">Retry</a></p><p>Once installation finishes, Retry looks for omp again. Nothing is installed automatically.</p>${detail}`));
}

/** Shows what the supervisor tells: the dashboard each time its server listens, unless the window shows it already, or why it stopped trying. */
function showServerEvent(win: BrowserWindow, event: SupervisorEvent): void {
	if (quitting || win.isDestroyed()) return;
	switch (event.kind) {
		case "listening":
			if (!isDashboard(win.webContents.getURL())) win.loadURL(`${ORIGIN}/`).catch(() => {});
			return;
		case "failed":
			return showError(win, event.title, event.detail);
		case "omp-missing":
			return void showOmpMissing(win);
		default: {
			const never: never = event;
			return never;
		}
	}
}

/** Uses the server on the port, or starts one unless the app was launched on a page; the dashboard loads once a server listens, and the preload signs it in with the token. */
async function connect(win: BrowserWindow): Promise<void> {
	void win.loadURL(notice("Starting omp agents…"));
	let found: Awaited<ReturnType<typeof probe>>;
	try {
		// The same call the server makes: whichever runs first creates the token, and both read the same one.
		found = await probe(loadToken(tokenFile));
	} catch (err) {
		showError(win, "The server did not start", errorText(err));
		return;
	}
	if (found === "taken") {
		showError(
			win,
			`Port ${PORT} is taken`,
			`Something other than omp-agents answers on ${ORIGIN}, or an omp-agents server that is older than this app or started before ${tokenFile} changed. Stop it, or start the app with another PORT.`,
		);
		return;
	}
	if (found === "free" && LAUNCH_PAGE) {
		showError(win, `Nothing answers on ${ORIGIN}`, "This window shows a server started elsewhere, such as an agent's test server, and starts none of its own. Start that server again, then Retry.");
		return;
	}
	if (found === "free") return supervisor.start(event => showServerEvent(win, event));
	// A failed load reaches `did-fail-load`, which shows it.
	win.loadURL(`${ORIGIN}/${LAUNCH_PAGE?.hash ?? ""}`).catch(() => {});
}

/**
 * Opens `url` in an app of its own when it is the page of another omp-agents server on this computer that holds this
 * token, such as an agent's smoke server, which no browser can sign in to; answers whether it did. The app of that
 * port starts on `url`, or, when it already runs, shows it.
 */
async function openOwnApp(url: string): Promise<boolean> {
	const page = dashboardPageOf(url);
	if (page === null || page.port === PORT || (await probe(loadToken(tokenFile), page.port)) !== "ours") return false;
	const target = `${originOf(page.port)}/${page.hash}`;
	spawn(process.execPath, app.isPackaged ? [target] : [app.getAppPath(), target], { detached: true, stdio: "ignore" }).unref();
	return true;
}

/** Opens a web address in an app of its own when {@link openOwnApp} takes it, else in the default browser; any other scheme goes nowhere. */
function openOutside(url: string): void {
	if (!isWebUrl(url)) return;
	void openOwnApp(url).then(opened => {
		if (!opened) void shell.openExternal(url);
	});
}

/** `url` as the window loads it when it names the dashboard's page, `${ORIGIN}/` with any hash, else `null`. */
function dashboardPage(url: string): string | null {
	const parsed = URL.parse(url);
	return parsed?.origin === ORIGIN && parsed.pathname === "/" ? `${ORIGIN}/${parsed.hash}` : null;
}

/** The bounds the window had when it last hid or closed; only the size when no display shows its top-left corner any more. */
function savedBounds(): Partial<Rectangle> {
	let saved: unknown;
	try {
		saved = JSON.parse(readFileSync(BOUNDS_FILE, "utf8"));
	} catch {
		return {};
	}
	if (!isObject(saved)) return {};
	const [x, y, width, height] = [num(saved.x), num(saved.y), num(saved.width), num(saved.height)];
	if (x === undefined || y === undefined || width === undefined || height === undefined) return {};
	const { workArea } = screen.getDisplayMatching({ x, y, width, height });
	const visible = x >= workArea.x && y >= workArea.y && x < workArea.x + workArea.width && y < workArea.y + workArea.height;
	return visible ? { x, y, width, height } : { width, height };
}

/** Copy Image on an image; copy for selected text; cut, copy, paste, and spelling suggestions in a text field; nothing elsewhere. */
function contextMenuItems(params: ContextMenuParams, contents: WebContents): MenuItemConstructorOptions[] {
	if (params.mediaType === "image" && params.hasImageContents) return [{ label: "Copy Image", click: () => contents.copyImageAt(params.x, params.y) }];
	if (!params.isEditable) return params.selectionText ? [{ role: "copy" }] : [];
	const spelling = params.dictionarySuggestions.map(word => ({ label: word, click: () => contents.replaceMisspelling(word) }));
	return [...spelling, ...(spelling.length ? [SEPARATOR] : []), { role: "cut" }, { role: "copy" }, { role: "paste" }, SEPARATOR, { role: "selectAll" }];
}

/** Closing hides the window on macOS, so the server keeps running; only quitting stops it, and the sessions it started run on. */
function hideInsteadOfClose(win: BrowserWindow, event: Electron.Event): void {
	event.preventDefault();
	if (!win.isFullScreen()) return win.hide();
	win.once("leave-full-screen", () => win.hide());
	win.setFullScreen(false);
}

function createWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 640,
		minHeight: 480,
		...savedBounds(),
		show: false,
		title: "omp agents",
		// On macOS the page draws the title bar: these buttons sit over the sidebar's top row, which leaves room after them, and the header's tabs drag the window.
		// The buttons are 14px tall, so `y` 17 centers them in the page header's 48px; `titleBarOverlay` tells the page where they end, `env(titlebar-area-x)`, since their width differs across macOS versions.
		...(IS_MAC ? { titleBarStyle: "hidden" as const, titleBarOverlay: true, trafficLightPosition: { x: 14, y: 17 } } : {}),
		// macOS takes the app's icon from the Dock instead.
		icon: ICON,
		webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: PRELOAD, webviewTag: true },
	});

	const contents = win.webContents;
	const sendTargetURL = (url: string): void => {
		if (isDashboard(contents.getURL())) contents.send(TARGET_URL_CHANNEL, url);
	};
	contents.on("update-target-url", (_event, url) => sendTargetURL(url));
	contents.on("did-start-navigation", details => {
		if (details.isMainFrame) sendTargetURL("");
	});
	win.on("blur", () => sendTargetURL(""));
	// A browser cannot sign in, so a session link opened as a new window, such as by a middle-click, opens here instead.
	contents.setWindowOpenHandler(({ url }) => {
		const page = dashboardPage(url);
		if (page) win.loadURL(page).catch(() => {});
		else openOutside(url);
		return { action: "deny" };
	});
	contents.on("will-navigate", event => {
		if (event.url === COPY_OMP_URL && isNotice(contents.getURL())) {
			event.preventDefault();
			clipboard.writeText(OMP_INSTALL_COMMAND);
			const link = `document.querySelector('a[href="${COPY_OMP_URL}"]')`;
			void contents.executeJavaScript(`{ const a = ${link}; a.textContent = 'Copied'; setTimeout(() => { a.textContent = 'Copy command'; }, 2000); }`);
			return;
		}
		if (event.url === RETRY_URL && isNotice(contents.getURL())) {
			event.preventDefault();
			refreshExecutableEnv();
			void connect(win);
			return;
		}
		if (isDashboard(event.url)) return;
		event.preventDefault();
		openOutside(event.url);
	});
	// The dashboard's own page failed to load: the server it used stopped, or never answered.
	contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
		if (isMainFrame && code !== ERR_ABORTED && isDashboard(url)) showError(win, "The dashboard did not load", `${ORIGIN} answered ${description}.`);
	});
	contents.on("context-menu", (_event, params) => {
		const items = contextMenuItems(params, contents);
		if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
	});
	trackBrowserGuests(win, { preload: PREVIEW_PRELOAD, isDashboard, openOutside });
	/** The token the preload last wrote into the page, so a sign-in reloads the page only for a token it has not tried. */
	let handedOut: string | null = null;
	ipcMain.on(ACCESS_CHANNEL, event => {
		let access: Record<string, string> | null = null;
		if (event.sender === contents && isDashboard(event.senderFrame?.url ?? "")) {
			handedOut = loadToken(tokenFile);
			access = pageAccess(handedOut);
		}
		event.returnValue = access;
	});
	// The server took no token the page holds: the token file changed since the page loaded, or the server holds another
	// token, as one started before the file changed does. Reloading with the same token again would loop.
	ipcMain.on(SIGN_IN_CHANNEL, event => {
		const url = event.senderFrame?.url ?? "";
		if (event.sender !== contents || !isDashboard(url) || loadToken(tokenFile) === handedOut) return;
		win.loadURL(`${ORIGIN}/${URL.parse(url)?.hash ?? ""}`).catch(() => {});
	});
	ipcMain.handle(PICK_DIRECTORY_CHANNEL, async event => {
		if (event.sender !== contents || !isDashboard(event.senderFrame?.url ?? "")) return null;
		const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
		return canceled ? null : (filePaths[0] ?? null);
	});
	ipcMain.handle(INSTALL_STARTER_KIT_CHANNEL, (event, ...args: unknown[]) => {
		if (event.sender !== contents || event.senderFrame !== contents.mainFrame || !isDashboard(event.senderFrame?.url) || args.length !== 0) throw new Error("Starter kit installation is available only in the dashboard");
		return installStarterKit();
	});
	ipcMain.handle(OPEN_DASHBOARD_CHANNEL, (event, url: unknown) =>
		event.sender === contents && isDashboard(event.senderFrame?.url ?? "") && typeof url === "string" ? openOwnApp(url) : false,
	);

	win.on("close", event => {
		writeFileSync(BOUNDS_FILE, JSON.stringify(win.getNormalBounds()));
		if (IS_MAC && !quitting) hideInsteadOfClose(win, event);
	});
	return win;
}

/** Turns the app's login item on or off, then shows what macOS holds, so a failure leaves no wrong check mark. */
function toggleOpenAtLogin(item: MenuItem): void {
	app.setLoginItemSettings({ openAtLogin: item.checked });
	item.checked = app.getLoginItemSettings().openAtLogin;
}

let installingStarterKit: Promise<StarterKitInstallResult> | null = null;

/** One fixed installer, shared by the menu and page. User customizations are never forced. */
function installStarterKit(): Promise<StarterKitInstallResult> {
	if (installingStarterKit) return installingStarterKit;
	const { promise, resolve } = Promise.withResolvers<StarterKitInstallResult>();
	installingStarterKit = promise.finally(() => { installingStarterKit = null; });
	execFile(SERVER.bun, [KIT_INSTALLER], { cwd: SERVER.cwd, env: process.env, timeout: 120_000 }, (err, stdout, stderr) => {
		resolve({ ok: !err, message: (err ? stderr || stdout || errorText(err) : stdout).trim().slice(-16_000) });
	});
	return installingStarterKit;
}

async function installStarterKitFromMenu(): Promise<void> {
	const result = await installStarterKit();
	if (!result.ok) dialog.showErrorBox("Starter kit install failed", result.message);
	else void dialog.showMessageBox({ message: "omp starter kit installed", detail: `${result.message}\n\nNew omp sessions load it.` });
}

/** The update check, in a packaged app alone: a checkout updates through the dashboard's **Update dashboard**, which pulls it and restarts the server. */
let updates: Updates | null = null;

/** Stops the server, then installs; an install that fails starts nothing, so the window says why and its Retry starts the server again. */
async function restartToUpdate(): Promise<void> {
	if (!updates) return;
	quitting = true;
	await supervisor.stop();
	try {
		await updates.install();
	} catch (err) {
		quitting = false;
		const win = BrowserWindow.getAllWindows()[0];
		if (win) showError(win, "The update did not install", errorText(err));
	}
}

function updateItem(): MenuItemConstructorOptions[] {
	if (!updates) return [];
	const ready = updates.ready();
	return [ready ? { label: `Restart to Install ${ready}`, click: () => void restartToUpdate() } : { label: "Check for Updates…", click: () => updates?.checkNow() }];
}

/** The menu holds no shortcut the dashboard binds (web/shortcuts.ts), so every one reaches the page. */
function applicationMenu(): Menu {
	// A checkout's Electron is not an app macOS can open at login.
	// Electron sets no login item on Linux, so there the item would untick itself.
	const openAtLogin: MenuItemConstructorOptions[] = app.isPackaged && IS_MAC
		? [{ label: "Open at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: toggleOpenAtLogin }]
		: [];
	const appMenu: MenuItemConstructorOptions[] = [
		{
			label: app.name,
			submenu: [
				{ role: "about" },
				...updateItem(),
				SEPARATOR,
				...openAtLogin,
				{ label: "Install omp Starter Kit…", click: () => void installStarterKitFromMenu() },
				SEPARATOR,
				...(IS_MAC ? [{ role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, SEPARATOR] : []),
				{ role: "quit" },
			],
		},
	];
	const front: MenuItemConstructorOptions[] = IS_MAC ? [SEPARATOR, { role: "front" }] : [];
	return Menu.buildFromTemplate([
		...appMenu,
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [{ role: "reload" }, { role: "toggleDevTools" }, SEPARATOR, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, SEPARATOR, { role: "togglefullscreen" }],
		},
		{ label: "Window", role: "window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close", accelerator: "CommandOrControl+Shift+W" }, ...front] },
	]);
}

/** Removes the LaunchAgents of the checkout's former Open at Login, which would start a second copy at each login. */
function removeOldLoginAgents(): void {
	try {
		for (const name of readdirSync(OLD_LOGIN_AGENTS)) if (OLD_LOGIN_AGENT.test(name)) rmSync(join(OLD_LOGIN_AGENTS, name), { force: true });
	} catch {}
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	let win: BrowserWindow | null = null;
	const reveal = (): void => {
		if (!win || HEADLESS) return;
		win.show();
		win.focus();
	};
	// A second launch on this port, such as `openOwnApp` in another app, shows the page it was launched on.
	app.on("second-instance", (_event, argv) => {
		const page = argv.slice(1).map(dashboardPage).find(each => each !== null);
		if (page && win) win.loadURL(page).catch(() => {});
		reveal();
	});
	app.on("activate", reveal);
	app.on("window-all-closed", () => app.quit());
	app.on("before-quit", event => {
		quitting = true;
		if (!supervisor.running) return;
		// Hold the quit until the server wrote its stores and let go of its sessions, which run on for the next launch.
		event.preventDefault();
		void supervisor.stop().then(() => app.quit());
	});
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());

	app.on("will-quit", () => globalShortcut.unregisterAll());

	void app.whenReady().then(() => {
		Menu.setApplicationMenu(applicationMenu());
		session.defaultSession.setPermissionRequestHandler((contents, permission, grant) => grant(permitted(contents, permission)));
		session.defaultSession.setPermissionCheckHandler((contents, permission) => permitted(contents, permission));
		const preview = session.fromPartition(PREVIEW_PARTITION);
		preview.setPermissionRequestHandler((contents, permission, grant) => grant(previewPermitted(contents, permission)));
		preview.setPermissionCheckHandler((contents, permission) => previewPermitted(contents, permission));
		removeOldLoginAgents();
		if (app.isPackaged) updates = startUpdates(() => Menu.setApplicationMenu(applicationMenu()));
		const shown = createWindow();
		win = shown;
		void connect(shown);
		if (HEADLESS) {
			app.dock?.hide();
			return;
		}
		// The app runs from Electron's own bundle, so without this the Dock shows Electron's icon.
		app.dock?.setIcon(ICON);
		shown.once("ready-to-show", () => shown.show());
		showAttention(shown, isDashboard, reveal);
		const quickTodo = (): void => {
			reveal();
			void shown.webContents.executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(QUICK_TODO_EVENT)}))`).catch(() => {});
		};
		if (!globalShortcut.register(QUICK_TODO_SHORTCUT, quickTodo)) console.error(`omp-agents: another app holds ${QUICK_TODO_SHORTCUT}`);
	});
}
