import { describe, expect, test } from "bun:test";
import { buildEditorFromExtensions } from "@lexical/extension";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { decodeMailDraft, mailExtension, type StoredDraft } from "./mail-draft";

function bodyOf(text: string): string {
	const editor = buildEditorFromExtensions(mailExtension);
	editor.update(() => $getRoot().append($createParagraphNode().append($createTextNode(text))), { discrete: true });
	return JSON.stringify(editor.getEditorState().toJSON());
}

const draft: StoredDraft = {
	to: [{ name: "Ada", address: "ada@example.com" }],
	cc: [],
	bcc: [{ name: "", address: "bob@example.com" }],
	subject: "Plans",
	body: bodyOf("See you at noon."),
};

describe("decodeMailDraft", () => {
	test("reads back a draft the editor kept", () => {
		expect(decodeMailDraft(JSON.stringify(draft))).toEqual(draft);
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
