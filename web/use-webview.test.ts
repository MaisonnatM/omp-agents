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
const { useWebview } = await import("./use-webview.ts");

let webview;
function Probe({ initial }) {
	webview = useWebview({ initial, onPick: noop, onNavigate: noop, onEscape: noop, sessionPorts: [] });
	return null;
}
const results = {};
const run = async (name, steps) => {
	const root = createRoot(container);
	const seen = [];
	await steps({
		render: initial => act(async () => root.render(createElement(Probe, { initial }))),
		act,
		seen: () => seen.push({ src: webview.src, address: webview.address, problem: webview.problem }),
	});
	await act(async () => root.unmount());
	results[name] = seen;
};

await run("saved", async ({ render, seen }) => {
	await render("http://localhost:5173/");
	seen();
});
await run("found later", async ({ render, seen }) => {
	await render(null);
	seen();
	await render("http://localhost:5173/");
	seen();
	await render("http://localhost:3000/");
	seen();
});
await run("typed first", async ({ render, act, seen }) => {
	await render(null);
	await act(async () => webview.setAddress("localhost:3000"));
	await render("http://localhost:5173/");
	seen();
	await act(async () => webview.load(webview.address));
	seen();
});
await run("not on this computer", async ({ render, act, seen }) => {
	await render(null);
	await act(async () => webview.load("example.com"));
	seen();
});
console.log(JSON.stringify(results));
`;

test("the webview opens on the first address found unless the user typed one first, and loads only addresses on this computer", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const vite = "http://localhost:5173/";
	expect(JSON.parse(stdout)).toEqual({
		saved: [{ src: vite, address: vite, problem: null }],
		"found later": [
			{ src: null, address: "", problem: null },
			{ src: vite, address: vite, problem: null },
			{ src: vite, address: vite, problem: null },
		],
		"typed first": [
			{ src: null, address: "localhost:3000", problem: null },
			{ src: "http://localhost:3000", address: "http://localhost:3000", problem: null },
		],
		"not on this computer": [{ src: null, address: "", problem: "The Browser loads only addresses on this computer, such as http://localhost:5173." }],
	});
});
