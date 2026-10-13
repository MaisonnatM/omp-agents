import { describe, expect, test } from "bun:test";
import { buildEditorFromExtensions } from "@lexical/extension";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { decodeMailDraft, draftUnchanged, type MailDocument, mailDraftAfter, type MailDraftState, mailExtension } from "./mail-draft";

function bodyOf(text: string): string {
	const editor = buildEditorFromExtensions(mailExtension);
	editor.update(() => $getRoot().append($createParagraphNode().append($createTextNode(text))), { discrete: true });
	return JSON.stringify(editor.getEditorState().toJSON());
}

const ada = { name: "Ada", address: "ada@example.com" };
const bob = { name: "", address: "bob@example.com" };

const draft: MailDocument = {
	to: [ada],
	cc: [],
	bcc: [bob],
	subject: "Plans",
	body: bodyOf("See you at noon."),
};

describe("decodeMailDraft", () => {
	test("reads back a draft the editor kept", () => {
		expect(decodeMailDraft(JSON.stringify(draft))).toEqual(draft);
	});

	test("reads back a draft whose body holds no text", () => {
		expect(decodeMailDraft(JSON.stringify({ ...draft, body: "" }))).toEqual({ ...draft, body: "" });
	});

	test("nothing kept, or not JSON, reads as no draft", () => {
		expect(decodeMailDraft(null)).toBeNull();
		expect(decodeMailDraft("{not json")).toBeNull();
		expect(decodeMailDraft("[]")).toBeNull();
	});

	test("a partial or mistyped draft reads as no draft", () => {
		expect(decodeMailDraft("{}")).toBeNull();
		const { cc: _cc, ...withoutCc } = draft;
		expect(decodeMailDraft(JSON.stringify(withoutCc))).toBeNull();
		expect(decodeMailDraft(JSON.stringify({ ...draft, to: [{ name: "Ada" }] }))).toBeNull();
		expect(decodeMailDraft(JSON.stringify({ ...draft, bcc: "bob@example.com" }))).toBeNull();
		expect(decodeMailDraft(JSON.stringify({ ...draft, subject: 3 }))).toBeNull();
	});

	test("a body the editor cannot restore reads as no draft", () => {
		expect(decodeMailDraft(JSON.stringify({ ...draft, body: "{not json" }))).toBeNull();
		expect(decodeMailDraft(JSON.stringify({ ...draft, body: "{}" }))).toBeNull();
		const unknownNode = JSON.stringify({ root: { type: "root", version: 1, children: [{ type: "no-such-node", version: 1 }], direction: null, format: "", indent: 0 } });
		expect(decodeMailDraft(JSON.stringify({ ...draft, body: unknownNode }))).toBeNull();
	});
});

describe("mailDraftAfter", () => {
	const start: MailDocument = { to: [ada], cc: [], bcc: [], subject: "", body: "" };
	const begun = mailDraftAfter(null, { kind: "begin", start, kept: null }) as MailDraftState;

	test("a draft begins from the kept one over its start, and is unchanged only while it is its start in every field", () => {
		expect(begun).toEqual({ start, current: start });
		expect(draftUnchanged(begun)).toBe(true);
		expect(mailDraftAfter(null, { kind: "begin", start, kept: draft })).toEqual({ start, current: draft });
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-recipients", field: "bcc", people: [bob] }) as MailDraftState)).toBe(false);
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-subject", subject: "Plans" }) as MailDraftState)).toBe(false);
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-body", body: draft.body }) as MailDraftState)).toBe(false);
		const undone = mailDraftAfter(mailDraftAfter(begun, { kind: "edit-recipients", field: "to", people: [ada, bob] }), { kind: "edit-recipients", field: "to", people: [{ ...ada }] });
		expect(draftUnchanged(undone as MailDraftState)).toBe(true);
	});

	test("choosing a reply mode readdresses the start and the draft, keeping Bcc and every other edit", () => {
		const edited = mailDraftAfter(mailDraftAfter(begun, { kind: "edit-recipients", field: "bcc", people: [bob] }), { kind: "edit-body", body: draft.body });
		const chosen = mailDraftAfter(edited, { kind: "choose-reply-mode", to: [bob], cc: [ada] });
		expect(chosen).toEqual({ start: { ...start, to: [bob], cc: [ada] }, current: { ...start, to: [bob], cc: [ada], bcc: [bob], body: draft.body } });
	});

	test("an edit to no draft is none, and ending one closes it", () => {
		expect(mailDraftAfter(null, { kind: "edit-subject", subject: "Plans" })).toBeNull();
		expect(mailDraftAfter(begun, { kind: "end" })).toBeNull();
	});
});

// A new process mounts the real hook with React DOM and an in-memory localStorage.
const replyScenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const memory = new Map();
const localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
Object.assign(globalThis, { window: globalThis, document, localStorage, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
// React DOM reads these globals as it loads, so it is imported after they are set.
const { createRoot } = await import("react-dom/client");
const { useReplyDraft } = await import("./mail-draft.ts");

const person = (name, address) => ({ name, address });
const me = person("Me", "me@example.com");
const message = (id, from, to, cc) => ({ id, from, to, cc, replyTo: [], at: 0, unread: false, snippet: "", body: { html: null, text: "" }, attachments: [] });
const fromAda = message("m1", person("Ada", "ada@example.com"), [me, person("Bob", "bob@example.com")], []);
const fromCarol = message("m2", person("Carol", "carol@example.com"), [me], [person("Dan", "dan@example.com")]);

let reply;
function Probe({ last }) {
	reply = useReplyDraft("t1", last, me.address);
	return null;
}
const root = createRoot(container);
const render = last => act(async () => root.render(createElement(Probe, { last })));
const seen = [];
const look = step => {
	const kept = memory.get("omp-agents.mail-draft.thread.t1");
	const addresses = people => people.map(({ address }) => address);
	seen.push({ step, all: reply.all, to: addresses(reply.draft.to), cc: addresses(reply.draft.cc), kept: kept === undefined ? null : addresses(JSON.parse(kept).to) });
};

await render(fromAda);
await act(async () => reply.compose(false));
look("reply");
await act(async () => reply.editRecipients("to", [...reply.draft.to, person("Eve", "eve@example.com")]));
look("edit to");
await render(structuredClone(fromAda));
look("same message read again");
await render(fromCarol);
look("new message arrived");
await act(async () => reply.compose(false));
look("reply again");
await act(async () => reply.compose(true));
look("reply all");
console.log(JSON.stringify(seen));
`;

test("a reply's people change only on Reply or Reply all, never on a refreshed or newly arrived message", async () => {
	const child = Bun.spawn([process.execPath, "--eval", replyScenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const edited = ["ada@example.com", "eve@example.com"];
	expect(JSON.parse(stdout)).toEqual([
		{ step: "reply", all: false, to: ["ada@example.com"], cc: [], kept: null },
		{ step: "edit to", all: false, to: edited, cc: [], kept: edited },
		{ step: "same message read again", all: false, to: edited, cc: [], kept: edited },
		{ step: "new message arrived", all: false, to: edited, cc: [], kept: edited },
		{ step: "reply again", all: false, to: edited, cc: [], kept: edited },
		{ step: "reply all", all: true, to: ["carol@example.com"], cc: ["dan@example.com"], kept: null },
	]);
});
