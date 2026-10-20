/**
 * The desktop shell: the dashboard in a native window. It starts the server, from the app's resources when packaged or
 * from this checkout otherwise, or uses an omp-agents server that already listens on the port, and opens every other
 * address in the default browser.
 */
// First: a packaged app takes the login shell's environment before `src/paths.ts` reads it.
import "./shell-env";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";
import {
	app,
	BrowserWindow,
	type ContextMenuParams,
	dialog,
	globalShortcut,
	Menu,
	type MenuItem,
	type MenuItemConstructorOptions,
	type Rectangle,
	screen,
	shell,
	type WebContents,
} from "electron";
import { errorText, isObject, num } from "../src/json";
import { tokenFile } from "../src/paths";
import { dashboardHosts, isListeningLine, originOf, portFromEnv, QUICK_TODO_EVENT } from "../src/server/address";
import { loadToken } from "../src/server/auth";
import { showAttention } from "./attention";
import { startUpdates, type Updates } from "./updates";

const PORT = portFromEnv();
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
/** The server builds the page before it listens. */
const READY_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;
/** How long the server gets after SIGTERM to write its stores and let go of its sessions, which keep running. */
const STOP_TIMEOUT_MS = 10_000;
/** The server output an error page shows. */
const LOG_LINES = 40;
/** The error page's Retry link, which never loads: `will-navigate` catches it. */
const RETRY_URL = "omp-agents:retry";
/** A navigation that another one replaced, which is no failure. */
const ERR_ABORTED = -3;
const IS_MAC = process.platform === "darwin";
/** `icon.svg` rendered at 1024 px; Electron reads no SVG. */
const ICON = join(app.getAppPath(), "icon.png");
/** `preload.ts` as `bun run build` bundles it. */
const PRELOAD = join(app.getAppPath(), "dist", "preload.cjs");
const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };
/** Brings the window up with the command palette open on Create todo, from any app. */
const QUICK_TODO_SHORTCUT = "Alt+Shift+CommandOrControl+T";

// Each port is its own server, so each gets its own cookie, localStorage, window bounds, and single-instance lock.
app.setPath("userData", join(app.getPath("userData"), `port-${PORT}`));
const BOUNDS_FILE = join(app.getPath("userData"), "window.json");

/** The server this shell started, while it runs. `null` when the shell uses a server started elsewhere. */
let server: ChildProcess | null = null;
const serverLog: string[] = [];
let quitting = false;

/** Whether `url` is the dashboard's own page, under any name the server answers to. */
function isDashboard(url: string): boolean {
	const parsed = URL.parse(url);
	return parsed?.protocol === "http:" && dashboardHosts(PORT).includes(parsed.host);
}

/**
 * Who answers on the port. `ours`: an omp-agents server that holds this token, since only it answers `?token=` with
 * the cookie. `free`: nothing listens. `taken`: anything else.
 */
