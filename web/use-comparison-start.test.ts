import { expect, test } from "bun:test";

const scenario = String.raw`
import { act, createElement } from "react";
const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const storage = new Map();
let serial = 0;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true,
	sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
});
Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "comparison-" + ++serial }, configurable: true });
const { createRoot } = await import("react-dom/client");
const { useComparisonStart } = await import("./use-comparison-start.ts");
let selection;
let handler;
const calls = [];
const navigations = [];
function Probe() {
	selection = useComparisonStart(async (id, spec) => {
		calls.push({ id, spec, storedBeforeSend: storage.get("omp-agents.pending-comparison") });
		await handler();
		navigations.push("#comparisons/" + id);
	});
	return null;
}
let root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
const spec = { cwd: "/repo/web", prompt: "Design navigation", images: [{ mimeType: "image/png", data: "aGVsbG8=" }], base: "main", model: { provider: "anthropic", id: "opus" }, thinking: "high", skill: "design", variants: [
	{ model: null, thinking: null }, { model: { provider: "openai", id: "gpt-5" }, thinking: "low" }, { model: null, thinking: null }, { model: null, thinking: null }, { model: null, thinking: null },
] };
const held = Promise.withResolvers();
handler = () => held.promise;
await act(async () => { void selection.start(spec); void selection.start(spec); });
const pending = selection.launch;
await act(async () => held.resolve());
const accepted = { launch: selection.launch, stored: storage.get("omp-agents.pending-comparison") ?? null, navigations: [...navigations] };
await act(async () => root.unmount());
root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
handler = async () => { throw new Error("FORGOTTEN"); };
await act(async () => selection.start(spec));
const uncertain = selection.launch;
await act(async () => root.unmount());
root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
await act(async () => selection.start(spec));
const recovered = { launch: selection.launch.kind, id: selection.launch.id, calls: calls.length, stored: storage.get("omp-agents.pending-comparison") };
await act(async () => selection.reset());
handler = async () => {};
await act(async () => selection.start(spec));
const separate = { calls: calls.length, navigations: [...navigations] };
await act(async () => root.unmount());
console.log(JSON.stringify({ pending, accepted, uncertain, recovered, separate, firstCall: calls[0] }));
`;

test("comparison launch persists its caller id before one send, retains uncertainty across reload, and never automatically resends", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({
		pending: { kind: "pending", id: "comparison-1" },
		accepted: { launch: { kind: "ready" }, stored: null, navigations: ["#comparisons/comparison-1"] },
		uncertain: { kind: "uncertain", id: "comparison-2", error: "FORGOTTEN" },
		recovered: { launch: "uncertain", id: "comparison-2", calls: 2, stored: "comparison-2" },
		separate: { calls: 3, navigations: ["#comparisons/comparison-1", "#comparisons/comparison-3"] },
		firstCall: {
			id: "comparison-1", storedBeforeSend: "comparison-1",
			spec: { cwd: "/repo/web", prompt: "Design navigation", images: [{ mimeType: "image/png", data: "aGVsbG8=" }], base: "main", model: { provider: "anthropic", id: "opus" }, thinking: "high", skill: "design", variants: [
				{ model: null, thinking: null }, { model: { provider: "openai", id: "gpt-5" }, thinking: "low" }, { model: null, thinking: null }, { model: null, thinking: null }, { model: null, thinking: null },
			] },
		},
	});
});
