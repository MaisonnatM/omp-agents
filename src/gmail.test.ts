import { expect, test } from "bun:test";
import { GmailClient, mailOf, replyOf } from "./gmail";
import { recipientsOf, type MailMessage } from "./shared/gmail";
import { ApiError, type SignedFetch } from "./signed-fetch";

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
	const fetch: SignedFetch = async url => {
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
				replyTo: [],
				at: 1791000000000,
				unread: false,
				snippet: "Hi Jane & Bob",
				body: { kind: "html" },
				attachments: [],
			},
			{
				id: "m2",
				from: { name: "", address: "bob@example.com" },
				to: [{ name: "Alice Doe", address: "alice@example.com" }],
				cc: [],
				replyTo: [],
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
		{ kind: "html" },
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

test("a message's HTML comes from the conversation's kept read, and is undefined for a plain text message or one the conversation does not hold", async () => {
	const { client, reads } = threadClient(
		fullMessage("m1", { From: "a@example.com" }, ["INBOX"], "1791000000000", part("multipart/alternative", { parts: [part("text/plain", { text: "Hi" }), part("text/html", { text: "<p>Hi</p>" })] })),
		fullMessage("m2", { From: "b@example.com" }, ["INBOX"], "1791000000001", part("text/plain", { text: "Plain" })),
	);
	await client.thread("18f2a");
	expect(reads.map(url => new URL(url).pathname)).toEqual(["/gmail/v1/users/me/profile", THREAD]);
	expect([await client.messageHtml("18f2a", "m1"), await client.messageHtml("18f2a", "m2"), await client.messageHtml("18f2a", "m9")]).toEqual(["<p>Hi</p>", undefined, undefined]);
	expect(reads).toHaveLength(2);
});

/** A message as `threads.get` answers it with `format=metadata` and `headers`. */
const headed = (id: string, headers: Record<string, string>, labelIds: string[] = ["INBOX"]) => ({
	id,
	labelIds,
	internalDate: "1791000000000",
	payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
});

const ASK = headed("m1", {
	From: '"Alice Doe" <alice@example.com>',
	Subject: "Draft review",
	"Message-ID": "<m1@example.com>",
	References: "<m0@example.com>",
});

const person = (address: string, name = "") => ({ name, address });
const DRAFT = { to: [person("alice@example.com", "Alice Doe")], cc: [], bcc: [person("boss@example.com")], html: "<p>Looks <b>good</b>.</p>", text: "Looks good.\nShip it." };

/** The headers of `raw`, an RFC 2822 multipart/alternative message, and the decoded body of each part by its type. */
function parsed(raw: string): { headers: Record<string, string>; parts: Record<string, string> } {
	const [head, ...rest] = raw.split("\r\n\r\n");
	const headers = Object.fromEntries(head!.split("\r\n").map(line => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]));
	const boundary = /boundary="([^"]+)"/.exec(headers["Content-Type"]!)![1]!;
	const parts = Object.fromEntries(
		rest.join("\r\n\r\n").split(`--${boundary}`).slice(1, -1).map(part => {
			const [partHead, body] = part.trim().split("\r\n\r\n");
			return [/Content-Type: ([^;]+)/.exec(partHead!)![1]!, Buffer.from(body!.replace(/\r\n/g, ""), "base64").toString()];
		}),
	);
	return { headers, parts };
}

test("a reply sends its text and HTML under the conversation's Re: subject, threaded after the message it answers", () => {
	const { headers, parts } = parsed(replyOf(ASK, "max+work@example.com", DRAFT));
	expect(headers).toMatchObject({ To: '"Alice Doe" <alice@example.com>', Bcc: "boss@example.com", Subject: "Re: Draft review", "In-Reply-To": "<m1@example.com>", References: "<m0@example.com> <m1@example.com>" });
	expect(headers.Cc).toBeUndefined();
	expect(parts).toEqual({ "text/plain": "Looks good.\r\nShip it.", "text/html": "<p>Looks <b>good</b>.</p>" });
	expect(parsed(replyOf(headed("m", { Subject: "RE: Café" }), "me@example.com", DRAFT)).headers.Subject).toBe(`=?UTF-8?B?${Buffer.from("RE: Café").toString("base64")}?=`);
});

