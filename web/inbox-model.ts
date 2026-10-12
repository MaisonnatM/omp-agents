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

/** Who wrote in a conversation, as its header lists them: each sender's {@link personLabel} once, in the order they first wrote. */
export const participants = (messages: readonly MailMessage[], address: string | null): string[] => [
	...new Set(messages.map(message => personLabel(message.from, address)).filter(Boolean)),
];

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LEADING_ARTICLE = /^(?:the|a|an)\b[\s'".,!?-]*/i;

/** The letter on someone's avatar: the first letter or digit of their name past a leading article, else of their address, in capitals; `?` when neither has one. */
export function initialOf({ name, address }: MailPerson): string {
	for (const text of [name.replace(LEADING_ARTICLE, ""), address]) {
		for (const { segment } of graphemes.segment(text)) if (LETTER_OR_DIGIT.test(segment)) return segment.normalize("NFC").toUpperCase();
	}
	return "?";
}

/** Which of `size` colours someone's avatar takes, from a hash of their address in any case, so a sender keeps one colour everywhere. */
export function colorIndex(address: string, size: number): number {
	// FNV-1a, 32 bits.
	let hash = 0x811c9dc5;
	for (const char of address.toLowerCase()) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193);
	return (hash >>> 0) % size;
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
