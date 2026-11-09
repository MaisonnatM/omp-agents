/** A floating sidebar, as on a phone, starts closed whatever the window stores, and opening it leaves the stored state alone. */
import { expect, test } from "bun:test";

const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop, querySelector: () => null };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const store = new Map([["omp-agents.sidebar-open", "true"], ["omp-agents.plan-open", "true"]]);
const localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
const matchMedia = query => ({ matches: globalThis.innerWidth < Number(/width < (\d+)px/.exec(query)?.[1] ?? 0), addEventListener: noop, removeEventListener: noop });
Object.assign(globalThis, { window: globalThis, document, localStorage, matchMedia, innerWidth: Number(process.env.WIDTH), addEventListener: noop, removeEventListener: noop, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");
const { useSidebarPanels } = await import("./sidebar-panel.tsx");

let panels;
function Probe() {
	panels = useSidebarPanels();
	return null;
}
const root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
const before = { left: panels.panels.left.open, right: panels.panels.right.open, floating: panels.panels.left.floating };
await act(async () => panels.setOpen("right", true));
const opened = panels.panels.right.open;
await act(async () => panels.setOpen("right", false));
console.log(JSON.stringify({ ...before, opened, stored: Object.fromEntries(store) }));
`;

async function run(width: number) {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, env: { ...process.env, WIDTH: String(width) }, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	return JSON.parse(stdout);
}

test("on a phone both sidebars start closed though the window stores them open, and opening one stores nothing", async () => {
	const phone = await run(390);
	expect([phone.floating, phone.left, phone.right, phone.opened]).toEqual([true, false, false, true]);
	expect(phone.stored).toEqual({ "omp-agents.sidebar-open": "true", "omp-agents.plan-open": "true" });
});

test("in a wide window the sidebars open as the window stores them", async () => {
	const wide = await run(1440);
	expect([wide.floating, wide.left, wide.right]).toEqual([false, true, true]);
});
