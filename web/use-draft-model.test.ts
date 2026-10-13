import { expect, test } from "bun:test";

// React DOM mounts a component that renders nothing with only these parts of a document, as in reads.test.tsx.
const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });

const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const sonnet = { provider: "anthropic", id: "claude-sonnet-5-5" };
const defaults = { "/opus": opus, "/sonnet": sonnet };
const entry = model => ({ ...model, name: model.id, contextWindow: null, curated: true, thinkingLevels: ["low", "high"] });
// Role reads for a directory in held wait until the scenario answers them.
const held = new Map();
globalThis.fetch = async url => {
	const { pathname, searchParams } = new URL(url, "http://dashboard");
	const cwd = searchParams.get("cwd");
	if (pathname === "/api/models/connected") return Response.json({ models: [entry(opus), entry(sonnet)] });
	const answer = () => Response.json({ roles: [{ role: "default", model: defaults[cwd], thinking: null }] });
	if (!held.has(cwd)) return answer();
	const { promise, resolve } = Promise.withResolvers();
	held.get(cwd).push(() => resolve(answer()));
	return promise;
};
// Imported only after the stubs above, since a static import would load React DOM before the document exists.
const { createRoot } = await import("react-dom/client");
const { useDraftModelSelection } = await import("./use-draft-model.ts");

let selection;
function Probe({ cwd, initial }) {
	selection = useDraftModelSelection(cwd, initial);
	return null;
}
const shown = () => ({ current: selection.picker.current, model: selection.model && selection.model.id, thinking: selection.thinking });
const results = {};
const run = async (name, steps) => {
	const root = createRoot(container);
	const render = (cwd, initial) => act(async () => root.render(createElement(Probe, { cwd, initial })));
	const seen = [];
	await steps({ render, seen: () => seen.push(shown()), act });
	await act(async () => root.unmount());
	results[name] = seen;
};

await run("defaults", async ({ render, seen, act }) => {
	await render("/opus");
	await act(async () => selection.picker.effort.onPick("high"));
	seen();
	await render("/sonnet");
	seen();
	await render("/opus");
	seen();
});
await run("picks", async ({ render, seen, act }) => {
	await render("/opus");
	await act(async () => selection.picker.onPick(sonnet));
	await act(async () => selection.pickThinking("high"));
	seen();
	await act(async () => selection.picker.onPick(opus));
	seen();
	await act(async () => selection.picker.onPick(sonnet));
	seen();
});
await run("retry on the default", async ({ render, seen }) => {
	await render("/opus", { model: null, thinking: "high" });
	seen();
	await render("/sonnet", { model: null, thinking: "high" });
	seen();
});
await run("retry moved before the default is known", async ({ render, seen, act }) => {
	held.set("/opus", []);
	await render("/opus", { model: null, thinking: "high" });
	seen();
	await render("/sonnet", { model: null, thinking: "high" });
	seen();
	await act(async () => held.get("/opus").forEach(answer => answer()));
	await render("/opus", { model: null, thinking: "high" });
	seen();
});
await run("retry on a picked model", async ({ render, seen }) => {
	await render("/opus", { model: sonnet, thinking: "high" });
	seen();
});
console.log(JSON.stringify(results));
`;

test("useDraftModelSelection keeps an effort only for the resolved model it was picked on", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const opus = "anthropic/claude-opus-5-5";
	const sonnet = "anthropic/claude-sonnet-5-5";
	expect(JSON.parse(stdout)).toEqual({
		// A level picked on one directory's default model does not carry to another default model that takes the same level.
		defaults: [
			{ current: opus, model: null, thinking: "high" },
			{ current: sonnet, model: null, thinking: null },
			{ current: opus, model: null, thinking: "high" },
		],
		// Picking another model resets the level, and picking the first model again does not bring it back.
		picks: [
			{ current: sonnet, model: "claude-sonnet-5-5", thinking: "high" },
			{ current: opus, model: "claude-opus-5-5", thinking: null },
			{ current: sonnet, model: "claude-sonnet-5-5", thinking: null },
		],
		// A failed start on the default keeps its level for the default model of its directory once that model is known.
		"retry on the default": [
			{ current: opus, model: null, thinking: "high" },
			{ current: sonnet, model: null, thinking: null },
		],
		"retry moved before the default is known": [
			{ current: null, model: null, thinking: null },
			{ current: sonnet, model: null, thinking: null },
			{ current: opus, model: null, thinking: null },
		],
		"retry on a picked model": [{ current: sonnet, model: "claude-sonnet-5-5", thinking: "high" }],
	});
});