async function probe(token: string): Promise<"ours" | "free" | "taken"> {
	try {
		const res = await fetch(`${ORIGIN}/?token=${token}`, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
		await res.body?.cancel();
		return res.status === 302 && res.headers.has("set-cookie") ? "ours" : "taken";
	} catch (err) {
		const cause = isObject(err) && isObject(err.cause) ? err.cause : undefined;
		return cause?.code === "ECONNREFUSED" ? "free" : "taken";
	}
}

/** Copies one of the server's output streams through, and keeps its last {@link LOG_LINES} lines for an error page. */
function tail(stream: Readable, out: NodeJS.WriteStream): Interface {
	stream.pipe(out);
	const lines = createInterface({ input: stream });
	lines.on("line", line => {
		serverLog.push(line);
		if (serverLog.length > LOG_LINES) serverLog.shift();
	});
	return lines;
}

/**
 * Starts the server and resolves once it listens, or rejects with why it did not. It listens when it prints
 * {@link isListeningLine}: an answer on the port alone could come from another server that took the port first.
 */
function launch(): Promise<ChildProcess> {
	serverLog.length = 0;
	const child = spawn(SERVER.bun, [SERVER.script], {
		cwd: SERVER.cwd,
		// The server exits when its stdin ends, which it does however this process dies.
		env: { ...process.env, ...SERVER.env, PORT: String(PORT), OMP_AGENTS_PARENT: "stdin" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	const { promise, resolve: listening, reject } = Promise.withResolvers<ChildProcess>();
	const deadline = setTimeout(() => {
		child.kill("SIGTERM");
		reject(new Error(`The server did not listen within ${READY_TIMEOUT_MS / 1000} s.`));
	}, READY_TIMEOUT_MS);
	void promise.finally(() => clearTimeout(deadline)).catch(() => {});
	tail(child.stdout, process.stdout).on("line", line => {
		if (isListeningLine(line, PORT)) listening(child);
	});
	tail(child.stderr, process.stderr);
	child.once("error", (err: NodeJS.ErrnoException) => reject(new Error(err.code === "ENOENT" ? `\`${SERVER.bun}\` is not found.` : err.message)));
	child.once("exit", (code, signal) => reject(new Error(`The server exited with ${signal ?? `code ${code}`}.`)));
	return promise;
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, ch => HTML_ESCAPES[ch] ?? ch);

/** A page of the shell's own, for while the dashboard cannot show. */
const notice = (title: string, body = ""): string =>
	`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>omp agents</title>
<style>:root{color-scheme:light dark;font:15px system-ui}body{max-width:44rem;margin:4rem auto;padding:0 1.5rem}
pre{font-size:12px;white-space:pre-wrap;padding:.75rem;border-radius:6px;background:color-mix(in srgb,currentColor 8%,transparent)}</style>
<h1 style="font-size:20px">${escapeHtml(title)}</h1>${body}`)}`;

function showError(win: BrowserWindow, title: string, detail: string): void {
	const log = serverLog.length ? `<pre>${escapeHtml(serverLog.join("\n"))}</pre>` : "";
	void win.loadURL(notice(title, `<p>${escapeHtml(detail)}</p>${log}<p><a href="${RETRY_URL}">Retry</a></p>`));
}

/** Uses the server on the port, or starts one, then signs the window in with the token. */
async function connect(win: BrowserWindow): Promise<void> {
	void win.loadURL(notice("Starting omp agents…"));
	let token: string;
	try {
		// The same call the server makes: whichever runs first creates the token, and both read the same one.
		token = loadToken(tokenFile);
		const found = await probe(token);
		if (found === "taken") {
			showError(
				win,
				`Port ${PORT} is taken`,
				`Something other than omp-agents answers on ${ORIGIN}, or an omp-agents server that started before ${tokenFile} changed. Stop it, or start the app with another PORT.`,
			);
			return;
		}
		if (found === "free") {
			const child = await launch();
			server = child;
			child.once("exit", (code, signal) => {
				if (server === child) server = null;
				if (!quitting) showError(win, "The server stopped", `It exited with ${signal ?? `code ${code}`}.`);
			});
		}
	} catch (err) {
		showError(win, "The server did not start", errorText(err));
		return;
	}
	// A failed load reaches `did-fail-load`, which shows it.
	win.loadURL(`${ORIGIN}/?token=${token}`).catch(() => {});
}

/** Opens a web address in the default browser; any other scheme goes nowhere. */
function openOutside(url: string): void {
	const protocol = URL.parse(url)?.protocol;
	if (protocol === "http:" || protocol === "https:") void shell.openExternal(url);
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

/** Closing hides the window on macOS: quitting stops the server, and with it every session the dashboard started. */
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
		// macOS takes the app's icon from the Dock instead.
		icon: ICON,
		webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: PRELOAD },
	});
	win.once("ready-to-show", () => win.show());

	const contents = win.webContents;
	contents.setWindowOpenHandler(({ url }) => {
		// An empty address is a tab the page means to send somewhere later; the page opens the address itself instead.
		if (url && url !== "about:blank") openOutside(url);
		return { action: "deny" };
	});
	contents.on("will-navigate", event => {
		if (event.url === RETRY_URL) {
			event.preventDefault();
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

/** Runs the starter kit's installer, which writes into omp's agent directory, and shows what it printed. */
function installStarterKit(): void {
	execFile(SERVER.bun, [KIT_INSTALLER], { env: process.env, timeout: 120_000 }, (err, stdout, stderr) => {
		if (err) dialog.showErrorBox("Starter kit install failed", `${stderr || errorText(err)}`.trim());
		else void dialog.showMessageBox({ message: "omp starter kit installed", detail: `${stdout.trim()}\n\nNew omp sessions load it.` });
	});
}

/** The update check, in a packaged app alone: a checkout updates through the dashboard's **Update dashboard**, which pulls it and restarts the server. */
let updates: Updates | null = null;

/** Stops the server this shell started, letting it end its sessions first; resolves at once when it started none. */
function stopServer(): Promise<void> {
	const child = server;
	if (!child) return Promise.resolve();
	const { promise, resolve: stopped } = Promise.withResolvers<void>();
	child.once("exit", () => stopped());
	child.kill("SIGTERM");
	setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS).unref();
	return promise;
}

async function restartToUpdate(): Promise<void> {
	quitting = true;
	await stopServer();
	updates?.install();
}

function updateItem(): MenuItemConstructorOptions[] {
	if (!updates) return [];
	const ready = updates.ready();
	return [ready ? { label: `Restart to Install ${ready}`, click: () => void restartToUpdate() } : { label: "Check for Updates…", click: () => updates?.checkNow() }];
}

/** The menu holds no shortcut the dashboard binds (web/shortcuts.ts), so every one reaches the page. */
function applicationMenu(): Menu {
	// A checkout's Electron is not an app macOS can open at login.
	const openAtLogin: MenuItemConstructorOptions[] = app.isPackaged
		? [{ label: "Open at Login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: toggleOpenAtLogin }]
		: [];
	const appMenu: MenuItemConstructorOptions[] = IS_MAC
		? [
				{
					label: app.name,
					submenu: [
						{ role: "about" },
						...updateItem(),
						SEPARATOR,
						...openAtLogin,
						{ label: "Install omp Starter Kit…", click: installStarterKit },
						SEPARATOR,
						{ role: "hide" },
						{ role: "hideOthers" },
						{ role: "unhide" },
						SEPARATOR,
						{ role: "quit" },
					],
				},
			]
		: [];
	const front: MenuItemConstructorOptions[] = IS_MAC ? [SEPARATOR, { role: "front" }] : [];
	return Menu.buildFromTemplate([
		...appMenu,
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [{ role: "reload" }, { role: "toggleDevTools" }, SEPARATOR, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, SEPARATOR, { role: "togglefullscreen" }],
		},
		{ label: "Window", role: "window", submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, ...front] },
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
		if (!win) return;
		win.show();
		win.focus();
	};
	app.on("second-instance", reveal);
	app.on("activate", reveal);
	app.on("window-all-closed", () => app.quit());
	app.on("before-quit", event => {
		quitting = true;
		if (!server) return;
		// Hold the quit until the server wrote its stores and let go of its sessions, which run on for the next launch.
		event.preventDefault();
		void stopServer().then(() => app.quit());
	});
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());

	app.on("will-quit", () => globalShortcut.unregisterAll());

	void app.whenReady().then(() => {
		Menu.setApplicationMenu(applicationMenu());
		removeOldLoginAgents();
		if (app.isPackaged) updates = startUpdates(() => Menu.setApplicationMenu(applicationMenu()));
		// The app runs from Electron's own bundle, so without this the Dock shows Electron's icon.
		app.dock?.setIcon(ICON);
		win = createWindow();
		void connect(win);
		showAttention(win, isDashboard, reveal);
		const quickTodo = (): void => {
			reveal();
			void win?.webContents.executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(QUICK_TODO_EVENT)}))`).catch(() => {});
		};
		if (!globalShortcut.register(QUICK_TODO_SHORTCUT, quickTodo)) console.error(`omp-agents: another app holds ${QUICK_TODO_SHORTCUT}`);
	});
}
