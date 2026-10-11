/** The Inbox page's mail: the latest conversations of your Gmail inbox, read only. */

/** One conversation in your Gmail inbox, as the Inbox page lists it, newest first. */
export interface MailThread {
	/** Gmail's thread id. */
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
	/** How many messages it holds. */
	count: number;
	/** The thread in Gmail, signed in as the inbox's address. */
	url: string;
}

/** `GET /api/gmail/inbox[?fresh]`: the signed-in address and its inbox's latest conversations. */
export interface InboxAnswer {
	address: string;
	threads: MailThread[];
}
