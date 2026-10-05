/** The vocabulary of omp's session-file entries: what the folds over a transcript read out of an entry, each in one place. */
import { isObject, str } from "./json";
import { PROMPT_IMAGE_TYPES } from "./shared";

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

/** How omp's session files point at an image it moved to its blob store. */
const BLOB_REF = /^blob:sha256:([0-9a-f]{64})$/;

/**
 * The images of a message's content, as the page shows them: inline as a `data:` URL, or through `/api/image` once omp
 * moved them to its blob store. Types the page does not show are left out.
 */
export function imagesOf(content: unknown): { images?: string[] } {
	if (!Array.isArray(content)) return {};
	const images = content.flatMap(block => {
		if (!isObject(block) || block.type !== "image" || typeof block.data !== "string") return [];
		const type = str(block.mimeType);
		if (!type || !PROMPT_IMAGE_TYPES.includes(type)) return [];
		const hash = BLOB_REF.exec(block.data)?.[1];
		return [hash ? `/api/image?${new URLSearchParams({ hash, type })}` : `data:${type};base64,${block.data}`];
	});
	return images.length > 0 ? { images } : {};
}

/** Best one-line description of a tool call: its stated intent, else its most telling argument. */
export function toolSummary(args: unknown, intent: unknown): string {
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
	/** The intent omp's harness asked the model to state, when it stated one. */
	intent: string | undefined;
}

/** The tool calls an assistant message made, in order; none for any other message. */
export function toolCallsOf(message: Record<string, unknown>): ToolCall[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
	return message.content.flatMap(block => {
		if (!isObject(block) || block.type !== "toolCall" || typeof block.id !== "string") return [];
		return [{ id: block.id, name: str(block.name) ?? "", args: isObject(block.arguments) ? block.arguments : {}, intent: str(block.intent) }];
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
