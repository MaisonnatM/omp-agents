import { expect, test } from "bun:test";
import type { MailMessage } from "../src/shared/gmail";
import { type FoldEvent, type Folds, foldMessages, foldsAfter, linkParts, mailDocument, NO_FOLDS, recipientsLine } from "./inbox-model";

const message = (id: string, unread = false): MailMessage => ({
	id,
	from: { name: "Alice Doe", address: "alice@example.com" },
	to: [],
	cc: [],
	at: 1791000000000,
	unread,
	snippet: `snippet ${id}`,
	body: { kind: "text", text: id },
	attachments: [],
});

/** Each row as `open:m1`, `closed:m1`, or `stack:m2,m3,m4`. */
const shape = (messages: MailMessage[], folds: Folds = NO_FOLDS): string[] =>
	foldMessages(messages, folds).map(row => (row.kind === "stack" ? `stack:${row.ids.join(",")}` : `${row.kind}:${row.message.id}`));

const after = (...events: FoldEvent[]): Folds => events.reduce(foldsAfter, NO_FOLDS);

const SIX = ["m1", "m2", "m3", "m4", "m5", "m6"].map(id => message(id));

test("the last message starts open, earlier read ones closed, and three or more closed after the first fold into a stack", () => {
	expect(shape(SIX)).toEqual(["closed:m1", "stack:m2,m3,m4,m5", "open:m6"]);
	expect(shape([message("m1")])).toEqual(["open:m1"]);
	expect(shape(SIX.slice(0, 4))).toEqual(["closed:m1", "closed:m2", "closed:m3", "open:m4"]);
	expect(shape(SIX.slice(0, 5))).toEqual(["closed:m1", "stack:m2,m3,m4", "open:m5"]);
});

test("every unread message starts open, and splits the closed run around it", () => {
	const messages = [message("m1"), message("m2"), message("m3"), message("m4", true), message("m5"), message("m6"), message("m7"), message("m8"), message("m9")];
	expect(shape(messages)).toEqual(["closed:m1", "closed:m2", "closed:m3", "open:m4", "stack:m5,m6,m7,m8", "open:m9"]);
});

test("a closed message opens and closes again, an open one closes, the last one too, and closing one never stacks it", () => {
	expect(shape(SIX, after({ kind: "toggle", id: "m1" }))).toEqual(["open:m1", "stack:m2,m3,m4,m5", "open:m6"]);
	expect(shape(SIX, after({ kind: "toggle", id: "m1" }, { kind: "toggle", id: "m1" }))).toEqual(["closed:m1", "stack:m2,m3,m4,m5", "open:m6"]);
	expect(shape(SIX, after({ kind: "toggle", id: "m6" }))).toEqual(["closed:m1", "stack:m2,m3,m4,m5", "closed:m6"]);
	const unread = [message("m1"), message("m2", true), message("m3", true), message("m4", true), message("m5")];
	expect(shape(unread, after({ kind: "toggle", id: "m2" }, { kind: "toggle", id: "m3" }, { kind: "toggle", id: "m4" }))).toEqual([
		"closed:m1",
		"closed:m2",
		"closed:m3",
		"closed:m4",
		"open:m5",
	]);
});

test("unstacking shows each message of the stack closed, and Expand all opens every message for good", () => {
	expect(shape(SIX, after({ kind: "unstack", ids: ["m2", "m3", "m4", "m5"] }))).toEqual(["closed:m1", "closed:m2", "closed:m3", "closed:m4", "closed:m5", "open:m6"]);
	const expanded = after({ kind: "expand-all", messages: SIX });
	expect(shape(SIX, expanded)).toEqual(["open:m1", "open:m2", "open:m3", "open:m4", "open:m5", "open:m6"]);
	const closedAgain = [2, 3, 4].reduce((folds, n) => foldsAfter(folds, { kind: "toggle", id: `m${n}` }), expanded);
	expect(shape(SIX, closedAgain)).toEqual(["open:m1", "closed:m2", "closed:m3", "closed:m4", "open:m5", "open:m6"]);
});

test("the recipients line names the inbox's own address as me, then each name, else address, with cc after", () => {
	const sent: MailMessage = {
		...message("m1"),
		to: [
			{ name: "Max", address: "Max+Work@example.com" },
			{ name: "", address: "bob@example.com" },
		],
		cc: [{ name: "Carol Lee", address: "carol@example.com" }],
	};
	expect(recipientsLine(sent, "max+work@example.com")).toBe("to me, bob@example.com, cc Carol Lee");
	expect(recipientsLine(sent, null)).toBe("to Max, bob@example.com, cc Carol Lee");
	expect(recipientsLine({ ...sent, to: [] }, null)).toBe("cc Carol Lee");
	expect(recipientsLine(message("m2"), null)).toBe("");
});

test("web addresses in plain text become links without the punctuation that ends their sentence", () => {
	expect(linkParts("See https://example.com/a?b=1&c=2. Or (http://x.dev/path), <https://y.io>")).toEqual([
		{ kind: "text", text: "See " },
		{ kind: "link", href: "https://example.com/a?b=1&c=2" },
		{ kind: "text", text: ". Or (" },
		{ kind: "link", href: "http://x.dev/path" },
		{ kind: "text", text: "), <" },
		{ kind: "link", href: "https://y.io" },
		{ kind: "text", text: ">" },
	]);
	expect(linkParts("no links here")).toEqual([{ kind: "text", text: "no links here" }]);
	expect(linkParts("ftp://old.example")).toEqual([{ kind: "text", text: "ftp://old.example" }]);
});

test("a message's HTML renders after a policy that allows only images, styles, and fonts, and sends no referrer", () => {
	const document = mailDocument("<p>Hi</p>");
	const head = document.slice(0, document.indexOf("<body>"));
	expect(head).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:">`);
	expect(head).toContain(`<meta name="referrer" content="no-referrer">`);
	expect(document.endsWith("<body><p>Hi</p></body></html>")).toBe(true);
});
