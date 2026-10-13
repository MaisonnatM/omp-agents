/**
 * A mail being written as the browser keeps it: the nodes its body holds, and `decodeMailDraft`, which reads a kept
 * draft back only when every field has its shape and the body restores into those nodes.
 */
import { buildEditorFromExtensions } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { AutoLinkExtension, autoLinkUrlMatcher, LinkExtension } from "@lexical/link";
import { ListExtension } from "@lexical/list";
import { RichTextExtension } from "@lexical/rich-text";
import { configExtension, defineExtension, type LexicalEditor } from "lexical";
import type { MailPerson } from "../src/shared/gmail";

/** Who a mail goes to, by field. */
export interface MailRecipients {
	to: MailPerson[];
	cc: MailPerson[];
	bcc: MailPerson[];
}

/** What the browser keeps of a draft you have not sent: its people, its subject, and the editor's document as JSON. */
export interface StoredDraft extends MailRecipients {
	subject: string;
	body: string;
}

/** The nodes a mail's body holds, with its formatting and history; without the editable, which the view adds. */
export const mailExtension = defineExtension({
	name: "mail/rich-text",
	dependencies: [RichTextExtension, ListExtension, LinkExtension, configExtension(AutoLinkExtension, { matchers: [autoLinkUrlMatcher] }), HistoryExtension],
});

let reader: LexicalEditor | null = null;

/** Whether `body` restores into a document of {@link mailExtension}'s nodes. */
function restores(body: string): boolean {
	reader ??= buildEditorFromExtensions(mailExtension);
	try {
		reader.parseEditorState(body);
		return true;
	} catch {
		return false;
	}
}

const isPerson = (value: unknown): value is MailPerson =>
	typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).name === "string" && typeof (value as Record<string, unknown>).address === "string";

const isPeople = (value: unknown): value is MailPerson[] => Array.isArray(value) && value.every(isPerson);

/** The draft that `raw` keeps, or `null` when nothing is kept or any part of it is missing, mistyped, or does not restore. */
export function decodeMailDraft(raw: string | null): StoredDraft | null {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return null;
	}
	if (typeof stored !== "object" || stored === null) return null;
	const { to, cc, bcc, subject, body } = stored as Record<string, unknown>;
	if (!isPeople(to) || !isPeople(cc) || !isPeople(bcc) || typeof subject !== "string" || typeof body !== "string" || !restores(body)) return null;
	return { to, cc, bcc, subject, body };
}
