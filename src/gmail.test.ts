import { expect, test } from "bun:test";
import { GmailClient } from "./gmail";
import type { GoogleFetch } from "./integrations";

const PROFILE = { emailAddress: "max+work@example.com", messagesTotal: 1204, threadsTotal: 873, historyId: "9921" };

/** A message as Gmail's `threads.get` answers it with `format=metadata` and the From and Subject headers. */
function message(id: string, from: string, subject: string | null, labelIds: string[], internalDate: string) {
	return {
		id,
		threadId: "ignored",
		labelIds,
		snippet: "a message snippet",
		sizeEstimate: 4180,
		historyId: "9900",
		internalDate,
		payload: {
			partId: "",
			mimeType: "multipart/alternative",
			headers: [{ name: "From", value: from }, ...(subject === null ? [] : [{ name: "Subject", value: subject }])],
		},
	};
}

const REVIEW = {
	id: "18f2a",
	historyId: "9910",
	messages: [
		message("m1", '"Alice Doe" <alice@example.com>', "Draft review", ["INBOX", "CATEGORY_PERSONAL"], "1791000000000"),
		message("m2", "Bob Stone <bob@example.com>", "Re: Draft review", ["UNREAD", "IMPORTANT", "INBOX"], "1791003600000"),
	],
};

const RECEIPT = { id: "18e07", historyId: "9800", messages: [message("m3", "receipts@shop.example", null, ["INBOX"], "1790900000000")] };

const INBOX = "/gmail/v1/users/me/threads";

/** A client over `answers`, by the path of each address, with the addresses it read. */
function clientOf(answers: Record<string, unknown>): { client: GmailClient; reads: string[] } {
	const reads: string[] = [];
	const fetch: GoogleFetch = async url => {
		reads.push(url);
		const answer = answers[new URL(url).pathname];
		if (answer instanceof Error) throw answer;
		if (answer === undefined) throw new Error(`unexpected read ${url}`);
		return answer;
	};
	return { client: new GmailClient(fetch), reads };
}

const twoThreads = (): Record<string, unknown> => ({
	"/gmail/v1/users/me/profile": PROFILE,
	[INBOX]: {
		threads: [
			{ id: "18f2a", snippet: "Looks good to me", historyId: "9910" },
			{ id: "18e07", snippet: "Your order shipped", historyId: "9800" },
		],
		resultSizeEstimate: 2,
	},
	[`${INBOX}/18f2a`]: REVIEW,
	[`${INBOX}/18e07`]: RECEIPT,
});

test("the inbox lists each thread in Gmail's order with its last sender, first subject, unread state, size, arrival, and link", async () => {
	const { client, reads } = clientOf(twoThreads());
	expect(await client.inbox()).toEqual({
		address: "max+work@example.com",
		threads: [
			{
				id: "18f2a",
				from: "Bob Stone",
				subject: "Draft review",
				snippet: "Looks good to me",
				at: 1791003600000,
				unread: true,
				count: 2,
				url: "https://mail.google.com/mail/?authuser=max%2Bwork%40example.com#inbox/18f2a",
			},
			{
				id: "18e07",
				from: "receipts@shop.example",
				subject: "",
				snippet: "Your order shipped",
				at: 1790900000000,
				unread: false,
				count: 1,
				url: "https://mail.google.com/mail/?authuser=max%2Bwork%40example.com#inbox/18e07",
			},
		],
	});
	const list = new URL(reads.find(url => new URL(url).pathname === INBOX)!);
	expect(Object.fromEntries(list.searchParams)).toEqual({ labelIds: "INBOX", maxResults: "50" });
	const thread = new URL(reads.find(url => url.includes("18f2a"))!);
	expect([thread.searchParams.get("format"), thread.searchParams.getAll("metadataHeaders")]).toEqual(["metadata", ["From", "Subject"]]);
});

test("a snippet's HTML entities read as the characters they stand for", async () => {
	const answers = twoThreads();
	answers[INBOX] = { threads: [{ id: "18f2a", snippet: "Tom &amp; Jerry&#39;s &lt;draft&gt; is &quot;ready&quot; &#x1F44B; &nbsp;" }] };
	expect((await clientOf(answers).client.inbox()).threads.map(thread => thread.snippet)).toEqual(["Tom & Jerry's <draft> is \"ready\" 👋 &nbsp;"]);
});

test("a thread without an id or without messages is left out", async () => {
	const answers = twoThreads();
	answers[INBOX] = { threads: [{ snippet: "no id" }, { id: "18f2a", snippet: "" }, { id: "18e07", snippet: "" }] };
	answers[`${INBOX}/18f2a`] = { id: "18f2a", historyId: "9910" };
	expect((await clientOf(answers).client.inbox()).threads.map(thread => thread.id)).toEqual(["18e07"]);
});

