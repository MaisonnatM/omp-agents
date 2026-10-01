/**
 * Folds collab snapshot entries and live agent events into display items.
 *
 * The snapshot (`snapshot-chunk` entries) seeds the transcript; afterwards only
 * `event` frames render, mirroring omp's own guest, because every durable
 * `entry` frame repeats a message the events already showed.
 */
import type { Item } from "./shared";

type Json = Record<string, unknown>;
type ToolItem = Extract<Item, { kind: "tool" }>;

const COLLAB_PROMPT = "collab-prompt";
const SUMMARY_MAX = 160;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(block => isObject(block) && block.type === "text")
		.map(block => String(block.text))
		.join("\n");
}

function oneLine(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/** Best one-line description of a tool call: its stated intent, else its most telling argument. */
function toolSummary(args: unknown, intent: unknown): string {
	if (typeof intent === "string" && intent) return oneLine(intent);
	if (!isObject(args)) return "";
	if (typeof args.i === "string" && args.i) return oneLine(args.i);
	for (const key of ["command", "path", "pattern", "query", "url", "file_path", "description"]) {
		const value = args[key];
		if (typeof value === "string" && value) return oneLine(value);
	}
	const first = Object.values(args).find(value => typeof value === "string");
	return typeof first === "string" ? oneLine(first) : "";
}

export class Transcript {
	/** Insertion-ordered: display order is first-seen order. */
	#items = new Map<string, Item>();
	#liveKey: string | null = null;
	#liveSeq = 0;

	items(): Item[] {
		return [...this.#items.values()];
	}

	reset(): void {
		this.#items.clear();
		this.#liveKey = null;
	}

	/** Snapshot entry. Returns the items it created or changed. */
	applyEntry(entry: unknown): Item[] {
		if (!isObject(entry)) return [];
		const id = str(entry.id) ?? `entry${this.#items.size}`;
		switch (entry.type) {
			case "message":
				return this.#applyMessage(id, entry.message, false);
			case "custom_message":
				return this.#applyMessage(id, { ...entry, role: "custom" }, false);
			case "compaction":
				return this.#upsert({ id, kind: "notice", level: "info", text: "Earlier context was compacted." });
			default:
				return [];
		}
	}

	/** Live agent event. Returns the items it created or changed. */
	applyEvent(event: unknown): Item[] {
		if (!isObject(event)) return [];
		switch (event.type) {
			case "message_start":
				this.#liveKey = `live${++this.#liveSeq}`;
				return this.#applyMessage(this.#liveKey, event.message, true);
			case "message_update": {
				// Joining mid-turn yields updates without their start; key them as a fresh message.
				this.#liveKey ??= `live${++this.#liveSeq}`;
				const partial = isObject(event.assistantMessageEvent) ? event.assistantMessageEvent.partial : event.message;
				return this.#applyMessage(this.#liveKey, partial, true);
			}
			case "message_end": {
				const key = this.#liveKey ?? `live${++this.#liveSeq}`;
				this.#liveKey = null;
				return this.#applyMessage(key, event.message, false);
			}
			case "tool_execution_start":
				return this.#upsertTool(str(event.toolCallId), str(event.toolName), toolSummary(event.args, event.intent), "running");
			case "tool_execution_end":
				return this.#upsertTool(str(event.toolCallId), str(event.toolName), undefined, event.isError ? "error" : "ok");
			case "notice": {
				// Our own join/leave notices are noise in a dashboard that joins on every selection.
				if (event.source === "collab") return [];
				const level = event.level === "warning" || event.level === "error" ? event.level : "info";
				return this.#upsert({ id: `notice${++this.#liveSeq}`, kind: "notice", level, text: String(event.message) });
			}
			case "auto_retry_start":
				return this.#upsert({
					id: `notice${++this.#liveSeq}`,
					kind: "notice",
					level: "warning",
					text: `Retrying (${event.attempt}/${event.maxAttempts}): ${String(event.errorMessage)}`,
				});
			default:
				return [];
		}
	}

	/** Out-of-band line (host errors, questions waiting in the terminal). */
	note(level: "info" | "warning" | "error", text: string): Item[] {
		return this.#upsert({ id: `notice${++this.#liveSeq}`, kind: "notice", level, text });
	}

	#applyMessage(key: string, message: unknown, streaming: boolean): Item[] {
		if (!isObject(message)) return [];
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
			case "toolResult":
				return this.#upsertTool(str(message.toolCallId), str(message.toolName), undefined, message.isError ? "error" : "ok");
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
		return [item];
	}
}
