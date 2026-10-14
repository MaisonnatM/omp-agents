import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
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

/** Codex's home directory, `CODEX_HOME` when set. */
export const codexHome = (): string => process.env.CODEX_HOME ?? join(homedir(), ".codex");

const SKIPPED: Record<string, true> = {
	session_meta: true,
	turn_context: true,
	world_state: true,
	token_usage_record: true,
	inter_agent_communication_metadata: true,
	event_msg: true,
};

const SKIPPED_ITEMS: Record<string, true> = { ghost_snapshot: true, agent_message: true };

/**
 * Context Codex sends as the user's words: plugin lists, AGENTS.md, the environment, an interrupted turn's marker.
 * Each is a block of its own, so the prompt is what is left.
 */
const INJECTED = /^(?:<recommended_plugins>|# AGENTS\.md instructions|<environment_context>|<turn_aborted>|<user_instructions>)/;

/** A failed command's status in the header a tool output starts with, before `Output:`. */
const FAILED_EXIT = /^(?:Exit code:|Process exited with code) (?!0$)-?\d+$/m;

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/** A rollout file, three directories (year, month, day) below the root. */
export function codexFileOf(changedPath: string, root: string): string | null {
	const parts = relative(root, changedPath).split(sep);
	const name = parts.at(-1) ?? "";
	return parts.length === 4 && parts[0] !== ".." && name.startsWith("rollout-") && name.endsWith(".jsonl") ? changedPath : null;
}

function blockOf(block: unknown, role: "user" | "assistant" | "toolResult"): Json[] | null {
	if (!isObject(block)) return null;
	if (block.type === "input_image") {
		const image = str(block.image_url)?.match(/^data:([^;]+);base64,(.+)$/s);
		return image ? [{ type: "image", mimeType: image[1], data: image[2] }] : null;
	}
	const textType = role === "toolResult"
		? block.type === "input_text" || block.type === "output_text" || block.type === "text"
		: block.type === (role === "user" ? "input_text" : "output_text");
	if (!textType || typeof block.text !== "string") return null;
	if (role === "user" && INJECTED.test(block.text.trimStart())) return [];
	return block.text ? [{ type: "text", text: block.text }] : [];
}

function blocksOf(content: unknown, role: "user" | "assistant" | "toolResult"): DecodedBlocks {
	const decoded: DecodedBlocks = { content: [], unread: !Array.isArray(content) };
	if (!Array.isArray(content)) return decoded;
	for (const block of content) {
		const parsed = blockOf(block, role);
		if (parsed === null) decoded.unread = true;
		else decoded.content.push(...parsed);
	}
	return decoded;
}

function outputOf(output: unknown): DecodedBlocks & { isError: boolean } {
	if (typeof output === "string") return { content: output ? [{ type: "text", text: output }] : [], unread: false, isError: FAILED_EXIT.test(output.split("\nOutput:")[0]) };
	if (Array.isArray(output)) return { ...blocksOf(output, "toolResult"), isError: false };
	if (isObject(output)) {
		const decoded = outputOf(output.content);
		return { ...decoded, unread: decoded.unread || (output.success !== undefined && typeof output.success !== "boolean"), isError: decoded.isError || output.success === false };
	}
	return { content: [], unread: true, isError: false };
}

function argumentsOf(raw: unknown): Json | null {
	const parsed = typeof raw === "string" ? parseJson(raw) : raw;
	if (isObject(parsed) && !Array.isArray(parsed)) return Array.isArray(parsed.command) ? { ...parsed, command: parsed.command.at(-1) } : parsed;
	return typeof raw === "string" && raw ? { input: raw } : null;
}

const message = (id: string, timestamp: unknown, role: string, content: Json[], extra: Json = {}): Json => ({
	type: "message",
	id,
	timestamp,
	message: { role, content, ...extra },
});

const toolCall = (id: string, timestamp: unknown, call: Json, settled: boolean): Json[] => [
	message(id, timestamp, "assistant", [{ type: "toolCall", ...call }]),
	...(settled ? [message(`${id}:result`, timestamp, "toolResult", [], { toolCallId: call.id, isError: false })] : []),
];

function decodeItem(item: Json, id: string, timestamp: unknown, line: string): unknown[] {
	const type = str(item.type) ?? "";
	if (Object.hasOwn(SKIPPED_ITEMS, type)) return [];
	switch (type) {
		case "message": {
			if (item.role !== "user" && item.role !== "assistant") return item.role === "developer" || item.role === "system" ? [] : [unreadLine(line, timestamp)];
			const decoded = blocksOf(item.content, item.role);
			const entries: unknown[] = decoded.content.length > 0 ? [message(id, timestamp, item.role, decoded.content)] : [];
			if (decoded.unread) entries.push(unreadLine(line, timestamp));
			return entries;
		}
		case "reasoning": {
			const parts: string[] = [];
			let unread = false;
			for (const [field, textType] of [["summary", "summary_text"], ["content", "reasoning_text"]] as const) {
				const value = item[field];
				if (value === undefined || (field === "content" && value === null)) continue;
				if (!Array.isArray(value)) {
					unread = true;
					continue;
				}
				for (const part of value) {
					if (!isObject(part) || part.type !== textType || typeof part.text !== "string") unread = true;
					else if (part.text) parts.push(part.text);
				}
			}
			if (item.summary === undefined && item.content === undefined && typeof item.encrypted_content !== "string") unread = true;
			const thinking = parts.join("\n\n");
			const entries: unknown[] = thinking ? [message(id, timestamp, "assistant", [{ type: "thinking", thinking }])] : [];
			if (unread) entries.push(unreadLine(line, timestamp));
			return entries;
		}
		case "function_call":
		case "custom_tool_call": {
			const callId = nonEmptyStr(item.call_id);
			const name = nonEmptyStr(item.name);
			const namespace = item.namespace === undefined || item.namespace === null ? undefined : nonEmptyStr(item.namespace);
			const args = type === "function_call" ? argumentsOf(item.arguments) : typeof item.input === "string" ? { input: item.input } : null;
			if (!callId || !name || !args || (item.namespace !== undefined && item.namespace !== null && !namespace)) return [unreadLine(line, timestamp)];
			return toolCall(id, timestamp, { id: callId, name: namespace ? `${namespace}.${name}` : name, arguments: args }, false);
		}
		case "function_call_output":
		case "custom_tool_call_output": {
			const callId = nonEmptyStr(item.call_id);
			if (!callId) return [unreadLine(line, timestamp)];
			const decoded = outputOf(item.output);
			const entries: unknown[] = [message(id, timestamp, "toolResult", decoded.content, { toolCallId: callId, isError: decoded.isError })];
			if (decoded.unread) entries.push(unreadLine(line, timestamp));
			return entries;
		}
		case "web_search_call":
			return isObject(item.action) && !Array.isArray(item.action)
				? toolCall(id, timestamp, { id, name: "web_search", arguments: item.action }, item.status === "completed")
				: [unreadLine(line, timestamp)];
		case "tool_search_call": {
			const callId = item.call_id === undefined ? id : nonEmptyStr(item.call_id);
			const args = argumentsOf(item.arguments);
			return callId && args ? toolCall(id, timestamp, { id: callId, name: "tool_search", arguments: args }, item.status === "completed") : [unreadLine(line, timestamp)];
		}
		case "tool_search_output": {
			const callId = nonEmptyStr(item.call_id);
			if (!callId) return [unreadLine(line, timestamp)];
			const decoded = Array.isArray(item.tools)
				? { content: [{ type: "text", text: JSON.stringify(item.tools) }], unread: item.tools.some(tool => !isObject(tool) || Array.isArray(tool)), isError: false }
				: outputOf(item.output);
			const entries: unknown[] = [message(id, timestamp, "toolResult", decoded.content, { toolCallId: callId, isError: decoded.isError || item.status === "failed" })];
			if (decoded.unread) entries.push(unreadLine(line, timestamp));
			return entries;
		}
		case "compaction":
			return [{ type: "compaction", id, timestamp }];
		default:
			return [unreadLine(line, timestamp)];
	}
}

function decodeRecord(record: unknown, line: string): unknown[] {
	if (!isObject(record)) return [unreadLine(line, undefined)];
	const type = str(record.type) ?? "";
	if (Object.hasOwn(SKIPPED, type)) return [];
	const id = lineId("codex", line);
	if (type === "compacted") return [{ type: "compaction", id, timestamp: record.timestamp }];
	if (type !== "response_item" || !isObject(record.payload)) return [unreadLine(line, record.timestamp)];
	return decodeItem(record.payload, id, record.timestamp, line);
}

/** One line of a Codex session file as omp entries. */
export const decodeCodexLine = (line: string): unknown[] => decodeRecord(parseJson(line), line);

function summarize({ head, tail }: FileEdges, path: string): SessionSummary | null {
	const first = parseJson(head[0] ?? "");
	const meta = isObject(first) && first.type === "session_meta" && isObject(first.payload) ? first.payload : {};
	if (isObject(meta.source) && "subagent" in meta.source) return null;
	let prompt: string | null = null;
	let answered = false;
	for (const line of [...head, ...tail]) {
		for (const entry of decodeCodexLine(line)) {
			if (!isObject(entry) || !isObject(entry.message)) continue;
			if (entry.message.role === "assistant") answered = true;
			if (entry.message.role === "user") prompt ??= textOf(entry.message.content);
		}
	}
	const title = prompt ? oneLine(prompt) : "";
	return {
		id: nonEmptyStr(meta.id) ?? path.match(UUID)?.[1] ?? basename(path, ".jsonl"),
		cwd: str(meta.cwd) ?? "",
		title: title || null,
		empty: prompt === null && !answered,
	};
}

async function readTitles(indexPath: string): Promise<Map<string, string>> {
	const titles = new Map<string, string>();
	const text = await Bun.file(indexPath)
		.text()
		.catch(() => "");
	for (const line of text.split("\n")) {
		const record = parseJson(line);
		if (!isObject(record)) continue;
		const id = nonEmptyStr(record.id);
		const title = nonEmptyStr(record.thread_name);
		if (id && title) titles.set(id, oneLine(title));
	}
	return titles;
}

const USAGE_LINE = /"type"\s*:\s*"(?:session_meta|turn_context|token_count|token_usage_record|thread_settings_applied)"/;

/** The requests in a rollout, pairing response-id usage with its following token summary and counting event-only requests by growing totals. */
export class CodexUsage implements UsageFold {
	readonly path: string;
	sessionId: string;
	subagent = false;
	cwd = "";
	readonly requests: ForeignRequest[] = [];
	readonly #price: Pricer;
	#meta = false;
	#model = "";
	#total = 0;
	readonly #responses = new Set<string>();
	#pending: Json | null = null;

	constructor(path: string, price: Pricer) {
		this.path = path;
		this.sessionId = path.match(UUID)?.[1] ?? basename(path, ".jsonl");
		this.#price = price;
	}

	applyLine(line: string): void {
		if (!USAGE_LINE.test(line)) return;
		const record = parseJson(line);
		if (!isObject(record) || !isObject(record.payload)) return;
		const { payload } = record;
		switch (record.type) {
			case "session_meta":
				this.#applyMeta(payload);
				return;
			case "turn_context":
				this.#model = nonEmptyStr(payload.model) ?? this.#model;
				return;
			case "token_usage_record":
				this.#countResponse(payload, Date.parse(str(record.timestamp) ?? ""));
				return;
			case "event_msg":
				if (payload.type === "thread_settings_applied" && isObject(payload.thread_settings)) this.#model = nonEmptyStr(payload.thread_settings.model) ?? this.#model;
				if (payload.type === "token_count" && isObject(payload.info)) this.#count(payload.info, Date.parse(str(record.timestamp) ?? ""));
		}
	}

	#applyMeta(meta: Json): void {
		if (this.#meta) return;
		this.#meta = true;
		this.cwd = str(meta.cwd) ?? "";
		const id = nonEmptyStr(meta.id) ?? this.sessionId;
		const source = isObject(meta.source) ? meta.source : {};
		if (!("subagent" in source)) {
			this.sessionId = id;
			return;
		}
		const spawn = isObject(source.subagent) && isObject(source.subagent.thread_spawn) ? source.subagent.thread_spawn : {};
		this.subagent = true;
		this.sessionId = nonEmptyStr(spawn.parent_thread_id) ?? nonEmptyStr(meta.parent_thread_id) ?? id;
	}

	#countResponse(payload: Json, timestamp: number): void {
		const responseId = nonEmptyStr(payload.response_id);
		const usage = payload.usage;
		if (!responseId || this.#responses.has(responseId) || !isObject(usage) || Number.isNaN(timestamp)) return;
		this.#responses.add(responseId);
		this.#pending = usage;
		this.#addRequest(usage, timestamp);
	}

	#count(info: Json, timestamp: number): void {
		const total = isObject(info.total_token_usage) ? num(info.total_token_usage.total_tokens) : undefined;
		const last = info.last_token_usage;
		if (total === undefined || !isObject(last) || Number.isNaN(timestamp)) return;
		const pending = this.#pending;
		this.#pending = null;
		if (total <= this.#total) return;
		this.#total = total;
		if (pending && ["input_tokens", "cached_input_tokens", "output_tokens", "total_tokens"].every(key => num(pending[key]) === num(last[key]))) return;
		this.#addRequest(last, timestamp);
	}

	/** Cached and cache-written input are included in `input_tokens`; reasoning is included in output. */
	#addRequest(usage: Json, timestamp: number): void {
		const cacheRead = num(usage.cached_input_tokens) ?? 0;
		const cacheWrite = num(usage.cache_write_input_tokens) ?? 0;
		const tokens: RequestTokens = { input: (num(usage.input_tokens) ?? 0) - cacheRead - cacheWrite, output: num(usage.output_tokens) ?? 0, cacheRead, cacheWrite };
		this.requests.push({ provider: "openai", model: this.#model, timestamp, failed: false, ...tokens, cost: this.#price("openai", this.#model, tokens, timestamp) });
	}
}

/** Codex's sessions under `root`, its `sessions` directory, titled from the index beside it. */
export function codexFormat(root: string = join(codexHome(), "sessions")): SessionFormat {
	const files = new ForeignFiles(root, "*/*/*/rollout-*.jsonl", "codex", summarize);
	const indexPath = join(dirname(root), "session_index.jsonl");
	return {
		source: "codex",
		root,
		createRoot: false,
		fileOf: path => codexFileOf(path, root),
		list: async () => {
			const titles = await readTitles(indexPath);
			return files.list(id => titles.get(id));
		},
		read: async path => {
			const titles = await readTitles(indexPath);
			return files.read(path, id => titles.get(id));
		},
		decode: decodeCodexLine,
		messageLine: /"type":"message"/,
		usage: { patterns: ["*/*/*/rollout-*.jsonl"], fold: (path, price) => new CodexUsage(path, price) },
	};
}
