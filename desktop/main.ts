/**
 * The desktop shell: the dashboard in a native window. It starts the server from this checkout, or uses an
 * omp-agents server that already listens on the port, and opens every other address in the default browser.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
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
import { tokenFile, userTodosFile } from "../src/paths";
import { dashboardHosts, isListeningLine, originOf, portFromEnv, QUICK_TODO_EVENT } from "../src/server/address";
import { loadToken } from "../src/server/auth";
import { parseUserTodoList } from "../src/user-todos-parse";
import { opensAtLogin, removeLoginAgent, writeLoginAgent } from "./login-item";

const PORT = portFromEnv();
const ORIGIN = originOf(PORT);
/** The checkout this shell runs: Electron runs the app in its `desktop/` directory. */
const REPO_DIR = resolve(app.getAppPath(), "..");
/** The server builds the page before it listens. */
const READY_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;
/** How long the server gets to end its dashboard sessions after SIGTERM. */
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
	const child = spawn("bun", [join(REPO_DIR, "src", "server.ts")], {
		cwd: REPO_DIR,
		// The server exits when its stdin ends, which it does however this process dies.
		env: { ...process.env, PORT: String(PORT), OMP_AGENTS_PARENT: "stdin" },
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
	child.once("error", (err: NodeJS.ErrnoException) => reject(new Error(err.code === "ENOENT" ? "`bun` is not on PATH." : err.message)));
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

/** Schemes the default browser may open. */
const OUTSIDE_PROTOCOLS: Record<string, true> = { "http:": true, "https:": true };

/** Opens a web address in the default browser; any other scheme goes nowhere. */
function openOutside(url: string): void {
	const protocol = URL.parse(url)?.protocol;
	if (protocol && OUTSIDE_PROTOCOLS[protocol]) void shell.openExternal(url);
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

/** Copy for selected text; cut, copy, paste, and spelling suggestions in a text field; nothing elsewhere. */
function contextMenuItems(params: ContextMenuParams, contents: WebContents): MenuItemConstructorOptions[] {
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
		webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
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

/** Writes or removes the login agent for `item`'s new state, then shows what the disk holds, so a failure leaves no wrong check mark. */
function toggleOpenAtLogin(item: MenuItem): void {
	try {
		if (item.checked) writeLoginAgent(PORT, [process.execPath, app.getAppPath()]);
		else removeLoginAgent(PORT);
	} catch (err) {
		dialog.showErrorBox("Open at Login failed", errorText(err));
	}
	item.checked = opensAtLogin(PORT);
}

/** The menu holds no shortcut the dashboard binds (web/shortcuts.ts), so every one reaches the page. */
function applicationMenu(): Menu {
	const openAtLogin: MenuItemConstructorOptions = { label: "Open at Login", type: "checkbox", checked: IS_MAC && opensAtLogin(PORT), click: toggleOpenAtLogin };
	const appMenu: MenuItemConstructorOptions[] = IS_MAC
		? [{ label: app.name, submenu: [{ role: "about" }, SEPARATOR, openAtLogin, SEPARATOR, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, SEPARATOR, { role: "quit" }] }]
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

/** The Dock and taskbar badge counts the top-level todos left, as the Todo tab's **All** does; none clears it. */
function showTodosLeft(): void {
	let left = 0;
	try {
		const list = parseUserTodoList(JSON.parse(readFileSync(userTodosFile, "utf8")));
		left = list?.todos.filter(todo => todo.doneAt === null).length ?? 0;
	} catch {}
	app.setBadgeCount(left);
}

/** The server replaces `todos.json` through a temporary file, so the watch is on its directory. */
function watchTodosLeft(): void {
	showTodosLeft();
	try {
		watch(dirname(userTodosFile), (_event, name) => {
			if (name === basename(userTodosFile)) showTodosLeft();
		});
	} catch (err) {
		console.error(`omp-agents: cannot watch ${userTodosFile}: ${errorText(err)}`);
	}
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
		const child = server;
		if (!child) return;
		// Hold the quit until the server has ended its sessions, so none outlives the app.
		event.preventDefault();
		child.once("exit", () => app.quit());
		child.kill("SIGTERM");
		setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS).unref();
	});
	for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => app.quit());

	app.on("will-quit", () => globalShortcut.unregisterAll());

	void app.whenReady().then(() => {
		Menu.setApplicationMenu(applicationMenu());
		// The app runs from Electron's own bundle, so without this the Dock shows Electron's icon.
		app.dock?.setIcon(ICON);
		win = createWindow();
		void connect(win);
		watchTodosLeft();
		const quickTodo = (): void => {
			reveal();
			void win?.webContents.executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(QUICK_TODO_EVENT)}))`).catch(() => {});
		};
		if (!globalShortcut.register(QUICK_TODO_SHORTCUT, quickTodo)) console.error(`omp-agents: another app holds ${QUICK_TODO_SHORTCUT}`);
	});
}
