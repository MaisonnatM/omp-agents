/** The Browser's Electron `<webview>`: what it loads, its address field, its history, and the Select that `desktop/preview-pick.ts` runs in it. */
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	type BrowserPorts,
	isLoopbackUrl,
	isPreviewElement,
	isPreviewSelection,
	PREVIEW_ESCAPE_CHANNEL,
	PREVIEW_PICK_KEY_CHANNEL,
	PREVIEW_PICKER_GLOBAL,
	PREVIEW_SELECTION_CHANNEL,
	type PreviewElement,
	type PreviewElementBox,
	type PreviewPicker,
} from "../src/shared/desktop-bridge";

/** Calls the picker in the app, which is absent until its page parsed and after a sign-in took it off this computer. */
const call = <K extends keyof PreviewPicker>(method: K, ...args: Parameters<PreviewPicker[K]>): string =>
	`window.${PREVIEW_PICKER_GLOBAL}?.${method}(${args.map(arg => JSON.stringify(arg)).join(",")})`;

/** What the Browser drives of Electron's `<webview>`, which the page has no types for. */
export interface WebviewTag extends HTMLWebViewElement {
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	reload(): void;
	loadURL(url: string): Promise<void>;
	getURL(): string;
	getTitle(): string;
	getWebContentsId(): number;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}
type IpcMessageEvent = Event & { channel: string; args: unknown[] };
type NavigateEvent = Event & { url: string; isMainFrame?: boolean };
type FailLoadEvent = Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };

/** Chromium's code for a load that another one replaced, which is no failure to show. */
const ERR_ABORTED = -3;
const NOT_LOOPBACK = "The Browser loads only addresses on this computer, such as http://localhost:5173.";

/** `typed` as the address to load, with `http://` when it names no scheme, or `null` when it is not on this computer. */
function addressOf(typed: string): string | null {
	const trimmed = typed.trim();
	if (isLoopbackUrl(trimmed)) return trimmed;
	return isLoopbackUrl(`http://${trimmed}`) ? `http://${trimmed}` : null;
}

interface WebviewOptions {
	/** The address to open on, once there is one, unless the address field holds text the user typed first. */
	initial: string | null;
	/** Takes where the elements Select picked show in the app, again each time it scrolls. */
	onSelection: (boxes: PreviewElementBox[]) => void;
	/** Takes each address on this computer the page navigates to. */
	onNavigate: (url: string) => void;
	/** Takes an Escape the app left unhandled, which never reaches the page while the app has the focus. */
	onEscape: () => void;
	/** Takes a pick mode key, V, R, D, or E, pressed in the app while Select is on, which never reaches the page's shortcuts. */
	onPickKey: (key: string) => void;
	/** The ports the session and other servers listen on, which decide where a sign-in back to the app's usual port goes. */
	ports: BrowserPorts;
}

/** The Browser's `<webview>`, the address field's state, and the toolbar's and picking's actions on it. */
export interface Webview {
	/** Renders the `<webview>`, with {@link Webview.src}, once that is not `null`. */
	ref: RefObject<WebviewTag | null>;
	src: string | null;
	/** The page in it is ready for the toolbar, after its first `dom-ready`. */
	ready: boolean;
	history: { back: boolean; forward: boolean };
	/** What the address field shows. */
	address: string;
	setAddress: (address: string) => void;
	/** Why the last address did not load, or `null`. */
	problem: string | null;
	/** Loads what was typed, when it is on this computer. */
	load: (typed: string) => void;
	back: () => void;
	forward: () => void;
	reload: () => void;
	/** Turns Select on in the app, its outlines in `color`, or off, keeping what it selected. */
	select: (on: boolean, color: string) => void;
	deselect: (id: number) => void;
	/** Drops what Select picked and turns it off. */
	clearSelection: () => void;
	/** What Select picked, read in the app, or none once a sign-in took the webview off this computer. */
	resolveSelection: () => Promise<PreviewElement[]>;
	/** The address and title the app shows, which an annotation names. */
	page: () => { url: string; title: string };
	/** A PNG of what the page shows, or `null` before it loaded or in an app whose shell takes no capture request. */
	capture: () => Promise<Uint8Array | null>;
}

