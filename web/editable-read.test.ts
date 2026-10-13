import { describe, expect, test } from "bun:test";
import { type EditableEvent, type EditableState, emptyEditable, reduceEditable, shownOf } from "./editable-read";

interface Item {
	title: string;
	state: string;
}

const URL_A = "/api/item?id=a";
const run = (events: EditableEvent<Item>[], start: EditableState<Item> = emptyEditable<Item>(URL_A)): EditableState<Item> => events.reduce(reduceEditable<Item>, start);
const read = (data: Item, revision: number, url = URL_A): EditableEvent<Item> => ({ url, kind: "read", data, revision });
const edited = (id: number, shown: Partial<Item>, url = URL_A): EditableEvent<Item> => ({ url, kind: "edited", id, shown });
const saved = (id: number | null, data: Item, revision: number, url = URL_A): EditableEvent<Item> => ({ url, kind: "saved", id, data, revision });
const refused = (id: number, error: string, url = URL_A): EditableEvent<Item> => ({ url, kind: "refused", id, error });

describe("editable read", () => {
	test("an earlier edit's answer becomes the confirmed answer, with the later edits still showing over it", () => {
		const first = run([read({ title: "old", state: "todo" }, 0), edited(1, { title: "new" }), edited(2, { state: "done" })]);
		expect(shownOf(first)).toEqual({ title: "new", state: "done" });
		const answered = run([saved(1, { title: "new", state: "todo" }, 1)], first);
		expect(shownOf(answered)).toEqual({ title: "new", state: "done" });
		expect(answered.confirmed).toEqual({ data: { title: "new", state: "todo" }, revision: 1 });
		expect(shownOf(run([saved(2, { title: "new", state: "done" }, 2)], answered))).toEqual({ title: "new", state: "done" });
	});

	test("a read sent before a write answered cannot replace that write's answer, and one sent after it can", () => {
		const answered = run([read({ title: "old", state: "todo" }, 0), edited(1, { title: "new" }), saved(1, { title: "new", state: "todo" }, 1)]);
		const late = run([read({ title: "old", state: "todo" }, 0)], answered);
		expect(late).toBe(answered);
		expect(shownOf(late)).toEqual({ title: "new", state: "todo" });
		expect(shownOf(run([read({ title: "new", state: "doing" }, 1)], answered))).toEqual({ title: "new", state: "doing" });
	});

	test("a read that answers while an edit is pending keeps the edit showing over it", () => {
		const state = run([read({ title: "old", state: "todo" }, 0), edited(1, { title: "new" }), read({ title: "old", state: "doing" }, 0)]);
		expect(shownOf(state)).toEqual({ title: "new", state: "doing" });
	});

	test("a refused edit is undone and named, the edits after it still show, and the next edit clears the refusal", () => {
		const refusedFirst = run([read({ title: "old", state: "todo" }, 0), edited(1, { title: "new" }), edited(2, { state: "done" }), refused(1, "Linear is down")]);
		expect(shownOf(refusedFirst)).toEqual({ title: "old", state: "done" });
		expect(refusedFirst.saveError).toBe("Linear is down");
		const again = run([edited(3, { title: "newer" })], refusedFirst);
		expect(again.saveError).toBeNull();
		expect(shownOf(again)).toEqual({ title: "newer", state: "done" });
	});

	test("a write's answer for another resource is dropped, and a read of another resource starts it afresh", () => {
		const shown = run([read({ title: "old", state: "todo" }, 0), edited(1, { title: "new" })]);
		expect(run([saved(1, { title: "elsewhere", state: "todo" }, 1, "/api/item?id=b")], shown)).toBe(shown);
		expect(run([refused(1, "gone", "/api/item?id=b")], shown)).toBe(shown);
		const other = run([read({ title: "b", state: "todo" }, 0, "/api/item?id=b")], shown);
		expect(other).toEqual({ url: "/api/item?id=b", confirmed: { data: { title: "b", state: "todo" }, revision: 0 }, error: null, pending: [], saveError: null });
	});

	test("a failed read keeps what shows and names why, until an answer comes", () => {
		const failed = run([read({ title: "old", state: "todo" }, 0), { url: URL_A, kind: "unread", error: "offline" }]);
		expect(shownOf(failed)).toEqual({ title: "old", state: "todo" });
		expect(failed.error).toBe("offline");
		expect(run([saved(null, { title: "old", state: "done" }, 1)], failed).error).toBeNull();
	});
});

// The hook runs in a new process with React DOM and a fetch whose answers the scenario releases in its own order.
const hookScenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
const reads = [];
globalThis.fetch = () => {
	const { promise, resolve } = Promise.withResolvers();
	reads.push(resolve);
	return promise;
};
// React DOM and the hook load after the stand-in document and fetch exist, so they import dynamically.
const { createRoot } = await import("react-dom/client");
const { useEditableRead } = await import("./editable-read.ts");

const seen = [];
let resource;
function Probe() {
	resource = useEditableRead("/api/item");
	const state = JSON.stringify({ data: resource.data, saveError: resource.saveError });
	if (seen.at(-1) !== state) seen.push(state);
	return null;
}
const root = createRoot(container);
await act(async () => root.render(createElement(Probe)));
const answerRead = body => act(async () => reads.shift()(new Response(JSON.stringify(body), { status: 200 })));
const writes = [];
const write = () => {
	const sent = Promise.withResolvers();
	writes.push(sent);
	return sent.promise;
};
await answerRead({ title: "old", state: "todo" });
await act(async () => {
	resource.edit({ title: "new" }, write);
	resource.edit({ state: "done" }, write);
	resource.reload();
});
// The first write answers before the read sent while it was in flight, and before the second write.
await act(async () => writes[0].resolve({ title: "new", state: "todo" }));
await answerRead({ title: "old", state: "todo" });
await act(async () => writes[1].reject(new Error("Linear is down")));
console.log(JSON.stringify({ writes: writes.length, seen: seen.map(state => JSON.parse(state)) }));
`;

test("useEditableRead keeps later edits over an earlier answer, ignores a stale read, and undoes a refused edit", async () => {
	const child = Bun.spawn([process.execPath, "--eval", hookScenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({
		writes: 2,
		seen: [
			{ data: null, saveError: null },
			{ data: { title: "old", state: "todo" }, saveError: null },
			{ data: { title: "new", state: "done" }, saveError: null },
			{ data: { title: "new", state: "todo" }, saveError: "Linear is down" },
		],
	});
});
