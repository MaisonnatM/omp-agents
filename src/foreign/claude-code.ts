import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { isObject, nonEmptyStr, num, parseJson, str } from "../json";
import type { SessionFormat } from "../session-formats";
import { lineId, oneLine, textOf, unreadLine } from "../session-entries";
import { type FileEdges, ForeignFiles, type SessionSummary } from "./files";
import type { ForeignRequest, Pricer, RequestTokens, UsageFold } from "./usage";

type Json = Record<string, unknown>;

interface DecodedBlocks {
	content: Json[];
	unread: boolean;
}

/** Claude Code's projects directory, under `CLAUDE_CONFIG_DIR` when set. */
export const claudeCodeRoot = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

const SKIPPED: Record<string, true> = {
	attachment: true,
	"last-prompt": true,
	"queue-operation": true,
	"atis-latch": true,
	"ai-title": true,
	mode: true,
	"permission-mode": true,
	"cost-state": true,
	"file-history-snapshot": true,
	summary: true,
};

/** A session file, one directory below the root; subagent transcripts and memory sit deeper. */
export function claudeCodeFileOf(changedPath: string, root: string): string | null {
	const parts = relative(root, changedPath).split(sep);
	const name = parts.at(-1) ?? "";
	return parts.length === 2 && parts[0] !== ".." && name.endsWith(".jsonl") && !name.startsWith(".") ? changedPath : null;
}

function blockOf(block: unknown, tools: boolean): Json[] | null {
	if (!isObject(block)) return null;
	switch (block.type) {
		case "text":
			return typeof block.text === "string" ? (block.text ? [{ type: "text", text: block.text }] : []) : null;
		case "thinking":
			return typeof block.thinking === "string" ? (block.thinking ? [{ type: "thinking", thinking: block.thinking }] : []) : null;
		case "redacted_thinking":
			return typeof block.data === "string" ? [] : null;
		case "tool_use": {
			const id = nonEmptyStr(block.id);
			const name = nonEmptyStr(block.name);
			return tools && id && name && isObject(block.input) && !Array.isArray(block.input)
				? [{ type: "toolCall", id, name, arguments: block.input }]
				: null;
		}
		case "image": {
			const source = isObject(block.source) ? block.source : {};
			const mimeType = nonEmptyStr(source.media_type);
			return source.type === "base64" && typeof source.data === "string" && mimeType
				? [{ type: "image", data: source.data, mimeType }]
				: null;
		}
		default:
			return null;
	}
}

function blocksOf(content: unknown, tools = false): DecodedBlocks {
	if (typeof content === "string") return { content: content ? [{ type: "text", text: content }] : [], unread: false };
	const decoded: DecodedBlocks = { content: [], unread: !Array.isArray(content) };
	if (!Array.isArray(content)) return decoded;
	for (const block of content) {
		const parsed = blockOf(block, tools);
		if (parsed === null) decoded.unread = true;
		else decoded.content.push(...parsed);
	}
	return decoded;
}

function messageEntries(record: Json, message: Json, id: string, line: string): unknown[] {
	const { timestamp } = record;
	const entries: unknown[] = [];
	const prompt: unknown[] = [];
	let unread = false;
	if (record.type === "user" && Array.isArray(message.content)) {
		for (const [index, block] of message.content.entries()) {
			if (!isObject(block) || block.type !== "tool_result") {
				prompt.push(block);
				continue;
			}
			const toolCallId = nonEmptyStr(block.tool_use_id);
			const decoded = blocksOf(block.content);
			unread ||= decoded.unread || !toolCallId || (block.is_error !== undefined && typeof block.is_error !== "boolean");
			if (toolCallId) entries.push({
				type: "message", id: `${id}:${index}`, timestamp,
				message: { role: "toolResult", toolCallId, isError: block.is_error === true, content: decoded.content },
			});
		}
	}
	const decoded = blocksOf(record.type === "user" && Array.isArray(message.content) ? prompt : message.content, record.type === "assistant");
	if (decoded.content.length > 0) entries.push({ type: "message", id, timestamp, message: { role: record.type, content: decoded.content } });
	if (unread || decoded.unread) entries.push(unreadLine(line, timestamp));
	return entries;
}

