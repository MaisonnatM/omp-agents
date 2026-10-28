/**
 * Runs in the main world of the page the Preview's webview shows, bundled to a script that `preview-preload.ts` runs
 * there: starts react-grab with its Copy, Comment, and Open actions, or takes the one the app started itself, and posts
 * each element it copies, with any comment typed on it, to the preload.
 */
/// <reference lib="dom" />
/// <reference types="react-grab" />
import { init } from "react-grab/core";
import { PREVIEW_GRAB_ACTIVE_CHANNEL, PREVIEW_GRAB_CHANNEL } from "../src/shared/desktop-bridge";

// `react-grab/core` starts nothing on import, unlike `react-grab`; an app that loads its own copy later finds this one
// on `window.__REACT_GRAB__` and uses it instead of starting a second.
const api = window.__REACT_GRAB__ ?? init({ telemetry: false });
window.__REACT_GRAB__ = api;
api.registerPlugin({
	name: "omp-agents",
	// React-grab marks each copied element with a "Copied" label that takes clicks for 1.5 seconds, and for as long as the
	// pointer rests on it, and it sits below that element, often over the next one to pick; a click there picks nothing
	// and leaves picking on. The dashboard confirms each pick itself, so the Preview goes without these labels.
	theme: { grabbedBoxes: { enabled: false } },
	hooks: {
		// The one hook whose content holds the Comment's text; it fires once the clipboard took the copy.
		onCopySuccess: (_elements, content) => window.postMessage({ [PREVIEW_GRAB_CHANNEL]: content }, "*"),
		// The dashboard's Select and Region switch follows picking, which react-grab can turn off by itself.
		onActivate: () => window.postMessage({ [PREVIEW_GRAB_ACTIVE_CHANNEL]: true }, "*"),
		onDeactivate: () => window.postMessage({ [PREVIEW_GRAB_ACTIVE_CHANNEL]: false }, "*"),
	},
});
