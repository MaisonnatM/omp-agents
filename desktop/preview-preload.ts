/**
 * The preload of the Preview's webview, which shows a session's app: runs `preview-grab.ts` in the page once it is
 * parsed, and hands each element react-grab copies there to the dashboard as an `ipc-message`, which appends it to the
 * session's composer. Sandboxed, so the script comes inlined at build time instead of read from disk.
 */
/// <reference lib="dom" />
import { ipcRenderer, webFrame } from "electron";
import { isObject } from "../src/json";
import { PICK_MODE_KEYS, PREVIEW_ESCAPE_CHANNEL, PREVIEW_GRAB_ACTIVE_CHANNEL, PREVIEW_GRAB_CHANNEL, PREVIEW_PICK_KEY_CHANNEL } from "../src/shared/desktop-bridge";
import grab from "./dist/preview-grab.txt" with { type: "text" };

// react-grab observes `document.body` as it starts, which the preload runs before the parser made.
document.addEventListener("DOMContentLoaded", () => void webFrame.executeJavaScript(grab).catch(() => {}), { once: true });

// Whether react-grab picks, the one time the app's focus holds a pick mode key meant for the page.
let grabbing = false;

window.addEventListener("message", event => {
	if (event.source !== window || !isObject(event.data)) return;
	const pick: unknown = event.data[PREVIEW_GRAB_CHANNEL];
	if (isObject(pick) && typeof pick.content === "string" && typeof pick.label === "string") ipcRenderer.sendToHost(PREVIEW_GRAB_CHANNEL, { content: pick.content, label: pick.label });
	const active: unknown = event.data[PREVIEW_GRAB_ACTIVE_CHANNEL];
	if (typeof active !== "boolean") return;
	grabbing = active;
	ipcRenderer.sendToHost(PREVIEW_GRAB_ACTIVE_CHANNEL, active);
});

// The guest has the focus while the Browser is maximized, so an Escape the app left alone goes to the page, which restores it.
window.addEventListener("keydown", event => {
	if (event.key === "Escape" && !event.defaultPrevented) ipcRenderer.sendToHost(PREVIEW_ESCAPE_CHANNEL);
	const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
	const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName));
	if (grabbing && plain && !typing && PICK_MODE_KEYS.includes(event.key.toLowerCase())) ipcRenderer.sendToHost(PREVIEW_PICK_KEY_CHANNEL, event.key.toLowerCase());
});