/** The `<webview>` to render with `ref` and `src` once `src` is not `null`, the address field's state, and the toolbar's actions. */
export function useWebview({ initial, onSelection, onNavigate, onEscape, onPickKey, ports }: WebviewOptions): Webview {
	const ref = useRef<WebviewTag>(null);
	// The webview's first address: later ones go through `loadURL`, since a changed `src` would load each page again.
	const [src, setSrc] = useState(initial);
	const [address, setAddress] = useState(initial ?? "");
	const [problem, setProblem] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [history, setHistory] = useState({ back: false, forward: false });
	const latest = useRef({ onSelection, onNavigate, onEscape, onPickKey });
	latest.current = { onSelection, onNavigate, onEscape, onPickKey };
	// Select as the page last set it, which a new page in the webview starts again.
	const selecting = useRef({ on: false, color: "" });

	useEffect(() => {
		if (src !== null || initial === null || address !== "") return;
		setSrc(initial);
		setAddress(initial);
	}, [src, initial, address]);

	const mounted = src !== null;
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const onReady = (): void => {
			setReady(true);
			latest.current.onSelection([]);
			if (selecting.current.on) void element.executeJavaScript(call("select", true, selecting.current.color)).catch(() => {});
		};
		const readHistory = (): void => setHistory({ back: element.canGoBack(), forward: element.canGoForward() });
		const onNavigated = (event: Event): void => {
			const { url, isMainFrame } = event as NavigateEvent;
			if (isMainFrame === false) return;
			setAddress(url);
			setProblem(null);
			readHistory();
			if (isLoopbackUrl(url)) latest.current.onNavigate(url);
		};
		const onFail = (event: Event): void => {
			const { errorCode, errorDescription, validatedURL, isMainFrame } = event as FailLoadEvent;
			if (!isMainFrame || errorCode === ERR_ABORTED) return;
			setAddress(validatedURL);
			setProblem(`Could not load ${validatedURL}: ${errorDescription}.`);
		};
		const onMessage = (event: Event): void => {
			const { channel, args } = event as IpcMessageEvent;
			const content = args[0];
			if (channel === PREVIEW_ESCAPE_CHANNEL) latest.current.onEscape();
			else if (channel === PREVIEW_SELECTION_CHANNEL && isPreviewSelection(content)) latest.current.onSelection(content.boxes);
			else if (channel === PREVIEW_PICK_KEY_CHANNEL && typeof content === "string") latest.current.onPickKey(content);
		};
		const listeners: [string, (event: Event) => void][] = [
			["dom-ready", onReady],
			// A failed load fires no `did-navigate`, so the history is read again once any load ends.
			["did-stop-loading", readHistory],
			["did-navigate", onNavigated],
			["did-navigate-in-page", onNavigated],
			["did-fail-load", onFail],
			["ipc-message", onMessage],
		];
		for (const [name, listener] of listeners) element.addEventListener(name, listener);
		return () => {
			for (const [name, listener] of listeners) element.removeEventListener(name, listener);
		};
	}, [mounted]);

	useEffect(() => {
		if (ready && ref.current) window.ompDesktop?.browserPorts?.(ref.current.getWebContentsId(), ports);
	}, [ready, ports]);

	const load = (typed: string): void => {
		const url = addressOf(typed);
		if (url === null) {
			setProblem(NOT_LOOPBACK);
			return;
		}
		setProblem(null);
		setAddress(url);
		if (ready && ref.current) ref.current.loadURL(url).catch(() => {});
		else setSrc(url);
	};

	return {
		ref,
		src,
		ready,
		history,
		address,
		setAddress,
		problem,
		load,
		back: () => ref.current?.goBack(),
		forward: () => ref.current?.goForward(),
		reload: () => ref.current?.reload(),
		select: (on, color) => {
			selecting.current = { on, color };
			void ref.current?.executeJavaScript(call("select", on, color)).catch(() => {});
		},
		deselect: id => void ref.current?.executeJavaScript(call("deselect", id)).catch(() => {}),
		clearSelection: () => {
			selecting.current = { on: false, color: "" };
			void ref.current?.executeJavaScript(call("clear")).catch(() => {});
		},
		resolveSelection: async () => {
			const element = ref.current;
			if (!element || !isLoopbackUrl(element.getURL())) return [];
			const resolved = await element.executeJavaScript(`${call("resolve")} ?? []`).catch(() => []);
			return Array.isArray(resolved) ? resolved.filter(isPreviewElement) : [];
		},
		page: () => ({ url: ref.current?.getURL() ?? "", title: ref.current?.getTitle() ?? "" }),
		capture: async () => (ready && ref.current ? ((await window.ompDesktop?.captureBrowser?.(ref.current.getWebContentsId())) ?? null) : null),
	};
}
