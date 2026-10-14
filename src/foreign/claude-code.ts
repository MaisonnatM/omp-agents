/**
 * Claude Code's session files, read-only: `<root>/<project slug>/<session id>.jsonl`, each line one record. `decode`
 * turns a record into the omp entries the transcript folds already read.
 */
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { isObject, nonEmptyStr, parseJson, str } from "../json";
import type { SessionFormat } from "../session-formats";
import { lineId, oneLine, textOf, unreadLine } from "../session-entries";
import { type FileEdges, ForeignFiles, type SessionSummary } from "./files";

type Json = Record<string, unknown>;

/** Claude Code's projects directory, under `CLAUDE_CONFIG_DIR` when set. */
export const claudeCodeRoot = (): string => join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

/** Records that hold nothing a transcript shows: titles, modes, queue and cost bookkeeping, attachments. */
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

/** A message's content blocks in omp's vocabulary; blocks a transcript does not show, such as an empty thinking block, are left out. */
function blocksOf(content: unknown): Json[] {
	if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block): Json[] => {
		if (!isObject(block)) return [];
		switch (block.type) {
			case "text":
				return typeof block.text === "string" && block.text ? [{ type: "text", text: block.text }] : [];
			case "thinking":
				return typeof block.thinking === "string" && block.thinking ? [{ type: "thinking", thinking: block.thinking }] : [];
			case "tool_use":
				return [{ type: "toolCall", id: str(block.id), name: str(block.name), arguments: isObject(block.input) ? block.input : {} }];
			case "image": {
				const source = isObject(block.source) ? block.source : {};
				return source.type === "base64" && typeof source.data === "string" ? [{ type: "image", data: source.data, mimeType: str(source.media_type) }] : [];
			}
			default:
				return [];
		}
	});
}

/** The entries of a `user` or `assistant` record with id `id`: a prompt, a reply, or the tool results a user record carries. */
function messageEntries(record: Json, message: Json, id: string): unknown[] {
	const { timestamp } = record;
	if (record.type === "assistant") {
		const content = blocksOf(message.content);
		return content.length > 0 ? [{ type: "message", id, timestamp, message: { role: "assistant", content } }] : [];
	}
	const blocks: unknown[] = Array.isArray(message.content) ? message.content : [];
	const results = blocks.flatMap((block, index) =>
		isObject(block) && block.type === "tool_result"
			? [{
					type: "message",
					id: `${id}:${index}`,
					timestamp,
					message: { role: "toolResult", toolCallId: str(block.tool_use_id), isError: block.is_error === true, content: blocksOf(block.content) },
				}]
			: [],
	);
	const content = blocksOf(Array.isArray(message.content) ? blocks.filter(block => !isObject(block) || block.type !== "tool_result") : message.content);
	return content.length > 0 ? [...results, { type: "message", id, timestamp, message: { role: "user", content } }] : results;
}

function decodeRecord(record: unknown, line: string): unknown[] {
	if (!isObject(record)) return [unreadLine(line, undefined)];
	const type = str(record.type) ?? "";
	if (SKIPPED[type]) return [];
	const id = str(record.uuid) ?? lineId("claude", line);
	if (type === "system") return record.subtype === "compact_boundary" ? [{ type: "compaction", id, timestamp: record.timestamp }] : [];
	if (type !== "user" && type !== "assistant") return [unreadLine(line, record.timestamp)];
	// Meta records are context Claude Code injected; sidechains are subagents' turns.
	if (record.isMeta === true || record.isSidechain === true) return [];
	const { message } = record;
	if (!isObject(message) || (typeof message.content !== "string" && !Array.isArray(message.content))) return [unreadLine(line, record.timestamp)];
	return messageEntries(record, message, id);
}

/** One line of a Claude Code session file as omp entries. */
export const decodeClaudeCodeLine = (line: string): unknown[] => decodeRecord(parseJson(line), line);

/** A session's working directory, title, and whether it holds a turn, from its file's edges; its id is its file's name, which `claude --resume` takes. */
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
	};
}
