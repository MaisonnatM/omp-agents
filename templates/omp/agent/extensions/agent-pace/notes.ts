export const NUDGE =
	"Time matters here: do not spend time that can be avoided, and the earlier a correct result is obtained, the better. " +
	"First privately list what you need next; then request every item that doesn't depend on another's result in this one response.";

interface Block {
	type?: string;
	tool_use_id?: string;
	cache_control?: unknown;
	text?: string;
}

export interface Payload {
	messages?: Array<{ role?: string; content?: unknown }>;
}

/** Notes each tool-results message of an Anthropic request; a message keeps the note it first got. */
export class PaceNotes {
	private startedAt = Date.now();
	// The note each tool-results message got the first time it was sent, by its first tool_use_id.
	private readonly notes = new Map<string, string>();

	start(): void {
		this.startedAt = Date.now();
	}

	/** Appends the notes in place and says whether it changed the payload. */
	apply(payload: Payload): boolean {
		if (!Array.isArray(payload.messages)) return false;
		let changed = false;
		for (const message of payload.messages) {
			if (message.role !== "user" || !Array.isArray(message.content)) continue;
			const blocks = message.content as Block[];
			const id = blocks.find(block => block?.type === "tool_result")?.tool_use_id;
			if (!id) continue;
			let note = this.notes.get(id);
			if (note === undefined) {
				note = `elapsed ${Math.round((Date.now() - this.startedAt) / 1000)}s. ${NUDGE}`;
				this.notes.set(id, note);
			}
			const added: Block = { type: "text", text: note };
			// The cache breakpoint omp put on the last block moves to the note, so the note is cached too.
			const last = blocks[blocks.length - 1];
			if (last?.cache_control != null) {
				added.cache_control = last.cache_control;
				delete last.cache_control;
			}
			blocks.push(added);
			changed = true;
		}
		return changed;
	}
}
