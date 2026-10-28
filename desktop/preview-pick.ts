/**
 * Runs in the main world of the page the Browser's webview shows, bundled to a script that `preview-preload.ts` runs
 * there: the Browser's Select, as T3 Code draws it. The pointer outlines the element under it, a click selects that
 * element, Shift+click adds to the selection, and a click on a selected element drops it. Only `resolve` reads what the
 * elements are, through react-grab's `getElementContext`, which finds their React components and source files.
 */
/// <reference lib="dom" />
import { getElementAtPoint, getElementContext } from "react-grab/primitives";
import { PREVIEW_PICKER_GLOBAL, PREVIEW_SELECTION_CHANNEL, type PreviewElement, type PreviewPicker, type PreviewSelection } from "../src/shared/desktop-bridge";

/** How long `getElementContext` may take for one element before the tag and HTML stand in, as in T3 Code. */
const CONTEXT_TIMEOUT_MS = 1500;
const HTML_MAX_CHARS = 500;

// A closed shadow root keeps the app's styles off the outlines, and no pointer reaches them.
const host = document.createElement("div");
host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
const root = host.attachShadow({ mode: "closed" });

let color = "#2563eb";
let selecting = false;
let nextId = 1;
const selected = new Map<number, { element: Element; outline: HTMLDivElement }>();

function outline(): HTMLDivElement {
	const box = document.createElement("div");
	box.style.cssText = "position:fixed;box-sizing:border-box;border-radius:2px;display:none";
	root.append(box);
	return box;
}
const hover = outline();

function place(box: HTMLDivElement, element: Element, fill: number): void {
	const { left, top, width, height } = element.getBoundingClientRect();
	Object.assign(box.style, {
		display: "block",
		left: `${left}px`,
		top: `${top}px`,
		width: `${width}px`,
		height: `${height}px`,
		border: `2px solid ${color}`,
		background: `color-mix(in srgb, ${color} ${fill}%, transparent)`,
	});
}

/** Places every outline again and tells the page where the selected elements show. */
function report(): void {
	for (const [id, { element, outline: box }] of selected) {
		if (element.isConnected) place(box, element, 10);
		else {
			box.remove();
			selected.delete(id);
		}
	}
	const selection: PreviewSelection = {
		selecting,
		boxes: Array.from(selected, ([id, { element }]) => {
			const { left, top, width, height } = element.getBoundingClientRect();
			return { id, x: left, y: top, width, height };
		}),
	};
	window.postMessage({ [PREVIEW_SELECTION_CHANNEL]: selection }, "*");
}

let frame = 0;
const reportSoon = (): void => {
	if (frame === 0) frame = requestAnimationFrame(() => ((frame = 0), report()));
};

function remove(id: number): void {
	selected.get(id)?.outline.remove();
	selected.delete(id);
}

function toggle(element: Element, additive: boolean): void {
	const existing = Array.from(selected).find(([, entry]) => entry.element === element);
	if (existing) remove(existing[0]);
	else {
		if (!additive) for (const id of Array.from(selected.keys())) remove(id);
		selected.set(nextId++, { element, outline: outline() });
	}
	report();
}

function onPointerMove(event: PointerEvent): void {
	const target = getElementAtPoint(event.clientX, event.clientY);
	if (target) place(hover, target, 6);
	else hover.style.display = "none";
}

function onPointerDown(event: PointerEvent): void {
	if (event.button !== 0) return;
	swallow(event);
	const target = getElementAtPoint(event.clientX, event.clientY);
	if (target) toggle(target, event.shiftKey);
}

// The app's own handlers never see a press while Select is on, so a click selects a button without pressing it.
function swallow(event: Event): void {
	event.preventDefault();
	event.stopImmediatePropagation();
}

const SWALLOWED = ["pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];

function setSelecting(on: boolean): void {
	if (on === selecting) return;
	selecting = on;
	const change = on ? addEventListener : removeEventListener;
	change("pointermove", onPointerMove as EventListener, true);
	change("pointerdown", onPointerDown as EventListener, true);
	for (const name of SWALLOWED) change(name, swallow, true);
	document.documentElement.style.cursor = on ? "crosshair" : "";
	if (!on) hover.style.display = "none";
}

async function describe(id: number, element: Element): Promise<PreviewElement> {
	const fallback = { id, name: element.tagName.toLowerCase(), snippet: element.outerHTML.slice(0, HTML_MAX_CHARS) };
	const timeout = Promise.withResolvers<null>();
	setTimeout(() => timeout.resolve(null), CONTEXT_TIMEOUT_MS);
	const context = await Promise.race([getElementContext(element).catch(() => null), timeout.promise]);
	return context ? { id, name: context.componentName ?? fallback.name, snippet: context.snippet } : fallback;
}

const picker: PreviewPicker = {
	select(on, outlineColor) {
		color = outlineColor;
		if (!host.isConnected) document.documentElement.append(host);
		setSelecting(on);
		report();
	},
	deselect(id) {
		remove(id);
		report();
	},
	clear() {
		for (const id of Array.from(selected.keys())) remove(id);
		setSelecting(false);
		report();
	},
	resolve() {
		hover.style.display = "none";
		return Promise.all(Array.from(selected, ([id, { element }]) => describe(id, element)));
	},
};

Object.defineProperty(window, PREVIEW_PICKER_GLOBAL, { value: Object.freeze(picker) });
addEventListener("scroll", reportSoon, { capture: true, passive: true });
addEventListener("resize", reportSoon, { passive: true });
