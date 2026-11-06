import { expect, test } from "bun:test";

// React DOM mounts a component that renders nothing with only these parts of a document, as in reads.test.tsx.
const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
// Imported only after the stubs above, since a static import would load React DOM before the document exists.
const { createRoot } = await import("react-dom/client");
const { useSignIn } = await import("./use-sign-in.ts");

const refresh = async () => {};
const start = async () => {
	throw new Error("The server did not answer");
};
let controls;
function Probe({ signIn }) {
	controls = useSignIn(signIn, refresh, start);
	return null;
}
const root = createRoot(container);
const show = signIn => act(async () => root.render(createElement(Probe, { signIn })));
await show(null);
await act(async () => controls.connect());
const failed = controls.failure;
// The sign-in started after all, as another window or a later read shows, then ends.
await show({ phase: "waiting", url: "https://example.com/authorize" });
const waiting = controls.failure;
await show(null);
const ended = controls.failure;
await act(async () => root.unmount());
console.log(JSON.stringify({ failed, waiting, ended }));
`;

test("a failed start is forgotten once the server reports a sign-in page", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({ failed: "The server did not answer", waiting: null, ended: null });
});