test("a draft of your reply does not count as the thread's last message", async () => {
	const answers = twoThreads();
	answers[`${INBOX}/18f2a`] = { ...REVIEW, messages: [...REVIEW.messages, message("m4", "Max <max+work@example.com>", "Re: Draft review", ["DRAFT"], "1791007200000")] };
	const [review] = (await clientOf(answers).client.inbox()).threads;
	expect([review?.from, review?.at, review?.count]).toEqual(["Bob Stone", 1791003600000, 2]);
});

test("an empty inbox lists no threads", async () => {
	const answers = twoThreads();
	answers[INBOX] = { resultSizeEstimate: 0 };
	expect(await clientOf(answers).client.inbox()).toEqual({ address: "max+work@example.com", threads: [] });
});

test("a thread that cannot be read fails the read with Google's reason", async () => {
	const answers = twoThreads();
	answers[`${INBOX}/18e07`] = new Error("Requested entity was not found.");
	await expect(clientOf(answers).client.inbox()).rejects.toThrow("Requested entity was not found.");
});

test("a second read within a minute asks Gmail nothing, and a fresh one reads again", async () => {
	const { client, reads } = clientOf(twoThreads());
	await client.inbox();
	expect(reads).toHaveLength(4);
	await client.inbox();
	expect(reads).toHaveLength(4);
	await client.inbox(true);
	expect(reads).toHaveLength(8);
});

/** A MIME part as Gmail's `format=full` answers it. */
interface FakePart {
	partId: string;
	mimeType: string;
	filename: string;
	headers: { name: string; value: string }[];
	body: { size: number; data?: string; attachmentId?: string };
	parts?: FakePart[];
}

function part(mimeType: string, content: { text?: string | Uint8Array; charset?: string; filename?: string; size?: number; parts?: FakePart[] } = {}): FakePart {
	const { text, charset, filename = "", size, parts } = content;
	const data = text === undefined ? undefined : Buffer.from(text).toString("base64url");
	return {
		partId: "0",
		mimeType,
		filename,
		headers: [{ name: "Content-Type", value: charset ? `${mimeType}; charset="${charset}"` : mimeType }],
		body: data === undefined ? { size: size ?? 0, ...(filename && { attachmentId: `att-${filename}` }) } : { size: size ?? data.length, data },
		...(parts && { parts }),
	};
}

/** A message as Gmail's `threads.get` answers it with `format=full`. */
function fullMessage(id: string, headers: Record<string, string>, labelIds: string[], internalDate: string, payload: FakePart, snippet = "a snippet") {
	return {
		id,
		threadId: "18f2a",
		labelIds,
		snippet,
		internalDate,
		payload: { ...payload, headers: [...payload.headers, ...Object.entries(headers).map(([name, value]) => ({ name, value }))] },
	};
}

const THREAD = `${INBOX}/18f2a`;

/** A client whose Gmail holds conversation 18f2a with `messages`, plus the inbox of {@link twoThreads}. */
const threadClient = (...messages: unknown[]) => clientOf({ ...twoThreads(), [THREAD]: { id: "18f2a", historyId: "9910", messages } });

test("a conversation reads each message's people, arrival, unread state, snippet, and HTML over its plain text, oldest first", async () => {
	const { client, reads } = threadClient(
		fullMessage(
			"m1",
			{ From: '"Alice Doe" <alice@example.com>', To: '"Doe, Jane" <jane@example.com>, bob@example.com', Cc: '"Max \\"the\\" Dev" <max+work@example.com>', Subject: " Draft review " },
			["INBOX"],
			"1791000000000",
			part("multipart/alternative", { parts: [part("text/plain", { text: "Hi *Jane*" }), part("text/html", { text: "<p>Hi <b>Jane</b></p>" })] }),
			"Hi Jane &amp; Bob",
		),
		fullMessage("m2", { From: "bob@example.com", To: "Alice Doe <alice@example.com>", Subject: "Re: Draft review" }, ["UNREAD", "INBOX"], "1791003600000", part("text/plain", { text: "Looks good." })),
	);
	expect(await client.thread("18f2a")).toEqual({
		id: "18f2a",
		subject: "Draft review",
		url: "https://mail.google.com/mail/?authuser=max%2Bwork%40example.com#inbox/18f2a",
		messages: [
			{
				id: "m1",
				from: { name: "Alice Doe", address: "alice@example.com" },
				to: [
					{ name: "Doe, Jane", address: "jane@example.com" },
					{ name: "", address: "bob@example.com" },
				],
				cc: [{ name: 'Max "the" Dev', address: "max+work@example.com" }],
				at: 1791000000000,
				unread: false,
				snippet: "Hi Jane & Bob",
				body: { kind: "html", html: "<p>Hi <b>Jane</b></p>" },
				attachments: [],
			},
			{
				id: "m2",
				from: { name: "", address: "bob@example.com" },
				to: [{ name: "Alice Doe", address: "alice@example.com" }],
				cc: [],
				at: 1791003600000,
				unread: true,
				snippet: "a snippet",
				body: { kind: "text", text: "Looks good." },
				attachments: [],
			},
		],
	});
	const read = new URL(reads.find(url => new URL(url).pathname === THREAD)!);
	expect(Object.fromEntries(read.searchParams)).toEqual({ format: "full" });
});

