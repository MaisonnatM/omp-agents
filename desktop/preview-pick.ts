/**
 * Runs in the main world of the page the Browser's webview shows, bundled to a script that `preview-preload.ts` runs
 * there: the Browser's Select, as T3 Code draws it. The pointer outlines the element under it, a click selects that
 * element, Shift+click adds to the selection, and a click on a selected element drops it. Only `resolve` reads what the
 * elements are, through react-grab's `getElementContext`, which finds their React components and source files.
 */
/// <reference lib="dom" />
import { getDisplayName, getFiberFromHostInstance, isCompositeFiber, traverseFiber } from "bippy/core";
import { getElementAtPoint, getElementBounds, getElementContext } from "react-grab/primitives";
import {
	PREVIEW_PICKER_GLOBAL,
	PREVIEW_SELECTION_CHANNEL,
	type PreviewElement,
	type PreviewElementBox,
	type PreviewPicker,
	type PreviewSelection,
} from "../src/shared/desktop-bridge";

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
const selected = new Map<Element, { id: number; outline: HTMLDivElement }>();

/** The height the label above an outline takes, in CSS pixels; an element closer to the top gets it inside instead. */
const LABEL_HEIGHT = 20;

/** An outline with its label, the name of what it outlines. */
function outline(): HTMLDivElement {
	const box = document.createElement("div");
	box.style.cssText = "position:fixed;box-sizing:border-box;border-radius:2px;display:none";
	const label = document.createElement("span");
	label.style.cssText = `position:absolute;left:-2px;height:${LABEL_HEIGHT}px;padding:0 6px;border-radius:4px;color:#fff;font:500 11px/${LABEL_HEIGHT}px system-ui,sans-serif;white-space:nowrap`;
	box.append(label);
	root.append(box);
	return box;
}
const hover = outline();

/** The name of the nearest React component that renders `element` and has one, through bippy, which react-grab reads fibers with, or `null` outside React. */
function componentName(element: Element): string | null {
	const fiber = traverseFiber(getFiberFromHostInstance(element), node => isCompositeFiber(node) && getDisplayName(node.type) !== null, true);
	return fiber && getDisplayName(fiber.type);
}

/** What an outline's label reads: the React component, else the tag with its id and first two classes, as T3 Code labels it. */
function labelOf(element: Element): string {
	const name = componentName(element);
	if (name) return name;
	const id = element.id ? `#${element.id}` : "";
	const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join("") : "";
	return `${element.tagName.toLowerCase()}${id}${classes}`;
}

/** Draws `box` over `element`, filled at `fill` percent, and returns where it shows in the top window, inside a same-origin iframe too. */
function place(box: HTMLDivElement, element: Element, fill: number): Omit<PreviewElementBox, "id"> {
	const { x: left, y: top, width, height } = getElementBounds(element);
	Object.assign(box.style, {
		display: "block",
		left: `${left}px`,
		top: `${top}px`,
		width: `${width}px`,
		height: `${height}px`,
		border: `2px solid ${color}`,
		background: `color-mix(in srgb, ${color} ${fill}%, transparent)`,
	});
	const label = box.firstElementChild as HTMLSpanElement;
	label.textContent = labelOf(element);
	label.style.background = color;
	label.style.top = top < LABEL_HEIGHT + 2 ? "0" : `${-LABEL_HEIGHT - 4}px`;
	return { x: left, y: top, width, height };
}

/** Places every outline again and tells the page where the selected elements show. */
function report(): void {
	const boxes: PreviewElementBox[] = [];
	for (const [element, { id, outline: box }] of selected) {
		if (element.isConnected) boxes.push({ id, ...place(box, element, 10) });
		else {
			box.remove();
			selected.delete(element);
		}
	}
	const selection: PreviewSelection = { selecting, boxes };
	window.postMessage({ [PREVIEW_SELECTION_CHANNEL]: selection }, "*");
}

let frame = 0;
const reportSoon = (): void => {
	if (frame === 0) frame = requestAnimationFrame(() => ((frame = 0), report()));
};

function remove(element: Element): void {
	selected.get(element)?.outline.remove();
	selected.delete(element);
}

function toggle(element: Element, additive: boolean): void {
	if (selected.has(element)) remove(element);
	else {
		if (!additive) for (const other of Array.from(selected.keys())) remove(other);
		selected.set(element, { id: nextId++, outline: outline() });
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
		for (const [element, entry] of selected) if (entry.id === id) remove(element);
		report();
	},
	clear() {
		for (const element of Array.from(selected.keys())) remove(element);
		setSelecting(false);
		report();
	},
	resolve() {
		hover.style.display = "none";
		return Promise.all(Array.from(selected, ([element, { id }]) => describe(id, element)));
	},
};

Object.defineProperty(window, PREVIEW_PICKER_GLOBAL, { value: Object.freeze(picker) });
addEventListener("scroll", reportSoon, { capture: true, passive: true });
addEventListener("resize", reportSoon, { passive: true });
