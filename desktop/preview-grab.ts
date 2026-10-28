/**
 * Runs in the main world of the page the Preview's webview shows, bundled to a script that `preview-preload.ts` runs
 * there: starts react-grab with its Copy, Comment, and Open actions, or takes the one the app started itself, and posts
 * each element it copies, with any comment typed on it, to the preload, named by that comment or by the element.
 */
/// <reference lib="dom" />
/// <reference types="react-grab" />
import { init } from "react-grab/core";
import { PREVIEW_GRAB_ACTIVE_CHANNEL, PREVIEW_GRAB_CHANNEL } from "../src/shared/desktop-bridge";

// `react-grab/core` starts nothing on import, unlike `react-grab`; an app that loads its own copy later finds this one
// on `window.__REACT_GRAB__` and uses it instead of starting a second.
const api = window.__REACT_GRAB__ ?? init({ telemetry: false });
window.__REACT_GRAB__ = api;
// React-grab copies a Comment's text, a line break, then the element's; this keeps the element's to tell the comment apart.
let copied = "";

/** The chip's label: the comment typed on the pick, else the React component or tag of what was picked. */
function pickLabel(elements: Element[], content: string): string {
	const comment = content.endsWith(`\n${copied}`) ? content.slice(0, -copied.length - 1).trim() : "";
	if (comment) return comment.replace(/\s+/g, " ");
	const [first] = elements;
	const name = first ? (api.getDisplayName(first) ?? first.tagName.toLowerCase()) : "element";
	return elements.length > 1 ? `${name} +${elements.length - 1}` : name;
}

api.registerPlugin({
	name: "omp-agents",
	// React-grab marks each copied element with a "Copied" label that takes clicks for 1.5 seconds, and for as long as the
	// pointer rests on it, and it sits below that element, often over the next one to pick; a click there picks nothing
	// and leaves picking on. The dashboard confirms each pick itself, so the Preview goes without these labels.
	theme: { grabbedBoxes: { enabled: false } },
	hooks: {
		transformCopyContent: content => {
			copied = content;
			return content;
		},
		// The one hook whose content holds the Comment's text; it fires once the clipboard took the copy.
		onCopySuccess: (elements, content) => window.postMessage({ [PREVIEW_GRAB_CHANNEL]: { content, label: pickLabel(elements, content) } }, "*"),
		// The dashboard's pick mode switch follows picking, which react-grab can turn off by itself.
		onActivate: () => window.postMessage({ [PREVIEW_GRAB_ACTIVE_CHANNEL]: true }, "*"),
		onDeactivate: () => window.postMessage({ [PREVIEW_GRAB_ACTIVE_CHANNEL]: false }, "*"),
	},
});
