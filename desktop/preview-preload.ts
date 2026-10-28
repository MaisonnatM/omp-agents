/**
 * The preload of the Browser's webview, which shows a session's app: runs `preview-pick.ts` in the page once it is
 * parsed, and hands each change of its Select to the dashboard as an `ipc-message`. Sandboxed, so the script comes
 * inlined at build time instead of read from disk.
 */
/// <reference lib="dom" />
import { ipcRenderer, webFrame } from "electron";
import { isObject } from "../src/json";
import { isPreviewSelection, isTypingTarget, PICK_MODE_KEYS, PREVIEW_ESCAPE_CHANNEL, PREVIEW_PICK_KEY_CHANNEL, PREVIEW_SELECTION_CHANNEL } from "../src/shared/desktop-bridge";
import pick from "./dist/preview-pick.txt" with { type: "text" };

// The picker's outlines go in `document.documentElement`, which the preload runs before the parser made.
document.addEventListener("DOMContentLoaded", () => void webFrame.executeJavaScript(pick).catch(() => {}), { once: true });

// Whether Select is on, the one time the app's focus holds a pick mode key meant for the page.
let selecting = false;

window.addEventListener("message", event => {
	if (event.source !== window || !isObject(event.data)) return;
	const selection: unknown = event.data[PREVIEW_SELECTION_CHANNEL];
	if (!isPreviewSelection(selection)) return;
	selecting = selection.selecting;
	const boxes = selection.boxes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
	ipcRenderer.sendToHost(PREVIEW_SELECTION_CHANNEL, { selecting, boxes });
});

// The guest has the focus while the Browser is maximized, so an Escape the app left alone goes to the page, which restores it.
window.addEventListener("keydown", event => {
	if (event.key === "Escape" && !event.defaultPrevented) ipcRenderer.sendToHost(PREVIEW_ESCAPE_CHANNEL);
	const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
	if (selecting && plain && !isTypingTarget(event.target) && PICK_MODE_KEYS.includes(event.key.toLowerCase())) ipcRenderer.sendToHost(PREVIEW_PICK_KEY_CHANNEL, event.key.toLowerCase());
});
