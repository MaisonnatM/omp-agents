import { expect, test } from "bun:test";

// A new process mounts the real hook with React DOM, an in-memory localStorage, and a clock the scenario sets.
const scenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const memory = new Map();
const localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
Object.assign(globalThis, { window: globalThis, document, localStorage, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
let now = 0;
Date.now = () => now;
// React DOM reads these globals as it loads, so it is imported after they are set.
const { createRoot } = await import("react-dom/client");
const { clearDraft, liveDraftKey, newDraftKey, putDraft, useComposerDraft } = await import("./composer-drafts.ts");

const DAY = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "omp-agents.composer-drafts";
const live = (instanceId, agentId = null) => liveDraftKey({ kind: "live", instanceId, agentId });
let composer;
function Probe({ draftKey, seed }) {
	composer = useComposerDraft(draftKey, seed);
	return null;
}
const root = createRoot(container);
const open = async (draftKey, seed = "") => {
	await act(async () => root.render(null));
	await act(async () => root.render(createElement(Probe, { draftKey, seed })));
	return composer[0];
};
const type = text => act(async () => composer[1](text));
const stored = () => JSON.parse(memory.get(STORAGE_KEY) ?? "null");
const results = {};

await open(live("a"));
await type("for a");
await open(live("a", "agent-1"));
await type("for its subagent");
await open(live("b"));
await type("for b");
results.separate = { a: await open(live("a")), subagent: await open(live("a", "agent-1")), b: await open(live("b")), stored: stored() };

memory.clear();
results.seeded = [await open(newDraftKey("t1"), "Fix the build")];
await type("Fix the build first");
results.seeded.push(stored());
await type("Fix the build");
results.seeded.push(stored());
await type("Something else");
await type("");
results.seeded.push(stored(), await open(newDraftKey("t1"), "Fix the build"));

memory.clear();
putDraft(live("fork"), "the prompt it branched at");
results.put = await open(live("fork"));
clearDraft(live("fork"));
results.cleared = await open(live("fork"));

memory.clear();
putDraft(live("old"), "old");
now = 2 * DAY;
putDraft(live("recent"), "recent");
now = 31 * DAY;
putDraft(newDraftKey(null), "new");
results.expiry = stored();

memory.set(STORAGE_KEY, "{not json");
results.corrupt = await open(live("a"));
memory.set(STORAGE_KEY, JSON.stringify({ "live/a": { text: 3, at: now }, "live/b": "bare", "live/c": { text: "kept", at: now } }));
results.mistyped = [await open(live("a")), await open(live("b")), await open(live("c"))];
await act(async () => root.unmount());
console.log(JSON.stringify(results));
`;

test("each composer keeps its own draft, forgets one equal to its seed or empty, and drops drafts untouched for 30 days or unreadable", async () => {
	const child = Bun.spawn([process.execPath, "--eval", scenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const day = 24 * 60 * 60 * 1000;
	expect(JSON.parse(stdout)).toEqual({
		separate: {
			a: "for a",
			subagent: "for its subagent",
			b: "for b",
			stored: { "live/a": { text: "for a", at: 0 }, "live/a/agent-1": { text: "for its subagent", at: 0 }, "live/b": { text: "for b", at: 0 } },
		},
		seeded: ["Fix the build", { "new/todo/t1": { text: "Fix the build first", at: 0 } }, {}, {}, "Fix the build"],
		put: "the prompt it branched at",
		cleared: "",
		expiry: { "live/recent": { text: "recent", at: 2 * day }, new: { text: "new", at: 31 * day } },
		corrupt: "",
		mistyped: ["", "", "kept"],
	});
});
