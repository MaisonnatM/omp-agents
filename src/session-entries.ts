/** The vocabulary of omp's session-file entries: what the folds over a transcript read out of an entry, each in one place. */
import { isObject, str } from "./json";

const SUMMARY_MAX = 160;

/** The text of a message's `content`, which is a string or a list of blocks. */
export function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(block => isObject(block) && block.type === "text")
		.map(block => String(block.text))
		.join("\n");
}

/** `text` as one line, cut to a summary's length. */
export function oneLine(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

/** An entry's ISO `timestamp` in ms since the epoch, or `null` when it has none. */
export function entryTime(entry: Record<string, unknown>): number | null {
	const at = Date.parse(str(entry.timestamp) ?? "");
	return Number.isFinite(at) ? at : null;
}

export interface ToolCall {
	id: string;
	/** Empty when the block names no tool. */
	name: string;
	args: Record<string, unknown>;
}

/** The tool calls an assistant message made, in order; none for any other message. */
export function toolCallsOf(message: Record<string, unknown>): ToolCall[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return message.content.flatMap(block => {
		if (!isObject(block) || block.type !== "toolCall" || typeof block.id !== "string") return [];
		return [{ id: block.id, name: str(block.name) ?? "", args: isObject(block.arguments) ? block.arguments : {} }];
	});
}

export interface ToolResult {
	callId: string | undefined;
	/** Empty when the message names no tool. */
	toolName: string;
	isError: boolean;
	details: Record<string, unknown>;
	content: unknown;
}

/** What a tool result message says, or `null` for any other message. */
export function toolResultOf(message: Record<string, unknown>): ToolResult | null {
	if (message.role !== "toolResult") return null;
	return {
		callId: str(message.toolCallId),
		toolName: str(message.toolName) ?? "",
		isError: message.isError === true,
		details: isObject(message.details) ? message.details : {},
		content: message.content,
	};
}
