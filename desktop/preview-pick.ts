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

type Fiber = { type: unknown; return: Fiber | null };

/** The name of the React component that renders `element`, read from the fiber React keeps on it, or `null` outside React. */
function componentName(element: Element): string | null {
	const key = Object.keys(element).find(name => name.startsWith("__reactFiber$"));
	let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : null;
	for (; fiber; fiber = fiber.return) {
		// A memo or forwardRef component keeps its function under `type` or `render`.
		const type = fiber.type as { displayName?: string; name?: string; type?: { name?: string }; render?: { name?: string } } | string | null;
		if (type === null || typeof type === "string" || (typeof type !== "function" && typeof type !== "object")) continue;
		const name = type.displayName || type.name || type.type?.name || type.render?.name;
		if (name) return name;
	}
	return null;
}

/** What an outline's label reads: the React component, else the tag with its id and first two classes, as T3 Code labels it. */
function labelOf(element: Element): string {
	const name = componentName(element);
	if (name) return name;
	const id = element.id ? `#${element.id}` : "";
	const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(name => `.${name}`).join("") : "";
	return `${element.tagName.toLowerCase()}${id}${classes}`;
}

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
	const label = box.firstElementChild as HTMLSpanElement;
	label.textContent = labelOf(element);
	label.style.background = color;
	label.style.top = top < LABEL_HEIGHT + 2 ? "0" : `${-LABEL_HEIGHT - 4}px`;
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