test("a new mail encodes a name outside ASCII, and one that names no one is refused", () => {
	const { headers } = parsed(mailOf("me@example.com", { ...DRAFT, to: [person("zoe@example.com", "Zoë")], bcc: [] }, "Hello"));
	expect(headers).toMatchObject({ To: `=?UTF-8?B?${Buffer.from("Zoë").toString("base64")}?= <zoe@example.com>`, Subject: "Hello" });
	expect(() => mailOf("me@example.com", { ...DRAFT, to: [], bcc: [] }, "Hello")).toThrow("names no one");
});

const said = (from: string, to: string[], extra: Partial<MailMessage> = {}) => ({ from: person(from), to: to.map(address => person(address)), cc: [], replyTo: [], ...extra });

test("a reply goes to Reply-To over the sender, to your own message's recipients, and replying to all copies everyone else it named but you", () => {
	const ask = said("alice@example.com", ["MAX+work@example.com", "bob@example.com"], { cc: [person("carol@example.com"), person("alice@example.com")] });
	const all = recipientsOf(ask, "max+work@example.com", true);
	expect([all.to.map(p => p.address), all.cc.map(p => p.address)]).toEqual([["alice@example.com"], ["bob@example.com", "carol@example.com"]]);
	expect(recipientsOf(ask, "max+work@example.com", false).cc).toEqual([]);
	expect(recipientsOf(said("list@example.com", [], { replyTo: [person("team@example.com")] }), "me@example.com", false).to).toEqual([person("team@example.com")]);
	expect(recipientsOf(said("me@example.com", ["zoe@example.com"]), "me@example.com", false).to).toEqual([person("zoe@example.com")]);
});

test("a reply sends to the last message other than a draft, and a trash moves the conversation; each reads the inbox and the conversation again", async () => {
	const writes: { url: string; body: unknown }[] = [];
	const answers = twoThreads();
	answers[`${INBOX}/18f2a`] = { id: "18f2a", messages: [ASK, headed("d", { From: "max+work@example.com", To: "alice@example.com" }, ["DRAFT"])] };
	let reads = 0;
	const fetch: SignedFetch = async (url, init) => {
		if (init) {
			writes.push({ url: new URL(url).pathname, body: init.method === "POST" ? init.body : null });
			return {};
		}
		if (new URL(url).pathname === INBOX) reads++;
		return answers[new URL(url).pathname];
	};
	const client = new GmailClient(fetch);
	await client.inbox();
	await client.reply({ thread: "18f2a", ...DRAFT });
	await client.send({ ...DRAFT, subject: "New" });
	await client.trash("18e07");
	await client.inbox();
	expect(writes.map(write => write.url)).toEqual(["/gmail/v1/users/me/messages/send", "/gmail/v1/users/me/messages/send", "/gmail/v1/users/me/threads/18e07/trash"]);
	const [reply, mail] = writes.map(write => write.body as { raw: string; threadId?: string });
	expect(reply!.threadId).toBe("18f2a");
	expect(parsed(Buffer.from(reply!.raw, "base64url").toString()).headers["In-Reply-To"]).toBe("<m1@example.com>");
	expect(mail!.threadId).toBeUndefined();
	expect(reads).toBe(2);
});

test("Google's refusal of a read-only sign-in says to sign in again", async () => {
	const fetch: SignedFetch = async () => {
		throw new ApiError("Request had insufficient authentication scopes.", 403);
	};
	await expect(new GmailClient(fetch).trash("18f2a")).rejects.toThrow("Sign in to Gmail again");
});