test("an alternative without HTML reads as its plain text", async () => {
	const { client } = threadClient(
		fullMessage("m1", { From: "a@example.com" }, ["INBOX"], "1791000000000", part("multipart/alternative", { parts: [part("text/plain", { text: "Only text\nhere" })] })),
	);
	expect((await client.thread("18f2a")).messages.map(message => message.body)).toEqual([{ kind: "text", text: "Only text\nhere" }]);
});

test("a mixed message reads as its nested body, and lists every named file as an attachment, a text file too, never as the body", async () => {
	const payload = part("multipart/mixed", {
		parts: [
			part("text/plain", { text: "Read me first", filename: "notes.txt", size: 13 }),
			part("multipart/alternative", { parts: [part("text/plain", { text: "Report attached." }), part("text/html", { text: "<p>Report attached.</p>" })] }),
			part("application/pdf", { filename: "Q3 report.pdf", size: 52341 }),
		],
	});
	const [message] = (await threadClient(fullMessage("m1", { From: "a@example.com" }, ["INBOX"], "1791000000000", payload)).client.thread("18f2a")).messages;
	expect([message?.body, message?.attachments]).toEqual([
		{ kind: "html", html: "<p>Report attached.</p>" },
		[
			{ name: "notes.txt", type: "text/plain", size: 13 },
			{ name: "Q3 report.pdf", type: "application/pdf", size: 52341 },
		],
	]);
});

test("a part reads in the charset its Content-Type names, and in UTF-8 when no decoder knows it", async () => {
	const latin1 = part("text/plain", { text: new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x20, 0xe0, 0x20, 0x31, 0x30, 0xa0, 0x80]), charset: "ISO-8859-1" });
	const unknown = part("text/plain", { text: "Crème brûlée", charset: "x-made-up" });
	const { client } = threadClient(
		fullMessage("m1", { From: "a@example.com" }, ["INBOX"], "1791000000000", latin1),
		fullMessage("m2", { From: "a@example.com" }, ["INBOX"], "1791000000001", unknown),
	);
	expect((await client.thread("18f2a")).messages.map(message => message.body)).toEqual([
		{ kind: "text", text: "Café à 10\u00a0€" },
		{ kind: "text", text: "Crème brûlée" },
	]);
});

test("a conversation leaves out drafts, and a message with no part it can show has an empty body", async () => {
	const { client } = threadClient(
		fullMessage("m1", { From: "a@example.com", Subject: "Plans" }, ["INBOX"], "1791000000000", part("image/png", { size: 1200 })),
		fullMessage("m2", { From: "Max <max+work@example.com>", Subject: "Re: Plans" }, ["DRAFT"], "1791000000001", part("text/plain", { text: "draft reply" })),
	);
	const thread = await client.thread("18f2a");
	expect([thread.subject, thread.messages.map(message => [message.id, message.body])]).toEqual(["Plans", [["m1", { kind: "empty" }]]]);
});

test("a conversation reuses the inbox's signed-in address, a second open within a minute asks Gmail nothing, and a fresh one reads again", async () => {
	const { client, reads } = threadClient(fullMessage("m1", { From: "a@example.com" }, ["INBOX"], "1791000000000", part("text/plain", { text: "hi" })));
	await client.inbox();
	expect(reads).toHaveLength(4);
	await client.thread("18f2a");
	expect(reads.slice(4).map(url => new URL(url).pathname)).toEqual([THREAD]);
	await client.thread("18f2a");
	expect(reads).toHaveLength(5);
	await client.thread("18f2a", true);
	expect(reads.slice(5).map(url => new URL(url).pathname)).toEqual([THREAD]);
});
