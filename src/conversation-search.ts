/**
 * The saved conversations' prompts and replies, searched by every word typed. `Conversations` keeps a fold of each
 * session's own file, which `SessionFactsIndex` feeds from its own read of that file, so no file is read a second
 * time and the search itself reads none.
 */
import type { LineFold } from "./line-reader";
import { everyWord, searchWords } from "./shared/every-word";
import type { ConversationHit } from "./shared/sessions";
import { messageItemsOf } from "./transcript";

/** A prompt or a reply, by the transcript item id the pane shows it under. */
interface ConversationMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
}

/** The lines that can hold a prompt or a reply. Tool results, most of a file's bytes, go unparsed. */
const CONVERSATION_LINE = /"role":"(?:user|assistant)"|"type":"custom_message"/;

/** A session file's prompts and replies in file order, by item id, so a message omp writes again keeps its place. */
class ConversationFold implements LineFold {
	readonly messages = new Map<string, ConversationMessage>();

	applyLine(line: string): void {
		if (!CONVERSATION_LINE.test(line)) return;
		let entry: unknown;
		try {
			entry = JSON.parse(line);
		} catch {
			return;
		}
		for (const item of messageItemsOf(entry)) this.messages.set(item.id, { id: item.id, role: item.kind, text: item.text });
	}
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

/** The prompts and replies of each listed session's own file, not its subagents', as far as its reader folded them. */
export class Conversations {
	readonly #byPath = new Map<string, ConversationFold>();

	/** An empty fold of session file `path`, in place of the one before: for its first read, and for each read that starts the file over. */
	start(path: string): LineFold {
		const fold = new ConversationFold();
		this.#byPath.set(path, fold);
		return fold;
	}

	/** Drop session file `path`, which left the list. */
	forget(path: string): void {
		this.#byPath.delete(path);
	}

	/** The conversations of `sessions`, in the order given, whose prompts or replies hold every word of `query`, each by its latest such message. */
	search(sessions: readonly { id: string; path: string }[], query: string): ConversationHit[] {
		const holds = everyWord(query);
		return sessions.flatMap(session => {
			const matching = [...(this.#byPath.get(session.path)?.messages.values() ?? [])].filter(message => holds(message.text));
			const latest = matching.at(-1);
			return latest ? [{ sessionId: session.id, messageId: latest.id, role: latest.role, snippet: snippetOf(latest.text, query), matches: matching.length }] : [];
		});
	}
}
