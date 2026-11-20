/** The Review tab: the quick edit and revert reach the live composer, a stopped session offers neither, the wipe moves by key, and each change keeps its own draft. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { EMPTY_DRAFT, revertPrompt, tweakPrompt } from "../before-after";

// A new process mounts the real panel with React DOM over a minimal in-memory DOM; the menu and button are plain stand-ins.
const scenario = String.raw`
import { act, createElement, Fragment } from "react";
import { mock } from "bun:test";

const noop = () => {};
class Node {
	constructor(nodeType, nodeName) { Object.assign(this, { nodeType, nodeName, tagName: nodeName, childNodes: [], parentNode: null, attributes: new Map(), listeners: [], namespaceURI: "http://www.w3.org/1999/xhtml", style: { setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } } }); }
	get ownerDocument() { return document; }
	get firstChild() { return this.childNodes[0] ?? null; }
	get lastChild() { return this.childNodes.at(-1) ?? null; }
	get nextSibling() { const siblings = this.parentNode?.childNodes ?? []; return siblings[siblings.indexOf(this) + 1] ?? null; }
	appendChild(child) { child.parentNode?.removeChild(child); this.childNodes.push(child); child.parentNode = this; return child; }
	insertBefore(child, before) { child.parentNode?.removeChild(child); const at = this.childNodes.indexOf(before); this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child); child.parentNode = this; return child; }
	removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
	get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map(child => child.textContent).join(""); }
	set textContent(text) { for (const child of this.childNodes) child.parentNode = null; this.childNodes = []; if (text !== "") this.appendChild(Object.assign(new Node(3, "#text"), { nodeValue: String(text) })); }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	hasAttribute(name) { return this.attributes.has(name); }
	addEventListener(type, listener, options) { this.listeners.push({ type, listener, capture: options === true || options?.capture === true }); }
	removeEventListener(type, listener) { this.listeners = this.listeners.filter(each => each.type !== type || each.listener !== listener); }
	focus() {}
	blur() {}
}
// React DOM listens for input events only where elements carry an oninput property.
Node.prototype.oninput = null;
const document = new Node(9, "#document");
Object.assign(document, {
	createElement: tag => new Node(1, tag.toUpperCase()),
	createElementNS: (_, tag) => new Node(1, tag.toUpperCase()),
	createTextNode: text => Object.assign(new Node(3, "#text"), { nodeValue: text }),
	activeElement: null,
	querySelector: () => null,
});
document.body = document.documentElement = new Node(1, "BODY");
const container = document.body.appendChild(new Node(1, "DIV"));
const memory = new Map();
const localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
Object.assign(globalThis, { window: globalThis, document, localStorage, addEventListener: noop, removeEventListener: noop, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });

const dir = process.env.DIR;
mock.module(dir + "/ui/button.tsx", () => ({ Button: ({ children, variant, size, trailingIcon, ...rest }) => createElement("button", rest, children) }));
let pick = noop;
mock.module(dir + "/ui/menu.tsx", () => ({
	DropdownMenu: ({ children }) => createElement(Fragment, null, children),
	DropdownMenuTrigger: ({ children }) => createElement("span", { "data-trigger": "" }, children),
	DropdownMenuContent: ({ children }) => createElement("div", null, children),
	MenuRadioGroup: ({ children, onValueChange }) => ((pick = onValueChange), createElement("div", null, children)),
	MenuRadioItem: ({ children, value }) => createElement("button", { "data-item": value, onClick: () => pick(value) }, children),
}));
mock.module(dir + "/toaster.tsx", () => ({ toasts: { add: noop } }));
const { createRoot } = await import("react-dom/client");
const { ReviewPanel } = await import(dir + "/review-panel.tsx");
const { liveDraftKey, useComposerDraft } = await import(dir + "/../composer-drafts.ts");

const walk = node => [node, ...node.childNodes.flatMap(walk)];
const find = test => { const node = walk(container).find(test); if (!node) throw new Error("not found: " + test); return node; };
const button = label => walk(container).find(node => node.tagName === "BUTTON" && node.textContent === label) ?? null;
// The panel's ids carry a useId prefix, so "review-ask" finds the field whose id ends in "-ask".
const byId = id => find(node => node.getAttribute?.("id")?.endsWith(id.slice("review".length)));
const slider = () => find(node => node.getAttribute?.("role") === "slider");
function fire(target, type, init = {}) {
	const event = { type, target, srcElement: target, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: 0, isTrusted: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation: noop, ...init };
	for (const capture of [true, false]) for (const each of container.listeners) if (each.type === type && each.capture === capture) each.listener(event);
}
const click = node => act(async () => fire(node, "click", { button: 0 }));
const type = (node, value) => act(async () => { node.value = value; fire(node, "input"); });
const key = (node, name) => act(async () => fire(node, "keydown", { key: name }));

const live = { kind: "live", instanceId: "i1", agentId: null };
const changes = [
	{ title: "Header", before: "/tmp/b1.png", after: "/tmp/a1.png", description: "Tighter header" },
	{ title: "Footer", before: "/tmp/b2.png", after: "/tmp/a2.png", description: "Darker footer" },
];
let composer = "";
function Probe() { composer = useComposerDraft(liveDraftKey(live), "")[0]; return null; }
const root = createRoot(container);
const mount = (props) => act(async () => root.render(createElement(Fragment, null, createElement(Probe), createElement(ReviewPanel, { scope: "s", changes: [changes[0]], live, ...props }))));
const results = {};

switch (process.env.CASE) {
	case "tweak": {
		await mount({});
		results.disabledEmpty = button("Add to composer").getAttribute("disabled") !== null;
		await type(byId("review-ask"), "Make it blue");
		results.disabledTyped = button("Add to composer").getAttribute("disabled") !== null;
		await click(button("Add to composer"));
		results.composer = composer;
		results.ask = byId("review-ask").value;
		break;
	}
	case "revert": {
		await mount({});
		await click(button("Ask to revert"));
		results.composer = composer;
		break;
	}
	case "stopped": {
		await mount({ live: null });
		results.text = container.textContent;
		results.buttons = walk(container).filter(node => node.tagName === "BUTTON").map(node => node.textContent);
		results.fields = walk(container).filter(node => node.tagName === "TEXTAREA" || node.tagName === "INPUT").length;
		break;
	}
	case "slider": {
		await mount({});
		results.start = slider().getAttribute("aria-valuenow");
		await key(slider(), "ArrowRight");
		results.right = slider().getAttribute("aria-valuenow");
		await key(slider(), "End");
		await key(slider(), "ArrowRight");
		results.end = slider().getAttribute("aria-valuenow");
		break;
	}
	case "switch": {
		await mount({ changes });
		await type(byId("review-description"), "Edited header");
		await click(find(node => node.getAttribute?.("data-item")?.startsWith("Footer\n")));
		results.second = { title: find(node => node.getAttribute?.("data-trigger") !== null).textContent, description: (byId("review-description").value ?? byId("review-description").defaultValue) };
		await click(find(node => node.getAttribute?.("data-item")?.startsWith("Header\n")));
		results.first = { title: find(node => node.getAttribute?.("data-trigger") !== null).textContent, description: (byId("review-description").value ?? byId("review-description").defaultValue) };
		break;
	}
}
console.log(JSON.stringify(results));
`;

async function run(name: string) {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: join(import.meta.dir, ".."), env: { ...process.env, CASE: name, DIR: import.meta.dir }, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	return JSON.parse(stdout);
}

test("a quick edit goes to the live composer as a tweak prompt and clears the field; nothing typed keeps the button disabled", async () => {
	const result = await run("tweak");
	expect([result.disabledEmpty, result.disabledTyped]).toEqual([true, false]);
	expect(result.composer).toBe(tweakPrompt({ title: "Header", before: "/tmp/b1.png", after: "/tmp/a1.png", description: "Tighter header" }, { ...EMPTY_DRAFT, ask: "Make it blue" }));
	expect(result.ask).toBe("");
});

test("Ask to revert puts the revert prompt in the live composer", async () => {
	const result = await run("revert");
	expect(result.composer).toBe(revertPrompt({ title: "Header", before: "/tmp/b1.png", after: "/tmp/a1.png", description: "Tighter header" }));
});

test("a stopped session shows the description read-only, asks to resume, and offers no buttons", async () => {
	const result = await run("stopped");
	expect(result.text).toContain("Resume the session to ask for changes.");
	expect(result.text).toContain("Tighter header");
	expect(result.fields).toBe(0);
	expect(result.buttons).toEqual([]);
});

test("the wipe moves 5 per ArrowRight and stops at 100", async () => {
	expect(await run("slider")).toEqual({ start: "50", right: "55", end: "100" });
});

test("each change shows its own description, and going back keeps the first one's edit", async () => {
	const result = await run("switch");
	expect(result.second).toEqual({ title: "Footer", description: "Darker footer" });
	expect(result.first).toEqual({ title: "Header", description: "Edited header" });
});
