/**
 * Gmail: the latest conversations of your inbox, which the Inbox page lists, and one conversation in full, which its
 * details show. It calls Google's Gmail API with the token omp holds for its Gmail MCP server, the same sign-in and
 * read-only scope: the server's own tools answer only for OAuth clients in Google's Developer Preview Program. It only
 * reads: nothing here sends, labels, or marks mail read.
 */
import { createCache } from "./cache";
import type { GoogleFetch } from "./integrations";
import { isObject, nonEmptyStr, str } from "./json";
import { mapLimit } from "./map-limit";
import type { InboxAnswer, MailAttachment, MailBody, MailMessage, MailPerson, MailThread, ThreadAnswer } from "./shared/gmail";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** How many conversations the Inbox page lists. */
const INBOX_SIZE = 50;
/** Threads read at once, well under the 25 thread reads a second Gmail allows a user. */
const THREAD_READS = 8;
/** How long an answer, the signed-in address, or a conversation is kept before Gmail is asked again. */
const KEPT_MS = 60_000;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };

/** `html` with the entities Gmail's snippets use decoded: `&amp;`, `&lt;`, `&gt;`, `&quot;`, and numeric ones such as `&#39;`. */
function decodeEntities(html: string): string {
	return html.replace(/&(?:(amp|lt|gt|quot)|#(\d+)|#x([0-9a-f]+));/gi, (entity: string, name?: string, decimal?: string, hex?: string) => {
		if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
		const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
		return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
}

/** One mailbox of an address header: `"Alice Doe" <alice@example.com>`, or a bare `alice@example.com` with no name. */
function personOf(mailbox: string): MailPerson | null {
	const named = /^(.*)<([^<>]*)>\s*$/.exec(mailbox);
	if (!named) {
		const address = mailbox.trim();
		return address ? { name: "", address } : null;
	}
	const name = named[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
	return { name, address: named[2]!.trim() };
}

/** Everyone an address header names, in its order. A comma inside a quoted name or an angle-bracketed address separates no one. */
function peopleOf(header: string): MailPerson[] {
	const mailboxes: string[] = [];
	let mailbox = "";
	let quoted = false;
	let angled = false;
	for (let at = 0; at < header.length; at++) {
		const char = header[at]!;
		if (quoted && char === "\\") {
			mailbox += char + (header[++at] ?? "");
			continue;
		}
		if (char === '"') quoted = !quoted;
		else if (!quoted && char === "<") angled = true;
		else if (!quoted && char === ">") angled = false;
		else if (!quoted && !angled && char === ",") {
			mailboxes.push(mailbox);
			mailbox = "";
			continue;
		}
		mailbox += char;
	}
	mailboxes.push(mailbox);
	return mailboxes.map(personOf).filter(person => person !== null);
}

/** The display name of a `From` header's sender, else their address. */
function senderOf(from: string): string {
	const [sender] = peopleOf(from);
	return sender ? sender.name || sender.address : "";
}

/** The value of header `name` among a MIME part's `headers`, `""` when it has none. */
function headerIn(headers: unknown, name: string): string {
	const header = (Array.isArray(headers) ? headers : []).find(header => isObject(header) && str(header.name)?.toLowerCase() === name.toLowerCase());
	return (isObject(header) && str(header.value)) || "";
}

/** The value of header `name` of a message Gmail answered, `""` when it has none. */
const headerOf = (message: Record<string, unknown>, name: string): string => headerIn(isObject(message.payload) ? message.payload.headers : undefined, name);

const hasLabel = (message: Record<string, unknown>, label: string): boolean => Array.isArray(message.labelIds) && message.labelIds.includes(label);

/** When a message arrived, epoch ms, `NaN` when Gmail gives no time. */
const arrivalOf = (message: Record<string, unknown>): number => (typeof message.internalDate === "string" ? Number(message.internalDate) : Number.NaN);

/** The conversation `id` in Gmail, signed in as `address`, whichever account the browser signed in first. */
const threadUrl = (address: string, id: string): string => `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#inbox/${id}`;

/** A thread as the Inbox page lists it, or `null` for one without an id, a message other than a draft, or an arrival time. */
function threadOf(thread: unknown, snippet: string, address: string): MailThread | null {
	if (!isObject(thread) || !Array.isArray(thread.messages)) return null;
	const id = nonEmptyStr(thread.id);
	const messages = thread.messages.filter(isObject).filter(message => !hasLabel(message, "DRAFT"));
	const [first, last] = [messages[0], messages.at(-1)];
	if (!id || !first || !last) return null;
	const at = arrivalOf(last);
	if (!Number.isFinite(at)) return null;
	return {
		id,
		from: senderOf(headerOf(last, "From")),
		subject: headerOf(first, "Subject").trim(),
		snippet: decodeEntities(snippet),
		at,
		unread: messages.some(message => hasLabel(message, "UNREAD")),
		count: messages.length,
		url: threadUrl(address, id),
	};
}

/** A node of a message's MIME tree, read from Gmail's `format=full` payload. */
interface MimePart {
	/** Lowercase: `multipart/alternative`, `text/html`. */
	mimeType: string;
	/** The file name of an attachment; `""` for a part of the message itself. */
	filename: string;
	/** The `charset` its `Content-Type` names, `utf-8` when it names none. */
	charset: string;
	/** Its content in base64url; `""` for a multipart node or an attachment Gmail serves apart. */
	data: string;
	size: number;
	parts: MimePart[];
}

function partOf(raw: unknown): MimePart {
	const part = isObject(raw) ? raw : {};
	const body = isObject(part.body) ? part.body : {};
	const charset = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(headerIn(part.headers, "Content-Type"))?.[1];
	return {
		mimeType: (str(part.mimeType) ?? "").toLowerCase(),
		filename: str(part.filename) ?? "",
		charset: charset ?? "utf-8",
		data: str(body.data) ?? "",
		size: typeof body.size === "number" ? body.size : 0,
		parts: Array.isArray(part.parts) ? part.parts.map(partOf) : [],
	};
}

/** A text part's content in its own charset, or in UTF-8 when the charset is one no decoder knows. */
function textOf({ data, charset }: MimePart): string {
	const bytes = Buffer.from(data, "base64url");
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return new TextDecoder().decode(bytes);
	}
}

/** A body as read, with the HTML that the page's {@link MailBody} leaves out. */
type ReadBody = Exclude<MailBody, { kind: "html" }> | { kind: "html"; html: string };

const NO_BODY: ReadBody = { kind: "empty" };

/**
 * What `part` reads as. Of `multipart/alternative`'s versions the HTML one wins over the plain text one, as Gmail shows
 * it; any other multipart reads as its first part with a body, such as the text before `multipart/mixed`'s attachments.
 */
function bodyOf(part: MimePart): ReadBody {
	if (part.filename) return NO_BODY;
	if (part.mimeType === "text/html") {
		const html = textOf(part);
		return html.trim() ? { kind: "html", html } : NO_BODY;
	}
	if (part.mimeType === "text/plain") {
		const text = textOf(part);
		return text.trim() ? { kind: "text", text } : NO_BODY;
	}
	if (!part.mimeType.startsWith("multipart/")) return NO_BODY;
	const bodies = part.parts.map(bodyOf);
	if (part.mimeType === "multipart/alternative") return bodies.find(body => body.kind === "html") ?? bodies.find(body => body.kind === "text") ?? NO_BODY;
	return bodies.find(body => body.kind !== "empty") ?? NO_BODY;
}

/** Every part of the tree that names a file, in the tree's order; none of them is ever a body. */
const attachmentsOf = (part: MimePart): MailAttachment[] => [
	...(part.filename ? [{ name: part.filename, type: part.mimeType, size: part.size }] : []),
	...part.parts.flatMap(attachmentsOf),
];

/** A message as read: what the Inbox page's details show, and its HTML when that is its body. */
interface ReadMessage {
	message: MailMessage;
	html: string | undefined;
}

/** A message as the Inbox page's details show it, with its HTML, or `null` for one without an id or an arrival time. */
function messageOf(message: Record<string, unknown>): ReadMessage | null {
	const id = nonEmptyStr(message.id);
	const at = arrivalOf(message);
	if (!id || !Number.isFinite(at)) return null;
	const payload = partOf(message.payload);
	const body = bodyOf(payload);
	return {
		message: {
			id,
			from: peopleOf(headerOf(message, "From"))[0] ?? { name: "", address: "" },
			to: peopleOf(headerOf(message, "To")),
			cc: peopleOf(headerOf(message, "Cc")),
			at,
			unread: hasLabel(message, "UNREAD"),
			snippet: decodeEntities(str(message.snippet) ?? ""),
			body: body.kind === "html" ? { kind: "html" } : body,
			attachments: attachmentsOf(payload),
		},
		html: body.kind === "html" ? body.html : undefined,
	};
}

/** A conversation as read: what the Inbox page's details get, and the HTML of each message whose body is HTML, by message id. */
interface ReadThread {
	answer: ThreadAnswer;
	html: Map<string, string>;
}

/** Your Gmail inbox's latest conversations, and each conversation in full, each read at most once a minute. */
export class GmailClient {
	readonly #fetch: GoogleFetch;
	readonly #inbox = createCache<InboxAnswer>(KEPT_MS);
	readonly #address = createCache<string>(KEPT_MS);
	readonly #threads = createCache<ReadThread>(KEPT_MS);

	constructor(fetch: GoogleFetch) {
		this.#fetch = fetch;
	}

	/**
	 * The signed-in address and its inbox's latest conversations, in Gmail's order. `fresh` reads them again.
	 * One failed thread read fails the whole read.
	 */
	inbox(fresh = false): Promise<InboxAnswer> {
		return this.#inbox.get("", () => this.#readInbox(fresh), fresh);
	}

	/** Conversation `id` with its messages in full, oldest first and drafts left out. `fresh` reads it again. */
	async thread(id: string, fresh = false): Promise<ThreadAnswer> {
		return (await this.#threads.get(id, () => this.#readThread(id), fresh)).answer;
	}

	/**
	 * The HTML of message `id` of conversation `thread`, from the read {@link thread} keeps, so opening a conversation asks
	 * Gmail nothing more; `undefined` when the conversation holds no such message or its body is not HTML.
	 */
	async messageHtml(thread: string, id: string): Promise<string | undefined> {
		return (await this.#threads.get(thread, () => this.#readThread(thread))).html.get(id);
	}

	/** The address you signed in with, which a link into Gmail names; the inbox's read keeps it for a conversation's. */
	#signedIn(fresh: boolean): Promise<string> {
		const read = async (): Promise<string> => {
			const profile = await this.#fetch(`${API}/profile`);
			const address = isObject(profile) ? nonEmptyStr(profile.emailAddress) : undefined;
			if (!address) throw new Error("Gmail did not say which address you signed in with");
			return address;
		};
		return this.#address.get("", read, fresh);
	}

	async #readInbox(fresh: boolean): Promise<InboxAnswer> {
		const list = new URL(`${API}/threads`);
		list.searchParams.set("labelIds", "INBOX");
		list.searchParams.set("maxResults", String(INBOX_SIZE));
		const [address, listed] = await Promise.all([this.#signedIn(fresh), this.#fetch(list.toString())]);
		if (!isObject(listed)) throw new Error("Gmail answered something other than a thread list");
		const items = (Array.isArray(listed.threads) ? listed.threads : []).filter(isObject).flatMap(item => {
			const id = nonEmptyStr(item.id);
			return id ? [{ id, snippet: str(item.snippet) ?? "" }] : [];
		});
		const threads = await mapLimit(items, THREAD_READS, async ({ id, snippet }) => {
			const url = new URL(`${API}/threads/${encodeURIComponent(id)}`);
			url.searchParams.set("format", "metadata");
			url.searchParams.append("metadataHeaders", "From");
			url.searchParams.append("metadataHeaders", "Subject");
			return threadOf(await this.#fetch(url.toString()), snippet, address);
		});
		return { address, threads: threads.filter(thread => thread !== null) };
	}

	async #readThread(id: string): Promise<ReadThread> {
		const url = new URL(`${API}/threads/${encodeURIComponent(id)}`);
		url.searchParams.set("format", "full");
		const [address, thread] = await Promise.all([this.#signedIn(false), this.#fetch(url.toString())]);
		if (!isObject(thread) || !Array.isArray(thread.messages)) throw new Error("Gmail answered something other than a conversation");
		const kept = thread.messages.filter(isObject).filter(message => !hasLabel(message, "DRAFT"));
		const read = kept.map(messageOf).filter(message => message !== null);
		return {
			answer: {
				id,
				subject: kept[0] ? headerOf(kept[0], "Subject").trim() : "",
				url: threadUrl(address, id),
				messages: read.map(({ message }) => message),
			},
			html: new Map(read.flatMap(({ message, html }): [string, string][] => (html === undefined ? [] : [[message.id, html]]))),
		};
	}
}
