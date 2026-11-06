import { expect, test } from "bun:test";

// React DOM mounts a component that renders nothing with only these parts of a document, as in reads.test.tsx.
const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
// The hook's close timer runs when the scenario says, through a window of its own.
const timers = [];
const window = Object.assign(Object.create(globalThis), { setTimeout: run => timers.push(run), clearTimeout: noop });
Object.assign(globalThis, { window, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
// Imported only after the stubs above, since a static import would load React DOM before the document exists.
const { createRoot } = await import("react-dom/client");
const { useHoverPopover } = await import("./use-hover-popover.ts");

let popover;
function Probe() {
	popover = useHoverPopover();
	return null;
}
const root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
const click = () => {
	let prevented = false;
	act(() => popover.trigger.onClick({ preventDefault: () => (prevented = true) }));
	return prevented;
};
await act(async () => popover.trigger.onPointerEnter({ pointerType: "mouse" }));
const hoverOpened = popover.root.open;
await act(async () => popover.trigger.onPointerLeave());
await act(async () => timers.splice(0).forEach(run => run()));
const closed = !popover.root.open;
// A pen or touch tap on the trigger after the hover closed it: Radix opens the popover unless the click is prevented.
const tapPrevented = click();
await act(async () => root.unmount());
console.log(JSON.stringify({ hoverOpened, closed, tapPrevented }));
`;

test("a tap on the trigger after a hover-opened popover closed is left to open it", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({ hoverOpened: true, closed: true, tapPrevented: false });
});
