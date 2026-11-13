/** The Email module's page half, which `WEB_MODULES` in `web/modules.ts` lists; its components are in this folder. */
import { IconEmail1 } from "central-icons";
import { decodeSegment } from "../../hash-segment";
import type { PageModule } from "../../modules";

/** A Gmail conversation, by the account whose inbox holds it and its thread id. */
export interface EmailThread {
	/** The account's server name in omp's config: `gmail`, `gmail-2`. */
	account: string;
	/** Gmail's thread id: `18f2a3c4d5e6f708`. */
	thread: string;
}

/** The Email page's list, beside the Gmail conversation `target` names, or the new mail when it is `new`. */
export interface EmailRoute {
	target: EmailThread | "new" | null;
}

type EmailShortcut = "emailNext" | "emailPrevious" | "emailClose" | "emailOnGmail" | "emailReply" | "emailReplyAll" | "emailTrash" | "emailCompose";

const outside = (key: string) => [{ chord: { key }, scope: "outside-fields" }] as const;

export const EMAIL_PAGE: PageModule<"email", EmailRoute, EmailShortcut> = {
	id: "email",
	tab: { label: "Email", icon: IconEmail1, place: 70, integration: "gmail" },
	home: { target: null },
	/** `#email` is your Gmail inboxes' latest conversations, `#email/new` a new mail, and `#email/<account>/<thread id>` that account's conversation in full. */
	address: {
		parse: rest => {
			if (rest === "new") return { target: "new" };
			const [account, thread, ...more] = (rest ?? "").split("/").map(decodeSegment);
			return { target: account && thread && more.length === 0 ? { account, thread } : null };
		},
		rest: ({ target }) => (target === null || target === "new" ? target : `${encodeURIComponent(target.account)}/${encodeURIComponent(target.thread)}`),
		query: () => null,
	},
	title: () => "Email",
	views: [
		{ key: "email", label: "Email" },
		{ key: "email/new", label: "New mail" },
		{ key: "email/item", label: "A mail conversation" },
	],
	view: ({ target }) => (target === null ? "email" : target === "new" ? "email/new" : "email/item"),
	shortcuts: {
		category: "Email",
		goTo: { label: "Go to your email", command: "Go to email", keys: [{ goTo: "m" }] },
		rows: [
			{ id: "emailNext", label: "Email: focus the next conversation, or open it while a conversation is open", keys: outside("ArrowDown") },
			{ id: "emailPrevious", label: "Email: focus the previous conversation, or open it while a conversation is open", keys: outside("ArrowUp") },
			{ id: "emailClose", label: "Email: close the open conversation", keys: outside("Escape") },
			{ id: "emailOnGmail", label: "Email: open the focused or open conversation in Gmail", keys: outside("o") },
			{ id: "emailReply", label: "Email: reply to the open conversation's last message", keys: outside("r") },
			{ id: "emailReplyAll", label: "Email: reply to everyone on the open conversation's last message", keys: outside("a") },
			{ id: "emailTrash", label: "Email: move the open conversation to Gmail's Trash", keys: outside("#") },
			{ id: "emailCompose", label: "Email: write a new mail", keys: outside("c") },
		],
	},
	controls: [],
	split: true,
	api: "/api/gmail/",
};
