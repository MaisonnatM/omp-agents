/**
 * Gmail: the latest conversations of your inbox, which the Inbox page lists. It calls Google's Gmail API with the token
 * omp holds for its Gmail MCP server, the same sign-in and read-only scope: the server's own tools answer only for OAuth
 * clients in Google's Developer Preview Program. It only reads: nothing here sends, labels, or marks mail read.
 */
import { createCache } from "./cache";
import type { GoogleFetch } from "./integrations";
import { isObject, nonEmptyStr, str } from "./json";
import { mapLimit } from "./map-limit";
import type { InboxAnswer, MailThread } from "./shared/gmail";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** How many conversations the Inbox page lists. */
const INBOX_SIZE = 50;
/** Threads read at once, well under the 25 thread reads a second Gmail allows a user. */
const THREAD_READS = 8;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };

/** `html` with the entities Gmail's snippets use decoded: `&amp;`, `&lt;`, `&gt;`, `&quot;`, and numeric ones such as `&#39;`. */
function decodeEntities(html: string): string {
	return html.replace(/&(?:(amp|lt|gt|quot)|#(\d+)|#x([0-9a-f]+));/gi, (entity: string, name?: string, decimal?: string, hex?: string) => {
		if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
		const code = decimal ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? "", 16);
		return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
	});
}

/** The display name of a `From` header such as `"Alice Doe" <alice@example.com>`, else its address. */
function senderOf(from: string): string {
	const named = /^(.*)<([^<>]*)>\s*$/.exec(from);
	if (!named) return from.trim();
	const name = named[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
	return name || named[2]!.trim();
}

/** The value of header `name` in a message Gmail answered with `format=metadata`, `""` when it has none. */
function headerOf(message: Record<string, unknown>, name: string): string {
	const headers = isObject(message.payload) && Array.isArray(message.payload.headers) ? message.payload.headers : [];
	const header = headers.find(header => isObject(header) && str(header.name)?.toLowerCase() === name.toLowerCase());
	return (isObject(header) && str(header.value)) || "";
}

const hasLabel = (message: Record<string, unknown>, label: string): boolean => Array.isArray(message.labelIds) && message.labelIds.includes(label);

/** A thread as the Inbox page lists it, or `null` for one without an id, a message other than a draft, or an arrival time. */
function threadOf(thread: unknown, snippet: string, address: string): MailThread | null {
	if (!isObject(thread) || !Array.isArray(thread.messages)) return null;
	const id = nonEmptyStr(thread.id);
	const messages = thread.messages.filter(isObject).filter(message => !hasLabel(message, "DRAFT"));
	const [first, last] = [messages[0], messages.at(-1)];
	if (!id || !first || !last) return null;
	const at = typeof last.internalDate === "string" ? Number(last.internalDate) : Number.NaN;
	if (!Number.isFinite(at)) return null;
	return {
		id,
		from: senderOf(headerOf(last, "From")),
		subject: headerOf(first, "Subject").trim(),
		snippet: decodeEntities(snippet),
		at,
		unread: messages.some(message => hasLabel(message, "UNREAD")),
		count: messages.length,
		url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#inbox/${id}`,
	};
}

/** Your Gmail inbox's latest conversations, read at most once a minute. */
export class GmailClient {
	readonly #fetch: GoogleFetch;
	readonly #inbox = createCache<InboxAnswer>(60_000);

	constructor(fetch: GoogleFetch) {
		this.#fetch = fetch;
	}

	/**
	 * The signed-in address and its inbox's latest conversations, in Gmail's order. `fresh` reads them again.
	 * One failed thread read fails the whole read.
	 */
	inbox(fresh = false): Promise<InboxAnswer> {
		return this.#inbox.get("", () => this.#read(), fresh);
	}

	async #read(): Promise<InboxAnswer> {
		const list = new URL(`${API}/threads`);
		list.searchParams.set("labelIds", "INBOX");
		list.searchParams.set("maxResults", String(INBOX_SIZE));
		const [profile, listed] = await Promise.all([this.#fetch(`${API}/profile`), this.#fetch(list.toString())]);
		const address = isObject(profile) ? nonEmptyStr(profile.emailAddress) : undefined;
		if (!address) throw new Error("Gmail did not say which address you signed in with");
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
}
