import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { type TerminalClientMsg, type TerminalInfo, type TerminalServerMsg, terminalSocketPath } from "../../../src/shared/terminals";
import { IS_MAC, pressesChord, SHORTCUTS } from "../../shortcuts";

/** VS Code's ANSI colors, light and dark: xterm's own suit only a dark background. */
const ANSI: Record<"light" | "dark", ITheme> = {
	light: {
		black: "#000000",
		red: "#cd3131",
		green: "#00bc00",
		yellow: "#949800",
		blue: "#0451a5",
		magenta: "#bc05bc",
		cyan: "#0598bc",
		white: "#555555",
		brightBlack: "#666666",
		brightRed: "#cd3131",
		brightGreen: "#14ce14",
		brightYellow: "#b5ba00",
		brightBlue: "#0451a5",
		brightMagenta: "#bc05bc",
		brightCyan: "#0598bc",
		brightWhite: "#a5a5a5",
	},
	dark: {
		black: "#000000",
		red: "#cd3131",
		green: "#0dbc79",
		yellow: "#e5e510",
		blue: "#2472c8",
		magenta: "#bc3fbc",
		cyan: "#11a8cd",
		white: "#e5e5e5",
		brightBlack: "#666666",
		brightRed: "#f14c4c",
		brightGreen: "#23d18b",
		brightYellow: "#f5f543",
		brightBlue: "#3b8eea",
		brightMagenta: "#d670d6",
		brightCyan: "#29b8db",
		brightWhite: "#e5e5e5",
	},
};

/** The page's own background and text color around `element`, with the ANSI colors of its scheme. */
function themeOf(element: HTMLElement): ITheme {
	const { color, backgroundColor } = getComputedStyle(element);
	const dark = document.documentElement.classList.contains("dark");
	return { ...ANSI[dark ? "dark" : "light"], background: backgroundColor, foreground: color, cursor: color, cursorAccent: backgroundColor, selectionBackground: dark ? "#264f78" : "#add6ff" };
}

const TOGGLE = SHORTCUTS.find(({ id }) => id === "terminal")!.keys.flatMap(binding => ("chord" in binding ? [binding.chord] : []));

/**
 * Keys the page takes before the shell: the terminal's own toggle, and on macOS every ⌘ chord, which a shell never
 * reads, so ⌘K and ⌘B still work from the terminal. Elsewhere Ctrl chords are the shell's.
 */
const pageKey = (event: KeyboardEvent): boolean => TOGGLE.some(chord => pressesChord(event, chord)) || (IS_MAC && event.metaKey);

interface TerminalViewProps {
	/** The shell to attach to, or the directory to open a new one in. */
	target: { id: string } | { cwd: string };
	/** The tab shows, so the terminal takes focus and fits its box. */
	active: boolean;
	onOpened: (terminal: TerminalInfo) => void;
	/** The shell exited, or the server hung up without saying. */
	onClosed: (exited: boolean) => void;
	ref: Ref<TerminalHandle>;
}

/** What the tab strip's close button calls: hangs up on the shell, which then exits. */
export interface TerminalHandle {
	kill: () => void;
}

/** One tab's xterm, joined to its shell by a `/ws/terminal` socket for as long as the tab stays mounted. */
export function TerminalView({ target, active, onOpened, onClosed, ref }: TerminalViewProps) {
	const box = useRef<HTMLDivElement>(null);
	const xterm = useRef<{ terminal: Terminal; fit: FitAddon; send: (msg: TerminalClientMsg) => void } | null>(null);
	const latest = useRef({ onOpened, onClosed });
	latest.current = { onOpened, onClosed };

	useEffect(() => {
		const element = box.current!;
		const terminal = new Terminal({ fontFamily: getComputedStyle(element).fontFamily, fontSize: 12, cursorBlink: true, scrollback: 10_000, theme: themeOf(element) });
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(element);
		terminal.attachCustomKeyEventHandler(event => !pageKey(event));
		if (element.clientWidth > 0) fit.fit();

		const encoder = new TextEncoder();
		const ws = new WebSocket(`ws://${location.host}${terminalSocketPath("id" in target ? target : { cwd: target.cwd, cols: terminal.cols, rows: terminal.rows })}`);
		ws.binaryType = "arraybuffer";
		const send = (msg: TerminalClientMsg): void => {
			if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
		};
		xterm.current = { terminal, fit, send };
		let exited = false;
		ws.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
			if (typeof data !== "string") return terminal.write(new Uint8Array(data));
			const msg = JSON.parse(data) as TerminalServerMsg;
			if (msg.t === "exit") exited = true;
			else {
				send({ t: "resize", cols: terminal.cols, rows: terminal.rows });
				latest.current.onOpened(msg.terminal);
			}
		};
		ws.onclose = () => {
			if (!exited) terminal.write("\r\n\x1b[2mThe dashboard server hung up on this terminal.\x1b[0m\r\n");
			latest.current.onClosed(exited);
		};
		const input = terminal.onData(data => ws.readyState === WebSocket.OPEN && ws.send(encoder.encode(data)));
		const resize = terminal.onResize(({ cols, rows }) => send({ t: "resize", cols, rows }));

		const sized = new ResizeObserver(() => {
			if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();
		});
		sized.observe(element);
		const scheme = new MutationObserver(() => {
			terminal.options.theme = themeOf(element);
		});
		scheme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		return () => {
			scheme.disconnect();
			sized.disconnect();
			input.dispose();
			resize.dispose();
			ws.onclose = null;
			ws.close();
			terminal.dispose();
			xterm.current = null;
		};
		// A tab keeps its socket for life: a new target is a new tab, with its own key.
	}, []);
	useImperativeHandle(ref, () => ({ kill: () => xterm.current?.send({ t: "kill" }) }), []);

	useEffect(() => {
		if (!active || !xterm.current) return;
		xterm.current.fit.fit();
		xterm.current.terminal.focus();
	}, [active]);

	return <div ref={box} className="min-h-0 flex-1 bg-background px-2 pt-1 font-mono text-foreground" hidden={!active} />;
}

