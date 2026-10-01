/**
 * Folds a session file's entries, plus live agent events, into display items.
 *
 * The session file is the record: every message it holds renders from it. Live
 * events only fill the gap before a message reaches the file, streaming the
 * assistant's partial text and the running state of tool calls. Both sources key
 * a message by its `timestamp`, which omp writes to the file unchanged, so the
 * file's copy replaces the streamed one in place and a late event cannot undo it.
 */
import type { Item } from "./shared";

type Json = Record<string, unknown>;
type ToolItem = Extract<Item, { kind: "tool" }>;

const COLLAB_PROMPT = "collab-prompt";
const SUMMARY_MAX = 160;

export const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(block => isObject(block) && block.type === "text")
		.map(block => String(block.text))
		.join("\n");
}

export function oneLine(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/** Best one-line description of a tool call: its stated intent, else its most telling argument. */
function toolSummary(args: unknown, intent: unknown): string {
	if (typeof intent === "string" && intent) return oneLine(intent);
	if (!isObject(args)) return "";
	if (typeof args.i === "string" && args.i) return oneLine(args.i);
	// `data` is a subagent's `yield` payload: its final answer.
	for (const key of ["command", "path", "pattern", "query", "url", "file_path", "description", "data", "message"]) {
		const value = args[key];
		if (typeof value === "string" && value) return oneLine(value);
	}
	const first = Object.values(args).find(value => typeof value === "string");
	return typeof first === "string" ? oneLine(first) : "";
}

/** The key a message shares between its live events and its file entry. */
const messageKey = (message: Json): string | undefined =>
	typeof message.timestamp === "number" ? `m${message.timestamp}` : undefined;

export class Transcript {
	/** Display order: by message time, then first seen. */
	#items = new Map<string, Item>();
	#times = new Map<string, number>();
	/** Message keys and tool-call ids the file already settled; live events leave them alone. */
	#settled = new Set<string>();
	#noticeSeq = 0;
	/** Time given to items created by the entry or event being applied. */
	#now = 0;
	#latest = 0;
	#reordered = false;

	items(): Item[] {
		return [...this.#items.values()];
	}

	/**
	 * Whether an item had to go ahead of items already returned since the last call,
	 * so upserts alone would misplace it. omp writes a fresh session's first prompt
	 * only together with the first reply, after that reply has streamed.
	 */
	takeReordered(): boolean {
		const reordered = this.#reordered;
		this.#reordered = false;
		return reordered;
	}

	/** One session-file entry. Returns the items it created or changed. */
	applyEntry(entry: unknown): Item[] {
		if (!isObject(entry)) return [];
		const id = str(entry.id) ?? `entry${this.#items.size}`;
		const written = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
		const sent = isObject(entry.message) ? entry.message.timestamp : undefined;
		this.#now = typeof sent === "number" ? sent : Number.isNaN(written) ? this.#latest : written;
		switch (entry.type) {
			case "message": {
				if (!isObject(entry.message)) return [];
				const key = messageKey(entry.message) ?? id;
				this.#settled.add(key);
				return this.#applyMessage(key, entry.message, false);
			}
			case "custom_message":
				return this.#applyMessage(id, { ...entry, role: "custom" }, false);
			case "compaction":
				return this.#upsert({ id, kind: "notice", level: "info", text: "Earlier context was compacted." });
			default:
				return [];
		}
	}

	/** Complete JSONL lines of a session file. */
	applyLines(lines: string[]): Item[] {
		return lines.flatMap(line => {
			try {
				return line ? this.applyEntry(JSON.parse(line)) : [];
			} catch {
				return [];
			}
		});
	}

	/** Live agent event. Returns the items it created or changed. */
	applyEvent(event: unknown): Item[] {
		if (!isObject(event)) return [];
		const message = isObject(event.assistantMessageEvent) && isObject(event.assistantMessageEvent.partial)
			? event.assistantMessageEvent.partial
			: event.message;
		this.#now = isObject(message) && typeof message.timestamp === "number" ? message.timestamp : Date.now();
		switch (event.type) {
			case "message_start":
			case "message_update":
				return this.#applyLive(message, true);
			case "message_end":
				return this.#applyLive(message, false);
			case "tool_execution_start":
				return this.#upsertLiveTool(str(event.toolCallId), str(event.toolName), toolSummary(event.args, event.intent), "running");
			case "tool_execution_end":
				return this.#upsertLiveTool(str(event.toolCallId), str(event.toolName), undefined, event.isError ? "error" : "ok");
			case "agent_end":
				// An interrupted turn ends without tool_execution_end for the call it cut off.
				return [...this.#items.values()].flatMap(item =>
					item.kind === "tool" && item.status === "running" ? this.#upsert({ ...item, status: "error" }) : [],
				);
			case "notice": {
				// Join and leave notices (including this dashboard's own) are noise here.
				if (event.source === "collab") return [];
				const level = event.level === "warning" || event.level === "error" ? event.level : "info";
				return this.note(level, String(event.message));
			}
			case "auto_retry_start":
				return this.note("warning", `Retrying (${event.attempt}/${event.maxAttempts}): ${String(event.errorMessage)}`);
			default:
				return [];
		}
	}

	/** Out-of-band line (host errors, questions waiting in the terminal). */
	note(level: "info" | "warning" | "error", text: string): Item[] {
		this.#now = Date.now();
		return this.#upsert({ id: `notice${++this.#noticeSeq}`, kind: "notice", level, text });
	}

	/**
	 * Tool results reach the file as soon as they exist; prompts and replies may not (see
	 * {@link takeReordered}). Collab prompts stay file-only: their file entry carries no
	 * message timestamp to merge on.
	 */
	#applyLive(message: unknown, streaming: boolean): Item[] {
		if (!isObject(message) || (message.role !== "assistant" && message.role !== "user")) return [];
		const key = messageKey(message);
		if (!key || this.#settled.has(key)) return [];
		return this.#applyMessage(key, message, streaming);
	}

	#applyMessage(key: string, message: Json, streaming: boolean): Item[] {
		switch (message.role) {
			case "user": {
				if (message.synthetic) return [];
				return this.#upsert({ id: key, kind: "user", text: textOf(message.content), from: null });
			}
			case "custom": {
				if (message.customType !== COLLAB_PROMPT) return [];
				const from = isObject(message.details) ? (str(message.details.from) ?? null) : null;
				return this.#upsert({ id: key, kind: "user", text: textOf(message.content), from });
			}
			case "assistant":
				return this.#applyAssistant(key, message, streaming);
			case "toolResult": {
				const callId = str(message.toolCallId);
				if (callId) this.#settled.add(`tool:${callId}`);
				return this.#upsertTool(callId, str(message.toolName), undefined, message.isError ? "error" : "ok");
			}
			default:
				return [];
		}
	}

	#applyAssistant(key: string, message: Json, streaming: boolean): Item[] {
		const changed: Item[] = [];
		const content = Array.isArray(message.content) ? message.content : [];
		content.forEach((block, index) => {
			if (!isObject(block)) return;
			if (block.type === "text" && typeof block.text === "string" && block.text) {
				changed.push(...this.#upsert({ id: `${key}:${index}`, kind: "assistant", text: block.text, streaming }));
			} else if (block.type === "toolCall") {
				changed.push(...this.#upsertTool(str(block.id), str(block.name), toolSummary(block.arguments, block.intent), undefined));
			}
		});
		if (!streaming && (message.stopReason === "error" || message.stopReason === "aborted")) {
			const text = message.stopReason === "aborted" ? "Interrupted." : `Error: ${str(message.errorMessage) ?? "request failed"}`;
			changed.push(...this.#upsert({ id: `${key}:stop`, kind: "notice", level: message.stopReason === "aborted" ? "warning" : "error", text }));
		}
		return changed;
	}

	#upsertLiveTool(callId: string | undefined, name: string | undefined, summary: string | undefined, status: ToolItem["status"]): Item[] {
		if (!callId || this.#settled.has(`tool:${callId}`)) return [];
		return this.#upsertTool(callId, name, summary, status);
	}

	/** Tool calls show up as content blocks, execution events, and result messages; merge them by call id. */
	#upsertTool(callId: string | undefined, name: string | undefined, summary: string | undefined, status: ToolItem["status"] | undefined): Item[] {
		if (!callId) return [];
		const id = `tool:${callId}`;
		const prev = this.#items.get(id);
		const base: ToolItem = prev?.kind === "tool" ? prev : { id, kind: "tool", name: name ?? "tool", summary: "", status: "running" };
		return this.#upsert({
			...base,
			name: name ?? base.name,
			summary: summary || base.summary,
			// A finished call stays finished when a later content-block replay reports no status.
			status: status ?? base.status,
		});
	}

	#upsert(item: Item): Item[] {
		const prev = this.#items.get(item.id);
		if (prev && JSON.stringify(prev) === JSON.stringify(item)) return [];
		this.#items.set(item.id, item);
		if (!prev) {
			this.#times.set(item.id, this.#now);
			if (this.#now < this.#latest) {
				this.#reordered = true;
				const times = this.#times;
				// Stable: items with the same time keep their first-seen order.
				this.#items = new Map([...this.#items].sort(([a], [b]) => (times.get(a) ?? 0) - (times.get(b) ?? 0)));
			}
			this.#latest = Math.max(this.#latest, this.#now);
		}
		return [item];
	}
}
