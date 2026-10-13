import { describe, expect, test } from "bun:test";
import { buildEditorFromExtensions } from "@lexical/extension";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { decodeMailDraft, draftUnchanged, type MailDocument, mailDraftAfter, type MailDraftEvent, type MailDraftState, mailExtension, sendMailDraft } from "./mail-draft";

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
		expect(begun).toEqual({ start, current: start, phase: { kind: "editing", failure: null } });
		expect(draftUnchanged(begun)).toBe(true);
		expect(mailDraftAfter(null, { kind: "begin", start, kept: draft })).toEqual({ start, current: draft, phase: { kind: "editing", failure: null } });
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-recipients", field: "bcc", people: [bob] }) as MailDraftState)).toBe(false);
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-subject", subject: "Plans" }) as MailDraftState)).toBe(false);
		expect(draftUnchanged(mailDraftAfter(begun, { kind: "edit-body", body: draft.body }) as MailDraftState)).toBe(false);
		const undone = mailDraftAfter(mailDraftAfter(begun, { kind: "edit-recipients", field: "to", people: [ada, bob] }), { kind: "edit-recipients", field: "to", people: [{ ...ada }] });
		expect(draftUnchanged(undone as MailDraftState)).toBe(true);
	});

	test("choosing a reply mode readdresses the start and the draft, keeping Bcc and every other edit", () => {
		const edited = mailDraftAfter(mailDraftAfter(begun, { kind: "edit-recipients", field: "bcc", people: [bob] }), { kind: "edit-body", body: draft.body });
		const chosen = mailDraftAfter(edited, { kind: "choose-reply-mode", to: [bob], cc: [ada] });
		expect(chosen).toEqual({ start: { ...start, to: [bob], cc: [ada] }, current: { ...start, to: [bob], cc: [ada], bcc: [bob], body: draft.body }, phase: { kind: "editing", failure: null } });
	});

	test("an edit to no draft is none, and ending one closes it", () => {
		expect(mailDraftAfter(null, { kind: "edit-subject", subject: "Plans" })).toBeNull();
		expect(mailDraftAfter(begun, { kind: "end" })).toBeNull();
	});

	test("a draft being sent takes no edit until the send settles", () => {
		const sending = mailDraftAfter(begun, { kind: "send" }) as MailDraftState;
		expect(sending.phase).toEqual({ kind: "sending" });
		const edits: MailDraftEvent[] = [
			{ kind: "edit-recipients", field: "to", people: [bob] },
			{ kind: "edit-subject", subject: "Later" },
			{ kind: "edit-body", body: draft.body },
			{ kind: "choose-reply-mode", to: [bob], cc: [] },
			{ kind: "send" },
		];
		for (const event of edits) expect(mailDraftAfter(sending, event)).toBe(sending);
		expect(mailDraftAfter(sending, { kind: "send-failed", error: "offline" })).toEqual({ ...begun, phase: { kind: "editing", failure: "offline" } });
		expect(mailDraftAfter(sending, { kind: "sent" })).toBeNull();
	});

	test("a settled send means nothing to a draft not being sent", () => {
		expect(mailDraftAfter(begun, { kind: "send-failed", error: "offline" })).toBe(begun);
		expect(mailDraftAfter(begun, { kind: "sent" })).toBe(begun);
	});
});

