/** The Inbox page's mail: the latest conversations of your Gmail inbox, one conversation in full, and the mail and trashing it sends. */
import { arrayOf, decoder, fields, isBoolean, isNumber, isString, nullable } from "../json";
import type { AccountId } from "./accounts";

/** One conversation in your Gmail inbox, as the Inbox page lists it. */
export interface MailThread {
	/** The Gmail account whose inbox holds it. */
	account: AccountId;
	id: string;
	/** Who sent the thread's last message: their display name, else their address. */
	from: string;
	/** The first message's subject; `""` when it has none. */
	subject: string;
	/** Gmail's snippet of the thread, as plain text. */
	snippet: string;
	/** When the last message arrived, epoch ms. */
	at: number;
	/** Whether any of its messages is unread. */
	unread: boolean;
	/** How many messages it holds, drafts left out. */
	count: number;
	/** The thread in Gmail, signed in as the inbox's address. */
	url: string;
}

/** One Gmail account the inbox read, and why its read failed, `null` when it worked; its address is its integration account's. */
export interface InboxAccount {
	account: AccountId;
	error: string | null;
}

/** `GET /api/gmail/inbox[?fresh]`: each signed-in Gmail account and the latest conversations of their inboxes, newest first. */
export interface InboxAnswer {
	accounts: InboxAccount[];
	threads: MailThread[];
}

/** A kept {@link InboxAnswer} with every account and conversation whole, or `null`. */
export const decodeInboxAnswer = decoder(
	fields<InboxAnswer>({
		accounts: arrayOf(fields<InboxAccount>({ account: isString, error: nullable(isString) })),
		threads: arrayOf(
			fields<MailThread>({
				account: isString,
				id: isString,
				from: isString,
				subject: isString,
				snippet: isString,
				at: isNumber,
				unread: isBoolean,
				count: isNumber,
				url: isString,
			}),
		),
	}),
);

/** The conversation `id` in Gmail, signed in as `address`, whichever account the browser signed in first. */
export const threadUrl = (address: string, id: string): string => `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#inbox/${id}`;

/** Someone an address header names. */
export interface MailPerson {
	/** Their display name; `""` when the header gives none. */
	name: string;
	address: string;
}

/**
 * What a message reads as: its HTML part, else its plain text part, else nothing the page can show. The HTML stays on the
 * server, and the page loads it from `GET /api/gmail/message` as a document of its own.
 */
export type MailBody = { kind: "html" } | { kind: "text"; text: string } | { kind: "empty" };

/** A file a message carries, which the page names but does not download. */
export interface MailAttachment {
	name: string;
	/** Its MIME type: `application/pdf`. */
	type: string;
	/** Its size in bytes, as Gmail counts it. */
	size: number;
}

/** One message of a conversation, drafts left out, as the Inbox page's details show it. */
export interface MailMessage {
	id: string;
	/** The first person the `From` header names; an empty name and address when it names none. */
	from: MailPerson;
	to: MailPerson[];
	cc: MailPerson[];
	/** Whom its `Reply-To` header names, where a reply goes instead of the sender. */
	replyTo: MailPerson[];
	/** When it arrived, epoch ms. */
	at: number;
	unread: boolean;
	/** Gmail's snippet of the message, as plain text. */
	snippet: string;
	body: MailBody;
	attachments: MailAttachment[];
}

/** `GET /api/gmail/thread?account=<account>&id=<id>[&fresh]`: one conversation in full. */
export interface ThreadAnswer {
	account: AccountId;
	id: string;
	/** The first message's subject; `""` when it has none. */
	subject: string;
	/** The conversation in Gmail, signed in as the inbox's address. */
	url: string;
	/** Its messages, oldest first. */
	messages: MailMessage[];
}

/** The longest body, as text or as HTML, that a sent mail carries, in characters. */
export const MAX_MAIL_BODY = 500_000;

/** A mail as the Inbox page's editor writes it: whom it goes to, its subject, and its body as HTML and as plain text. */
export interface MailDraft {
	to: MailPerson[];
	cc: MailPerson[];
	bcc: MailPerson[];
	subject: string;
	html: string;
	text: string;
}

/** `PUT /api/gmail/send`: a new mail from Gmail account `account`, which starts a conversation of its own. */
export type MailSend = MailDraft & { account: AccountId };

/** `PUT /api/gmail/reply`: a reply to the last message of conversation `thread` of Gmail account `account`, under the conversation's subject. */
export type MailReply = Omit<MailDraft, "subject"> & { account: AccountId; thread: string };

/** `PUT /api/gmail/trash`: moves conversation `thread` of Gmail account `account` to Gmail's Trash, where Gmail keeps it 30 days. */
export interface MailTrash {
	account: AccountId;
	thread: string;
}

/** `people` with `except` and every repeat left out, addresses compared without case. */
function distinct(people: MailPerson[], except: Set<string>): MailPerson[] {
	const seen = new Set(except);
	return people.filter(person => {
		const key = person.address.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/**
 * Whom a reply to `message` goes to, as Gmail addresses one: its `Reply-To`, else its sender, or, for a message you sent,
 * the people you sent it to. Replying to all copies everyone else it named. Your own address `me` is never a recipient.
 */
export function recipientsOf(message: Pick<MailMessage, "from" | "to" | "cc" | "replyTo">, me: string, all: boolean): { to: MailPerson[]; cc: MailPerson[] } {
	const self = new Set([me.toLowerCase()]);
	const sender = message.from.address ? message.from : undefined;
	const mine = sender !== undefined && self.has(sender.address.toLowerCase());
	const to = distinct(mine ? message.to : message.replyTo.length > 0 ? message.replyTo : sender ? [sender] : [], self);
	const cc = all ? distinct([...(mine ? [] : message.to), ...message.cc], new Set([...self, ...to.map(person => person.address.toLowerCase())])) : [];
	return { to, cc };
}
