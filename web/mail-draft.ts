/**
 * A mail being written, with one owner: `useMailDraft` holds its document and changes it only on the events a person
 * makes, keeping it in the browser until it is sent or thrown away; `useReplyDraft` captures a reply's people when the
 * reply begins. Sending freezes the document it submits until the send settles, and a delivered mail stays sent even
 * when the browser cannot forget its draft. `decodeMailDraft` reads a kept draft back only when every field has its
 * shape and the body restores into the editor's nodes.
 */
import { buildEditorFromExtensions } from "@lexical/extension";
import { HistoryExtension } from "@lexical/history";
import { AutoLinkExtension, autoLinkUrlMatcher, LinkExtension } from "@lexical/link";
import { ListExtension } from "@lexical/list";
import { RichTextExtension } from "@lexical/rich-text";
import { configExtension, defineExtension, type LexicalEditor } from "lexical";
import { useEffect, useMemo, useReducer, useState } from "react";
import { errorText } from "../src/json";
import { type MailMessage, type MailPerson, recipientsOf } from "../src/shared/gmail";

/** Who a mail goes to, by field. */
export interface MailRecipients {
	to: MailPerson[];
	cc: MailPerson[];
	bcc: MailPerson[];
}

/** A mail as written and as the browser keeps it: its people, its subject, and the editor's document as JSON, `""` while the body holds no text. */
export interface MailDocument extends MailRecipients {
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
export function decodeMailDraft(raw: string | null): MailDocument | null {
	let stored: unknown;
	try {
		stored = JSON.parse(raw ?? "null");
	} catch {
		return null;
	}
	if (typeof stored !== "object" || stored === null) return null;
	const { to, cc, bcc, subject, body } = stored as Record<string, unknown>;
	if (!isPeople(to) || !isPeople(cc) || !isPeople(bcc) || typeof subject !== "string" || typeof body !== "string" || (body !== "" && !restores(body))) return null;
	return { to, cc, bcc, subject, body };
}

/** Where a draft stands: being written, with why its last send failed if one did, or being sent, when its document is the one submitted and takes no edit. */
export type MailDraftPhase = { kind: "editing"; failure: string | null } | { kind: "sending" };

const EDITING: MailDraftPhase = { kind: "editing", failure: null };

/** A draft being written: the document it began as, the one written since, and where its sending stands. */
export interface MailDraftState {
	start: MailDocument;
	current: MailDocument;
	phase: MailDraftPhase;
}

/** What changes a draft: each is something a person does, or how a send they made settles; nothing a background read brings in is one. */
export type MailDraftEvent =
	| { kind: "begin"; start: MailDocument; kept: MailDocument | null }
	| { kind: "choose-reply-mode"; to: MailPerson[]; cc: MailPerson[] }
	| { kind: "edit-recipients"; field: keyof MailRecipients; people: MailPerson[] }
	| { kind: "edit-subject"; subject: string }
	| { kind: "edit-body"; body: string }
	| { kind: "send" }
	| { kind: "send-failed"; error: string }
	| { kind: "sent" }
	| { kind: "end" };

/**
 * `draft` after `event`. Beginning takes the kept draft over the start; choosing Reply or Reply all replaces To and Cc
 * in both the start and the draft, keeping Bcc; ending closes it. Sending freezes the document until the send fails,
 * which reopens it with why, or is sent, which closes it. An edit to no draft, or to one being sent, is none.
 */
export function mailDraftAfter(draft: MailDraftState | null, event: MailDraftEvent): MailDraftState | null {
	switch (event.kind) {
		case "begin":
			return { start: event.start, current: event.kept ?? event.start, phase: EDITING };
		case "end":
			return null;
	}
	if (draft === null) return null;
	const sending = draft.phase.kind === "sending";
	switch (event.kind) {
		case "send":
			return sending ? draft : { ...draft, phase: { kind: "sending" } };
		case "send-failed":
			return sending ? { ...draft, phase: { kind: "editing", failure: event.error } } : draft;
		case "sent":
			return sending ? null : draft;
	}
	if (sending) return draft;
	switch (event.kind) {
		case "choose-reply-mode": {
			const people = { to: event.to, cc: event.cc };
			return { ...draft, start: { ...draft.start, ...people }, current: { ...draft.current, ...people } };
		}
		case "edit-recipients":
			return { ...draft, current: { ...draft.current, [event.field]: event.people } };
		case "edit-subject":
			return { ...draft, current: { ...draft.current, subject: event.subject } };
		case "edit-body":
			return { ...draft, current: { ...draft.current, body: event.body } };
		default: {
			const never: never = event;
			return never;
		}
	}
}

/**
 * Sends `submitted` with `deliver`, the draft frozen from `send` until it settles. A failed delivery reopens the draft
 * with why; a delivered one closes it and only then has `forget` drop the browser's copy, whose failure leaves the mail
 * sent. Whether it was sent.
 */
export async function sendMailDraft(submitted: MailDocument, deliver: (document: MailDocument) => Promise<void>, dispatch: (event: MailDraftEvent) => void, forget: () => void): Promise<boolean> {
	dispatch({ kind: "send" });
	try {
		await deliver(submitted);
	} catch (err) {
		dispatch({ kind: "send-failed", error: errorText(err) });
		return false;
	}
	dispatch({ kind: "sent" });
	try {
		forget();
	} catch (err) {
		console.error("The mail was sent, but the browser could not forget its draft", err);
	}
	return true;
}

const samePeople = (a: MailPerson[], b: MailPerson[]): boolean => a.length === b.length && a.every((person, i) => person.name === b[i]?.name && person.address === b[i]?.address);

/** Whether `draft` is still the document it began as, in every field, so there is nothing to keep. */
export const draftUnchanged = ({ start, current }: MailDraftState): boolean =>
	samePeople(start.to, current.to) && samePeople(start.cc, current.cc) && samePeople(start.bcc, current.bcc) && start.subject === current.subject && start.body === current.body;

/** The edits a mail editor makes to the draft it shows, and its sending. */
export interface MailDraftEdits {
	editRecipients: (field: keyof MailRecipients, people: MailPerson[]) => void;
	editSubject: (subject: string) => void;
	/** The editor's document as JSON, or `""` when it holds no text. */
	editBody: (body: string) => void;
	/** Submits the document with `deliver`, refusing edits until it settles, then forgets it once sent; whether it was sent. */
	send: (deliver: (document: MailDocument) => Promise<void>) => Promise<boolean>;
	/** Forgets the draft and what the browser keeps of it, after it is thrown away. */
	discard: () => void;
}

/** A draft open in an editor: its document, and where its sending stands. */
export interface OpenMailDraft {
	document: MailDocument;
	phase: MailDraftPhase;
}

/** A draft's one owner: the draft being written, `null` while none is, and the events that change it. */
export interface MailDraftController extends MailDraftEdits {
	draft: OpenMailDraft | null;
	/** Starts writing from `start`, or from the draft the browser keeps when it holds one. */
	begin: (start: MailDocument) => void;
	chooseReplyMode: (to: MailPerson[], cc: MailPerson[]) => void;
	/** Stops writing and keeps the draft in the browser. */
	close: () => void;
}

/**
 * The draft kept under `key`, begun from `start` at once, or on `begin` when `start` is `null`. The browser keeps it
 * after each event that leaves it changed from its start, and forgets it when it is back to its start.
 */
export function useMailDraft(key: string, start: MailDocument | null): MailDraftController {
	const storageKey = `omp-agents.mail-draft.${key}`;
	const [state, dispatch] = useReducer(mailDraftAfter, null, () =>
		start === null ? null : mailDraftAfter(null, { kind: "begin", start, kept: decodeMailDraft(localStorage.getItem(storageKey)) }),
	);
	useEffect(() => {
		if (state === null) return;
		if (draftUnchanged(state)) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, JSON.stringify(state.current satisfies MailDocument));
	}, [state, storageKey]);
	const events = useMemo(
		() => ({
			begin: (start: MailDocument) => dispatch({ kind: "begin", start, kept: decodeMailDraft(localStorage.getItem(storageKey)) }),
			chooseReplyMode: (to: MailPerson[], cc: MailPerson[]) => dispatch({ kind: "choose-reply-mode", to, cc }),
			editRecipients: (field: keyof MailRecipients, people: MailPerson[]) => dispatch({ kind: "edit-recipients", field, people }),
			editSubject: (subject: string) => dispatch({ kind: "edit-subject", subject }),
			editBody: (body: string) => dispatch({ kind: "edit-body", body }),
			close: () => dispatch({ kind: "end" }),
			discard: () => {
				localStorage.removeItem(storageKey);
				dispatch({ kind: "end" });
			},
		}),
		[storageKey],
	);
	const send = (deliver: (document: MailDocument) => Promise<void>): Promise<boolean> =>
		state === null || state.phase.kind === "sending" ? Promise.resolve(false) : sendMailDraft(state.current, deliver, dispatch, () => localStorage.removeItem(storageKey));
	return { ...events, send, draft: state && { document: state.current, phase: state.phase } };
}

/** A reply's draft, with whether it answers everyone and `compose`, which Reply and Reply all call. */
export interface ReplyDraft extends MailDraftController {
	all: boolean;
	/**
	 * Begins a reply to `last`'s people, or Reply all's, when none is being written; while one is, choosing the other mode
	 * readdresses it to `last` and choosing the same mode leaves it. A refreshed or newly arrived `last` changes nothing until then,
	 * and nothing does while the reply is being sent.
	 */
	compose: (all: boolean) => void;
}

/** The reply being written in conversation `thread`, whose latest message is `last`, from its account's own `address`. */
export function useReplyDraft(thread: string, last: MailMessage | undefined, address: string): ReplyDraft {
	const mail = useMailDraft(`thread.${thread}`, null);
	const [all, setAll] = useState(false);
	const compose = (choice: boolean): void => {
		if (last === undefined || mail.draft?.phase.kind === "sending") return;
		const { to, cc } = recipientsOf(last, address, choice);
		if (mail.draft === null) mail.begin({ to, cc, bcc: [], subject: "", body: "" });
		else if (choice !== all) mail.chooseReplyMode(to, cc);
		setAll(choice);
	};
	return { ...mail, all, compose };
}