describe("sendMailDraft", () => {
	const start: MailDocument = { to: [ada], cc: [], bcc: [], subject: "", body: "" };
	/** A draft written as `draft`, the events `sendMailDraft` dispatches applied to it as React's reducer would. */
	function harness() {
		const run = { state: mailDraftAfter(null, { kind: "begin", start, kept: draft }), forgotten: false };
		const dispatch = (event: MailDraftEvent): void => {
			run.state = mailDraftAfter(run.state, event);
		};
		return { run, dispatch };
	}

	test("a delivered mail stays sent when the browser cannot forget its draft", async () => {
		const { run, dispatch } = harness();
		const errors: unknown[] = [];
		const consoleError = console.error;
		console.error = (...args: unknown[]) => errors.push(...args);
		try {
			const sent = await sendMailDraft(draft, async () => {}, dispatch, () => {
				throw new Error("storage is full");
			});
			expect(sent).toBe(true);
		} finally {
			console.error = consoleError;
		}
		expect(run.state).toBeNull();
		expect(errors).toContainEqual(new Error("storage is full"));
	});

	test("a failed delivery reopens the submitted draft with why, and keeps it in the browser", async () => {
		const { run, dispatch } = harness();
		const sent = await sendMailDraft(
			draft,
			async () => {
				throw new Error("Gmail answered 500");
			},
			dispatch,
			() => {
				run.forgotten = true;
			},
		);
		expect(sent).toBe(false);
		expect(run.state).toEqual({ start, current: draft, phase: { kind: "editing", failure: "Gmail answered 500" } });
		expect(run.forgotten).toBe(false);
	});

	test("edits made while the mail is sent change neither what is sent nor reopen the draft", async () => {
		const { run, dispatch } = harness();
		const delivered: MailDocument[] = [];
		const delivery = Promise.withResolvers<void>();
		const sending = sendMailDraft(
			draft,
			submitted => {
				delivered.push(submitted);
				return delivery.promise;
			},
			dispatch,
			() => {
				run.forgotten = true;
			},
		);
		const frozen = run.state;
		dispatch({ kind: "edit-body", body: bodyOf("Actually, one more thing.") });
		dispatch({ kind: "edit-recipients", field: "cc", people: [bob] });
		dispatch({ kind: "edit-subject", subject: "Changed plans" });
		expect(run.state).toBe(frozen);
		delivery.resolve();
		expect(await sending).toBe(true);
		expect(delivered).toEqual([draft]);
		expect(run.state).toBeNull();
		expect(run.forgotten).toBe(true);
	});
});

// A new process mounts the real hook with React DOM and an in-memory localStorage, whose removal fails once `storage.fail` is set.
const hookScenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
const memory = new Map();
const storage = { fail: false };
const localStorage = {
	getItem: key => memory.get(key) ?? null,
	setItem: (key, value) => memory.set(key, value),
	removeItem: key => {
		if (storage.fail) throw new Error("storage is full");
		memory.delete(key);
	},
};
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
const addresses = people => people.map(({ address }) => address);
`;

const replyScenario = `${hookScenario}
const seen = [];
const look = step => {
	const kept = memory.get("omp-agents.mail-draft.thread.t1");
	seen.push({ step, all: reply.all, to: addresses(reply.draft.document.to), cc: addresses(reply.draft.document.cc), kept: kept === undefined ? null : addresses(JSON.parse(kept).to) });
};

await render(fromAda);
await act(async () => reply.compose(false));
look("reply");
await act(async () => reply.editRecipients("to", [...reply.draft.document.to, person("Eve", "eve@example.com")]));
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

const sendScenario = `${hookScenario}
const errors = [];
console.error = (...args) => errors.push(...args.map(String));
const seen = [];
const look = (step, extra = {}) =>
	seen.push({ step, ...extra, phase: reply.draft?.phase ?? null, all: reply.all, to: reply.draft ? addresses(reply.draft.document.to) : null, kept: memory.has("omp-agents.mail-draft.thread.t1") });

await render(fromAda);
await act(async () => reply.compose(false));
await act(async () => reply.editRecipients("to", [...reply.draft.document.to, person("Eve", "eve@example.com")]));
let sent;
await act(async () => {
	sent = await reply.send(async () => {
		throw new Error("Gmail answered 500");
	});
});
look("send failed", { sent });

const delivered = [];
const delivery = Promise.withResolvers();
let sending;
await act(async () => {
	sending = reply.send(submitted => {
		delivered.push(addresses(submitted.to));
		return delivery.promise;
	});
});
look("sending");
await act(async () => {
	reply.editRecipients("to", []);
	reply.editSubject("Later");
	reply.compose(true);
});
look("edited while sending");
storage.fail = true;
await act(async () => {
	delivery.resolve();
	sent = await sending;
});
look("sent, its draft not forgotten", { sent, delivered });
console.log(JSON.stringify({ seen, errors }));
`;

test("a reply being sent takes no edit, and stays sent when the browser cannot forget its draft", async () => {
	const child = Bun.spawn([process.execPath, "--eval", sendScenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const edited = ["ada@example.com", "eve@example.com"];
	const { seen, errors } = JSON.parse(stdout);
	expect(seen).toEqual([
		{ step: "send failed", sent: false, phase: { kind: "editing", failure: "Gmail answered 500" }, all: false, to: edited, kept: true },
		{ step: "sending", phase: { kind: "sending" }, all: false, to: edited, kept: true },
		{ step: "edited while sending", phase: { kind: "sending" }, all: false, to: edited, kept: true },
		{ step: "sent, its draft not forgotten", sent: true, delivered: [edited], phase: null, all: false, to: null, kept: true },
	]);
	expect(errors).toEqual(["The mail was sent, but the browser could not forget its draft", "Error: storage is full"]);
});
