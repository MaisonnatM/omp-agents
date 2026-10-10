/**
 * The saved conversations' prompts and replies, searched by every word typed. The first search reads every session
 * file; later ones read only what a file gained since, folded by the same `Transcript` the panes show.
 */
import { LineReader } from "./line-reader";
import { mapLimit, PROBE_PARALLEL } from "./map-limit";
import { everyWord } from "./shared/every-word";
import { type ConversationHit, MAX_CONVERSATION_HITS } from "./shared/sessions";
import type { Item } from "./shared/transcript";
import { Transcript } from "./transcript";

type Message = Extract<Item, { kind: "user" | "assistant" }>;

const isMessage = (item: Item): item is Message => item.kind === "user" || item.kind === "assistant";

/** A session file to search, as omp's listing gives it. */
export interface SearchedSession {
	id: string;
	path: string;
	modifiedAt: number;
}

/** The lines that can hold a prompt or a reply. Tool results, most of a file's bytes, go unparsed. */
const CONVERSATION_LINE = /"role":"(?:user|assistant)"|"type":"custom_message"/;

/** One session file, folded up to its last complete line. */
class Conversation {
	transcript = new Transcript();
	/** The file's time when it was last read whole; `NaN` until then, or after a read that failed. */
	modifiedAt = Number.NaN;
	readonly #lines: LineReader;

	constructor(path: string) {
		this.#lines = new LineReader(path, () => {
			this.transcript = new Transcript();
		});
	}

	async read(modifiedAt: number): Promise<void> {
		const read = await this.#lines.read(line => {
			if (!CONVERSATION_LINE.test(line)) return;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				return;
			}
			this.transcript.applyEntry(entry);
		});
		this.modifiedAt = read ? modifiedAt : Number.NaN;
	}
}

const SNIPPET_LEAD = 16;
const SNIPPET_LENGTH = 160;

/** `text` on one line, cut to a snippet that starts on a word a little before the first word of `query`. */
export function snippetOf(text: string, query: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const first = query.trim().toLowerCase().split(/\s+/)[0] ?? "";
	const at = Math.max(0, flat.toLowerCase().indexOf(first));
	let start = Math.max(0, at - SNIPPET_LEAD);
	if (start > 0 && flat[start - 1] !== " ") start = Math.min(at, flat.indexOf(" ", start) + 1);
	const end = Math.min(flat.length, start + SNIPPET_LENGTH);
	return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

export class ConversationSearch {
	readonly #byPath = new Map<string, Conversation>();
	/** Searches run one after another, so two never read the same file at once. */
	#chain: Promise<unknown> = Promise.resolve();

	/** The conversations among `sessions` whose prompts or replies hold every word of `query`, in the order given, each by its latest such message. */
	search(sessions: readonly SearchedSession[], query: string): Promise<ConversationHit[]> {
		const run = this.#chain.then(() => this.#search(sessions, query));
		this.#chain = run.catch(() => {});
		return run;
	}

	async #search(sessions: readonly SearchedSession[], query: string): Promise<ConversationHit[]> {
		const listed = new Set(sessions.map(session => session.path));
		for (const path of this.#byPath.keys()) if (!listed.has(path)) this.#byPath.delete(path);
		const stale = sessions.filter(({ path, modifiedAt }) => this.#byPath.get(path)?.modifiedAt !== modifiedAt);
		await mapLimit(stale, PROBE_PARALLEL, ({ path, modifiedAt }) => {
			let conversation = this.#byPath.get(path);
			if (!conversation) this.#byPath.set(path, (conversation = new Conversation(path)));
			return conversation.read(modifiedAt);
		});
		const holds = everyWord(query);
		const hits: ConversationHit[] = [];
		for (const session of sessions) {
			const messages = this.#byPath
				.get(session.path)!
				.transcript.items()
				.filter(isMessage)
				.filter(item => holds(item.text));
			const latest = messages.at(-1);
			if (!latest) continue;
			hits.push({ sessionId: session.id, messageId: latest.id, role: latest.kind, snippet: snippetOf(latest.text, query), matches: messages.length });
			if (hits.length === MAX_CONVERSATION_HITS) break;
		}
		return hits;
	}
}
