import { expect, test } from "bun:test";
import { GmailClient } from "./gmail";
import type { GoogleFetch } from "./google-calendar";

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
