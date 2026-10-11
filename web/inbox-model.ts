/** The Inbox page's conversation details, as pure transforms: which messages show open, closed, or stacked, and what an open one renders. */
import type { MailMessage, MailPerson } from "../src/shared/gmail";

/** A row of a conversation: a message in full, a message on one line, or a run of closed messages folded into one. */
export type MailRow = { kind: "open"; message: MailMessage } | { kind: "closed"; message: MailMessage } | { kind: "stack"; ids: string[] };

/** What you changed of a conversation's folding: the messages opened or closed against how they start, and those whose stack you unfolded. */
export interface Folds {
	flipped: ReadonlySet<string>;
	unstacked: ReadonlySet<string>;
}

export const NO_FOLDS: Folds = { flipped: new Set(), unstacked: new Set() };

export type FoldEvent = { kind: "toggle"; id: string } | { kind: "unstack"; ids: readonly string[] } | { kind: "expand-all"; messages: readonly MailMessage[] };

/** The fewest closed messages in a row that fold into one `N older messages` row. */
const STACK_MIN = 3;

/** As Gmail opens a conversation: the last message and every unread one start open, the others closed. */
const startsOpen = (messages: readonly MailMessage[], index: number): boolean => messages[index]!.unread || index === messages.length - 1;

/**
 * The rows of `messages` under `folds`. A run of {@link STACK_MIN} or more messages after the first that start closed,
 * and that you neither toggled nor unfolded, folds into a stack, so the first message and the latest ones stay in view.
 */
export function foldMessages(messages: readonly MailMessage[], folds: Folds): MailRow[] {
	const rows: MailRow[] = [];
	let run: MailMessage[] = [];
	const endRun = (): void => {
		if (run.length >= STACK_MIN) rows.push({ kind: "stack", ids: run.map(message => message.id) });
		else for (const message of run) rows.push({ kind: "closed", message });
		run = [];
	};
	messages.forEach((message, index) => {
		const flipped = folds.flipped.has(message.id);
		const open = startsOpen(messages, index) !== flipped;
		if (!open && index > 0 && !flipped && !folds.unstacked.has(message.id)) {
			run.push(message);
			return;
		}
		endRun();
		rows.push({ kind: open ? "open" : "closed", message });
	});
	endRun();
	return rows;
}

/** `folds` after `event`: a message opened or closed, a stack unfolded into its messages, or every message opened. */
export function foldsAfter(folds: Folds, event: FoldEvent): Folds {
	switch (event.kind) {
		case "toggle": {
			const flipped = new Set(folds.flipped);
			if (!flipped.delete(event.id)) flipped.add(event.id);
			return { ...folds, flipped };
		}
		case "unstack":
			return { ...folds, unstacked: new Set([...folds.unstacked, ...event.ids]) };
		case "expand-all": {
			const { messages } = event;
			// Unstacked too, so closing one of them again leaves it on its own row instead of folding it back away.
			return { flipped: new Set(messages.filter((_, index) => !startsOpen(messages, index)).map(({ id }) => id)), unstacked: new Set(messages.map(({ id }) => id)) };
		}
		default: {
			const never: never = event;
			return never;
		}
	}
}

/** Who someone is to the reader: `me` for `address`, the inbox's own, else their name, else their address. */
export const personLabel = (person: MailPerson, address: string | null): string =>
	address !== null && person.address.toLowerCase() === address.toLowerCase() ? "me" : person.name || person.address;

/** Whom a message went to, as Gmail words it under the sender: `to me, Bob, cc Carol`; `""` when its headers name no one. */
export function recipientsLine({ to, cc }: MailMessage, address: string | null): string {
	const names = (people: MailPerson[]): string => people.map(person => personLabel(person, address)).join(", ");
	return [to.length > 0 ? `to ${names(to)}` : "", cc.length > 0 ? `cc ${names(cc)}` : ""].filter(Boolean).join(", ");
}

/** A run of plain text, or a web address in it. */
export type TextPart = { kind: "text"; text: string } | { kind: "link"; href: string };

const WEB_ADDRESS = /\bhttps?:\/\/[^\s<>"]+/gi;
/** What ends a sentence or closes a bracket after an address rather than belonging to it. */
const TRAILING = /[.,;:!?'")\]]+$/;

/** `text` cut into its runs and the web addresses it holds, so a plain text message's addresses become links. */
export function linkParts(text: string): TextPart[] {
	const parts: TextPart[] = [];
	let end = 0;
	for (const match of text.matchAll(WEB_ADDRESS)) {
		const href = match[0].replace(TRAILING, "");
		if (match.index > end) parts.push({ kind: "text", text: text.slice(end, match.index) });
		parts.push({ kind: "link", href });
		end = match.index + href.length;
	}
	if (end < text.length) parts.push({ kind: "text", text: text.slice(end) });
	return parts;
}

/**
 * What a message's frame may load: images, styles, and fonts over HTTPS or inline, and nothing else. Its sandbox already
 * stops scripts, forms, and popups; this also stops a message from fetching, framing, or embedding anything.
 */
const MAIL_POLICY = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:";

/** The look a message without styles of its own gets, on the white it was written for in either theme. */
const MAIL_STYLE =
	":root{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#1f1f1f;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;overflow-wrap:anywhere}img{max-width:100%}pre{white-space:pre-wrap}";

/** The document a message's HTML renders in: the policy and the referrer rule come first, so the message's own markup cannot precede them. */
export const mailDocument = (html: string): string =>
	`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${MAIL_POLICY}"><meta name="referrer" content="no-referrer"><style>${MAIL_STYLE}</style></head><body>${html}</body></html>`;
