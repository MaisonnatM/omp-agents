/** The Browser's Electron `<webview>`: what it loads, its address field, its history, and the elements react-grab copies in it. */
import { useEffect, useRef, useState } from "react";
import { type BrowserPorts, isLoopbackUrl, PREVIEW_ESCAPE_CHANNEL, PREVIEW_GRAB_CHANNEL, PREVIEW_PICKING_CHANNEL } from "../src/shared/desktop-bridge";

/** What the Browser drives of Electron's `<webview>`, which the page has no types for. */
export interface WebviewTag extends HTMLWebViewElement {
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	reload(): void;
	loadURL(url: string): Promise<void>;
	getURL(): string;
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
	/** Takes each element react-grab copies in the page, with any comment typed on it. */
	onPick: (text: string) => void;
	/** Takes each address on this computer the page navigates to. */
	onNavigate: (url: string) => void;
	/** Takes an Escape the app left unhandled, which never reaches the page while the app has the focus. */
	onEscape: () => void;
	/** The ports the session and other servers listen on, which decide where a sign-in back to the app's usual port goes. */
	ports: BrowserPorts;
}

/** The `<webview>` to render with `ref` and `src` once `src` is not `null`, the address field's state, and the toolbar's actions. */
export function useWebview({ initial, onPick, onNavigate, onEscape, ports }: WebviewOptions) {
	const ref = useRef<WebviewTag>(null);
	// The webview's first address: later ones go through `loadURL`, since a changed `src` would load each page again.
	const [src, setSrc] = useState(initial);
	const [address, setAddress] = useState(initial ?? "");
	const [problem, setProblem] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [history, setHistory] = useState({ back: false, forward: false });
	// Whether react-grab picks in the page, as its preload reports; a new page starts without it.
	const [picking, setPicking] = useState(false);
	const latest = useRef({ onPick, onNavigate, onEscape });
	latest.current = { onPick, onNavigate, onEscape };

	useEffect(() => {
		if (src !== null || initial === null || address !== "") return;
		setSrc(initial);
		setAddress(initial);
	}, [src, initial, address]);

	const mounted = src !== null;
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		const onReady = (): void => setReady(true);
		const readHistory = (): void => setHistory({ back: element.canGoBack(), forward: element.canGoForward() });
		const onNavigated = (event: Event): void => {
			const { url, isMainFrame } = event as NavigateEvent;
			if (isMainFrame === false) return;
			setAddress(url);
			setProblem(null);
			setPicking(false);
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
			else if (channel === PREVIEW_PICKING_CHANNEL && typeof content === "boolean") setPicking(content);
			// A sign-in takes the guest to other sites, which must not write into the composer.
			else if (channel === PREVIEW_GRAB_CHANNEL && typeof content === "string" && isLoopbackUrl(element.getURL())) latest.current.onPick(content);
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
		picking,
		load,
		back: () => ref.current?.goBack(),
		forward: () => ref.current?.goForward(),
		reload: () => ref.current?.reload(),
		// Comment mode opens react-grab's prompt on the clicked element, so you type at once; its send copies the element with the text.
		selectElement: () =>
			void ref.current?.executeJavaScript("(g => g && (g.isActive() ? g.deactivate() : g.comment()))(window.__REACT_GRAB__)", true).catch(() => {}),
	};
}
