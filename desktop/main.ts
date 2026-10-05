/**
 * The desktop shell: the dashboard in a native window. It starts the server from this checkout, or uses an
 * omp-agents server that already listens on the port, and opens every other address in the default browser.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, type Rectangle, screen, shell } from "electron";
import { isObject, num } from "../src/json";
import { tokenFile } from "../src/paths";
import { loadToken } from "../src/server/auth";

const PORT = Number(process.env.PORT ?? 4317);
const ORIGIN = `http://127.0.0.1:${PORT}`;
/** Whether `url` is the dashboard's own page, under either name `guardsFor` (src/server/http.ts) accepts. */
const isDashboard = (url: string): boolean => {
	const origin = URL.parse(url)?.origin;
	return origin === ORIGIN || origin === `http://localhost:${PORT}`;
};
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
const IS_MAC = process.platform === "darwin";
/** `icon.svg` rendered at 1024 px; Electron reads no SVG. */
const ICON = join(app.getAppPath(), "icon.png");

// Each port is its own server, so each gets its own window state, cookie, and single-instance lock.
if (process.env.PORT) app.setPath("userData", join(app.getPath("userData"), `port-${PORT}`));

/** The server this shell started, while it runs. `null` when the shell uses a server started elsewhere. */
let server: ChildProcess | null = null;
const serverLog: string[] = [];
let quitting = false;

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

/** Copies a stream of the server's output through, and keeps its last lines; calls `onLine` with each complete line. */
function follow(stream: NodeJS.ReadableStream, out: NodeJS.WriteStream, onLine: (line: string) => void): void {
	let partial = "";
	stream.on("data", (chunk: Buffer) => {
		out.write(chunk);
		const lines = (partial + chunk.toString()).split("\n");
		partial = lines.pop() ?? "";
		for (const line of lines.filter(Boolean)) {
			serverLog.push(line);
			onLine(line);
		}
		serverLog.splice(0, serverLog.length - LOG_LINES);
	});
}

/**
 * Starts the server and resolves once it listens, or with why it did not. It listens when it prints its address
 * (src/server.ts): an answer on the port alone could come from another server that took the port first.
 */
function launch(): Promise<string | null> {
	serverLog.length = 0;
	const child = spawn("bun", [join(REPO_DIR, "src", "server.ts")], {
		cwd: REPO_DIR,
		// The server exits when its stdin ends, which it does however this process dies.
		env: { ...process.env, PORT: String(PORT), OMP_AGENTS_PARENT: "stdin" },
		stdio: ["pipe", "pipe", "pipe"],
	});
	server = child;
	const { promise, resolve: settle } = Promise.withResolvers<string | null>();
	let settled = false;
	const done = (failure: string | null): void => {
		if (settled) return;
		settled = true;
		clearTimeout(deadline);
		settle(failure);
	};
	const deadline = setTimeout(() => {
		child.kill("SIGTERM");
		done(`The server did not listen within ${READY_TIMEOUT_MS / 1000} s.`);
	}, READY_TIMEOUT_MS);
	follow(child.stdout, process.stdout, line => {
		if (line.endsWith(` on ${ORIGIN}`)) done(null);
	});
	follow(child.stderr, process.stderr, () => {});
	child.once("error", (err: NodeJS.ErrnoException) => done(err.code === "ENOENT" ? "`bun` is not on PATH." : err.message));
	child.on("exit", (code, signal) => {
		if (server === child) server = null;
		done(`The server exited with ${signal ?? `code ${code}`}.`);
	});
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
	// The same call the server makes: whichever runs first creates the token, and both read the same one.
	const token = loadToken(tokenFile);
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
		const failure = await launch();
		if (failure) return showError(win, "The server did not start", failure);
		server?.once("exit", (code, signal) => {
			if (!quitting) showError(win, "The server stopped", `It exited with ${signal ?? `code ${code}`}.`);
		});
	}
	await win.loadURL(`${ORIGIN}/?token=${token}`);
}

/** Opens a web address in the default browser; any other scheme goes nowhere. */
function openOutside(url: string): void {
	const protocol = URL.parse(url)?.protocol;
	if (protocol === "http:" || protocol === "https:") void shell.openExternal(url);
}

const boundsFile = (): string => join(app.getPath("userData"), "window.json");

/** The bounds the window had when it last hid or closed; only the size when no display shows its top-left corner any more. */
function savedBounds(): Partial<Rectangle> {
	let saved: unknown;
	try {
		saved = JSON.parse(readFileSync(boundsFile(), "utf8"));
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
	const saveBounds = (): void => writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));

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
	contents.on("context-menu", (_event, params) => {
		const spelling: MenuItemConstructorOptions[] = params.dictionarySuggestions.map(word => ({ label: word, click: () => contents.replaceMisspelling(word) }));
		const editing: MenuItemConstructorOptions[] = [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" }, { role: "selectAll" }];
		const items: MenuItemConstructorOptions[] = params.isEditable
			? [...spelling, ...(spelling.length ? [{ type: "separator" } as const] : []), ...editing]
			: params.selectionText
				? [{ role: "copy" }]
				: [];
		if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
	});

	win.on("close", event => {
		saveBounds();
		// Closing hides the window on macOS: quitting stops the server, and with it every session the dashboard started.
		if (!IS_MAC || quitting) return;
		event.preventDefault();
		if (!win.isFullScreen()) return win.hide();
		win.once("leave-full-screen", () => win.hide());
		win.setFullScreen(false);
	});
	return win;
}

/** The menu holds no shortcut the dashboard binds (web/shortcuts.ts), so every one reaches the page. */
function applicationMenu(): Menu {
	const template: MenuItemConstructorOptions[] = [
		...(IS_MAC
			? [
					{
						label: app.name,
						submenu: [
							{ role: "about" },
							{ type: "separator" },
							{ role: "hide" },
							{ role: "hideOthers" },
							{ role: "unhide" },
							{ type: "separator" },
							{ role: "quit" },
						],
					} satisfies MenuItemConstructorOptions,
				]
			: []),
		{ role: "editMenu" },
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			role: "window",
			submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }, ...(IS_MAC ? [{ type: "separator" } as const, { role: "front" } as const] : [])],
		},
	];
	return Menu.buildFromTemplate(template);
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

	void app.whenReady().then(() => {
		Menu.setApplicationMenu(applicationMenu());
		// The app runs from Electron's own bundle, so without this the Dock shows Electron's icon.
		app.dock?.setIcon(ICON);
		win = createWindow();
		void connect(win);
	});
}
