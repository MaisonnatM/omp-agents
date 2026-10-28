/**
 * The preload of the Preview's webview, which shows a session's app: runs `preview-grab.ts` in the page once it is
 * parsed, and hands each element react-grab copies there to the dashboard as an `ipc-message`, which appends it to the
 * session's composer. Sandboxed, so the script comes inlined at build time instead of read from disk.
 */
/// <reference lib="dom" />
import { ipcRenderer, webFrame } from "electron";
import { isObject } from "../src/json";
import { PREVIEW_ESCAPE_CHANNEL, PREVIEW_GRAB_ACTIVE_CHANNEL, PREVIEW_GRAB_CHANNEL } from "../src/shared/desktop-bridge";
import grab from "./dist/preview-grab.txt" with { type: "text" };

// react-grab observes `document.body` as it starts, which the preload runs before the parser made.
document.addEventListener("DOMContentLoaded", () => void webFrame.executeJavaScript(grab).catch(() => {}), { once: true });

window.addEventListener("message", event => {
	if (event.source !== window || !isObject(event.data)) return;
	const content: unknown = event.data[PREVIEW_GRAB_CHANNEL];
	if (typeof content === "string") ipcRenderer.sendToHost(PREVIEW_GRAB_CHANNEL, content);
	const active: unknown = event.data[PREVIEW_GRAB_ACTIVE_CHANNEL];
	if (typeof active === "boolean") ipcRenderer.sendToHost(PREVIEW_GRAB_ACTIVE_CHANNEL, active);
});

// The guest has the focus while the Browser is maximized, so an Escape the app left alone goes to the page, which restores it.
window.addEventListener("keydown", event => {
	if (event.key === "Escape" && !event.defaultPrevented) ipcRenderer.sendToHost(PREVIEW_ESCAPE_CHANNEL);
});
