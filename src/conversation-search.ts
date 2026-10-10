/**
 * The saved conversations' prompts and replies, searched by every word typed. `SessionFactsIndex` folds each session
 * file's lines here as it reads them, so the search itself reads no file.
 */
import { everyWord, searchWords } from "./shared/every-word";
import type { ConversationHit } from "./shared/sessions";
import { messageItemsOf } from "./transcript";

/** A prompt or a reply, by the transcript item id the pane shows it under. */
export interface ConversationMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
}

/** A session's prompts and replies in file order, by item id, so a message omp writes again keeps its place. */
export type Conversation = Map<string, ConversationMessage>;

/** The lines that can hold a prompt or a reply. Tool results, most of a file's bytes, go unparsed. */
const CONVERSATION_LINE = /"role":"(?:user|assistant)"|"type":"custom_message"/;

/** Add the prompts and replies of session-file `line` to `conversation`. */
export function foldConversationLine(conversation: Conversation, line: string): void {
	if (!CONVERSATION_LINE.test(line)) return;
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return;
	}
	for (const item of messageItemsOf(entry)) conversation.set(item.id, { id: item.id, role: item.kind, text: item.text });
}

const SNIPPET_LEAD = 16;
const SNIPPET_LENGTH = 160;

/** `text` on one line, cut to a snippet that starts on a word a little before the first word of `query`. */
export function snippetOf(text: string, query: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const at = Math.max(0, flat.toLowerCase().indexOf(searchWords(query)[0] ?? ""));
	let start = Math.max(0, at - SNIPPET_LEAD);
	if (start > 0 && flat[start - 1] !== " ") start = Math.min(at, flat.indexOf(" ", start) + 1);
	const end = Math.min(flat.length, start + SNIPPET_LENGTH);
	return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** The conversations of `sessions`, in the order given, whose prompts or replies hold every word of `query`, each by its latest such message. */
export function searchConversations(sessions: readonly { id: string; path: string }[], conversationOf: (path: string) => Conversation | null, query: string): ConversationHit[] {
	const holds = everyWord(query);
	return sessions.flatMap(session => {
		const matching = [...(conversationOf(session.path)?.values() ?? [])].filter(message => holds(message.text));
		const latest = matching.at(-1);
		return latest ? [{ sessionId: session.id, messageId: latest.id, role: latest.role, snippet: snippetOf(latest.text, query), matches: matching.length }] : [];
	});
}
