/** The Inbox page's mail: the latest conversations of your Gmail inbox, and one conversation in full, read only. */

/** One conversation in your Gmail inbox, as the Inbox page lists it. */
export interface MailThread {
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

/** `GET /api/gmail/inbox[?fresh]`: the signed-in address and its inbox's latest conversations. */
export interface InboxAnswer {
	address: string;
	threads: MailThread[];
}

/** Someone an address header names. */
export interface MailPerson {
	/** Their display name; `""` when the header gives none. */
	name: string;
	address: string;
}

/** What a message reads as: its HTML part, else its plain text part, else nothing the page can show. */
export type MailBody = { kind: "html"; html: string } | { kind: "text"; text: string } | { kind: "empty" };

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
	/** When it arrived, epoch ms. */
	at: number;
	unread: boolean;
	/** Gmail's snippet of the message, as plain text. */
	snippet: string;
	body: MailBody;
	attachments: MailAttachment[];
}

/** `GET /api/gmail/thread?id=<id>[&fresh]`: one conversation in full. */
export interface ThreadAnswer {
	id: string;
	/** The first message's subject; `""` when it has none. */
	subject: string;
	/** The conversation in Gmail, signed in as the inbox's address. */
	url: string;
	/** Its messages, oldest first. */
	messages: MailMessage[];
}