function decodeRecord(record: unknown, line: string): unknown[] {
	if (!isObject(record)) return [unreadLine(line, undefined)];
	const type = str(record.type) ?? "";
	if (Object.hasOwn(SKIPPED, type)) return [];
	const id = str(record.uuid) ?? lineId("claude", line);
	if (type === "system") return record.subtype === "compact_boundary" ? [{ type: "compaction", id, timestamp: record.timestamp }] : [];
	if (type !== "user" && type !== "assistant") return [unreadLine(line, record.timestamp)];
	// Meta records are context Claude Code injected; sidechains are subagents' turns.
	if (record.isMeta === true || record.isSidechain === true) return [];
	const { message } = record;
	if (!isObject(message) || (typeof message.content !== "string" && !Array.isArray(message.content))) return [unreadLine(line, record.timestamp)];
	return messageEntries(record, message, id, line);
}

/** One line of a Claude Code session file as omp entries. */
export const decodeClaudeCodeLine = (line: string): unknown[] => decodeRecord(parseJson(line), line);

function summarize({ head, tail }: FileEdges, path: string): SessionSummary {
	let cwd: string | undefined;
	let title: string | null = null;
	let prompt: string | null = null;
	let answered = false;
	for (const line of [...head, ...tail]) {
		const record = parseJson(line);
		if (!isObject(record)) continue;
		cwd ??= nonEmptyStr(record.cwd);
		if (record.type === "ai-title") title = nonEmptyStr(record.aiTitle) ?? title;
		for (const entry of decodeRecord(record, line)) {
			if (!isObject(entry) || !isObject(entry.message)) continue;
			if (entry.message.role === "assistant") answered = true;
			if (entry.message.role === "user") prompt ??= textOf(entry.message.content);
		}
	}
	const promptTitle = prompt ? oneLine(prompt) : "";
	return { id: basename(path, ".jsonl"), cwd: cwd ?? "", title: title ?? (promptTitle || null), empty: prompt === null && !answered };
}

const SYNTHETIC = "<synthetic>";

const count = (value: unknown): number => num(value) ?? 0;

function tokensOf(usage: Json): RequestTokens {
	const tokens = { input: count(usage.input_tokens), output: count(usage.output_tokens), cacheRead: count(usage.cache_read_input_tokens), cacheWrite: count(usage.cache_creation_input_tokens) };
	const writes = usage.cache_creation;
	return isObject(writes) ? { ...tokens, cttl: { ephemeral5m: count(writes.ephemeral_5m_input_tokens), ephemeral1h: count(writes.ephemeral_1h_input_tokens) } } : tokens;
}

/**
 * The requests one Claude Code transcript records. Claude Code writes a reply as one line per content block, each
 * repeating the request's `message.id` and its usage so far, so a request is its id's last line.
 */
export class ClaudeCodeUsage implements UsageFold {
	readonly path: string;
	readonly sessionId: string;
	readonly subagent: boolean;
	cwd = "";
	readonly #price: Pricer;
	readonly #byId = new Map<string, ForeignRequest>();

	/** A transcript under `<root>/<slug>/<session id>/subagents/` counts toward that session as subagent usage. */
	constructor(path: string, root: string, price: Pricer) {
		const parts = relative(root, path).split(sep);
		this.path = path;
		this.subagent = parts.length > 2;
		this.sessionId = this.subagent ? (parts[1] ?? "") : basename(path, ".jsonl");
		this.#price = price;
	}

	get requests(): Iterable<ForeignRequest> {
		return this.#byId.values();
	}

	applyLine(line: string): void {
		if (!line.includes('"type":"assistant"')) return;
		const record = parseJson(line);
		if (!isObject(record) || record.type !== "assistant" || !isObject(record.message)) return;
		this.cwd ||= str(record.cwd) ?? "";
		const { id, model, usage } = record.message;
		const timestamp = Date.parse(str(record.timestamp) ?? "");
		if (typeof id !== "string" || typeof model !== "string" || model === SYNTHETIC || !isObject(usage) || Number.isNaN(timestamp)) return;
		const tokens = tokensOf(usage);
		const { cttl: _, ...counts } = tokens;
		const cost = this.#price("anthropic", model, tokens, timestamp);
		this.#byId.set(id, { provider: "anthropic", model, timestamp, failed: record.isApiErrorMessage === true, ...counts, cost });
	}
}

/** Claude Code's sessions under `root`, its projects directory. */
export function claudeCodeFormat(root: string = claudeCodeRoot()): SessionFormat {
	const files = new ForeignFiles(root, "*/*.jsonl", "claude-code", summarize);
	return {
		source: "claude-code",
		root,
		createRoot: false,
		fileOf: path => claudeCodeFileOf(path, root),
		list: () => files.list(),
		read: path => files.read(path),
		decode: decodeClaudeCodeLine,
		messageLine: /"type":"(?:user|assistant)"/,
		usage: { patterns: ["*/*.jsonl", "*/*/subagents/*.jsonl"], fold: (path, price) => new ClaudeCodeUsage(path, root, price) },
	};
}
