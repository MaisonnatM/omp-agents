import { expect, test } from "bun:test";

// React DOM mounts a component that renders nothing with only these parts of a document, as in use-webview.test.ts.
const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const replaced = [];
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, location: { replace: url => replaced.push(url) }, IS_REACT_ACT_ENVIRONMENT: true });
// Imported only after the stubs above, since a static import would load React DOM before the document exists.
const { createRoot } = await import("react-dom/client");
const { useOpenLatest } = await import("./use-open-latest.ts");
const { hashForPage } = await import("./routing.ts");
const hashForEmail = target => hashForPage({ kind: "email", target });

const older = { account: "gmail", thread: "a1" };
const newer = { account: "gmail", thread: "q1" };
function Probe({ open, first, ready }) {
	useOpenLatest(hashForEmail, open, first, ready);
	return null;
}
const root = createRoot(container);
const steps = {};
const step = async (name, props) => {
	replaced.length = 0;
	await act(async () => root.render(createElement(Probe, props)));
	steps[name] = [...replaced];
};
await step("before the lists", { open: null, first: null, ready: false });
await step("the lists arrive", { open: null, first: older, ready: true });
await step("the address names it", { open: older, first: older, ready: true });
await step("a newer conversation arrives above it", { open: older, first: newer, ready: true });
await step("Close", { open: null, first: newer, ready: true });
await act(async () => root.unmount());
console.log(JSON.stringify(steps));
`;

test("a bare Email page names its newest conversation in the address once the lists arrive, and neither a later arrival nor Close opens another", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({
		"before the lists": [],
		"the lists arrive": ["#email/gmail/a1"],
		"the address names it": [],
		"a newer conversation arrives above it": [],
		Close: [],
	});
});
