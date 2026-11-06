import { errorText } from "../json";
import type { GmailAccounts } from "../gmail";
import { answer, checked, fail } from "./http";
import { mailDocument } from "./mail-document";
import { parseMailReply, parseMailSend, parseMailTrash } from "./wire";
import type { RouteKit, Routes } from "./route-kit";

/** Every Gmail account's inbox: their conversations, and the mail, replies, and trashing the Email page sends. */
export function gmailRoutes({ get, media, write }: RouteKit, gmail: GmailAccounts): Routes {
	/** `GET /api/gmail/inbox[?fresh]`: each signed-in account and their inboxes' latest conversations, newest first. */
	const inbox = get((params) => answer(() => gmail.inbox(params.has("fresh"))));
	/** `GET /api/gmail/thread?account=<account>&id=<id>[&fresh]`: that conversation in full, for the Email page's details. */
	const thread = get((params) => {
		const account = params.get("account");
		const id = params.get("id");
		return account && id ? answer(() => gmail.thread(account, id, params.has("fresh"))) : fail(400, "Expected ?account= and ?id= naming a Gmail conversation");
	});
	/** `GET /api/gmail/message?account=<account>&thread=<id>&id=<id>`: a message's HTML as a document of its own, which the Email page frames. */
	const message = media(async (params) => {
		const account = params.get("account");
		const threadId = params.get("thread");
		const id = params.get("id");
		if (!account || !threadId || !id) return fail(400, "Expected ?account=, ?thread=, and ?id= naming a Gmail message");
		const html = await gmail.messageHtml(account, threadId, id).catch((err: unknown) => fail(500, errorText(err)));
		if (html instanceof Response) return html;
		return html === undefined ? fail(404, `Conversation ${threadId} holds no HTML message ${id}`) : mailDocument(html);
	});
	const DRAFT = "{ to, cc, bcc } of { name, address } naming someone, html, and text that is not blank";
	/** `PUT /api/gmail/reply`: `MailReply`, sent in its conversation; answers `{}`. */
	const reply = write(
		(body) => checked(parseMailReply(body), `Expected { account, thread } naming a Gmail conversation, with ${DRAFT}`),
		async (input) => (await gmail.reply(input), {}),
	);
	/** `PUT /api/gmail/send`: `MailSend`, sent from its account as a new mail; answers `{}`. */
	const send = write(
		(body) => checked(parseMailSend(body), `Expected { account, subject }, with ${DRAFT}`),
		async (input) => (await gmail.send(input), {}),
	);
	/** `PUT /api/gmail/trash`: `MailTrash`, moved to Gmail's Trash; answers `{}`. */
	const trash = write(
		(body) => checked(parseMailTrash(body), "Expected { account, thread } naming a Gmail conversation"),
		async ({ account, thread }) => (await gmail.trash(account, thread), {}),
	);
	return {
		"/api/gmail/inbox": { GET: inbox },
		"/api/gmail/thread": { GET: thread },
		"/api/gmail/message": { GET: message },
		"/api/gmail/reply": { PUT: reply },
		"/api/gmail/send": { PUT: send },
		"/api/gmail/trash": { PUT: trash },
	};
}
