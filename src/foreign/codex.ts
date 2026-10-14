/**
 * Codex's session files, read-only: `<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`, each line one
 * record. `decode` turns a record into the omp entries the transcript folds already read. A renamed session's title
 * lives outside its file, in `<CODEX_HOME>/session_index.jsonl`.
 */
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { isObject, nonEmptyStr, parseJson, str } from "../json";
import type { SessionFormat } from "../session-formats";
import { lineId, oneLine, textOf, unreadLine } from "../session-entries";
import { type FileEdges, ForeignFiles, type SessionSummary } from "./files";

type Json = Record<string, unknown>;

/** Codex's home directory, `CODEX_HOME` when set. */
export const codexHome = (): string => process.env.CODEX_HOME ?? join(homedir(), ".codex");

/** Records that hold nothing a transcript shows; `event_msg` repeats what the response items hold. */
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

/** A message's text and image blocks in omp's vocabulary; a user's injected context blocks are left out. */
function blocksOf(content: unknown, role: "user" | "assistant"): Json[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((block): Json[] => {
		if (!isObject(block) || typeof block.text !== "string") {
			const url = isObject(block) && block.type === "input_image" ? str(block.image_url) : undefined;
			const image = url?.match(/^data:([^;]+);base64,(.+)$/s);
			return image ? [{ type: "image", mimeType: image[1], data: image[2] }] : [];
		}
		if (block.type !== (role === "user" ? "input_text" : "output_text")) return [];
		if (role === "user" && INJECTED.test(block.text.trimStart())) return [];
		return block.text ? [{ type: "text", text: block.text }] : [];
	});
}

/** A tool's output as a result's text blocks, and whether it failed. */
function outputOf(output: unknown): { content: Json[]; isError: boolean } {
	if (typeof output === "string") return { content: [{ type: "text", text: output }], isError: FAILED_EXIT.test(output.split("\nOutput:")[0]) };
	if (Array.isArray(output)) {
		return { content: output.flatMap(block => (isObject(block) && typeof block.text === "string" ? [{ type: "text", text: block.text }] : [])), isError: false };
	}
	if (isObject(output)) return { content: outputOf(output.content).content, isError: output.success === false };
	return { content: [], isError: false };
}

/** A function call's arguments, which Codex writes as a JSON string: an object as it is, anything else as the call's input. */
function argumentsOf(raw: unknown): Json {
	const parsed = typeof raw === "string" ? parseJson(raw) : raw;
	if (isObject(parsed)) return Array.isArray(parsed.command) ? { ...parsed, command: parsed.command.at(-1) } : parsed;
	return typeof raw === "string" && raw ? { input: raw } : {};
}

const message = (id: string, timestamp: unknown, role: string, content: Json[], extra: Json = {}): Json => ({
	type: "message",
	id,
	timestamp,
	message: { role, content, ...extra },
});

/** A tool call, settled at once with an empty result when `settled`, for the searches Codex records as one item. */
const toolCall = (id: string, timestamp: unknown, call: Json, settled: boolean): Json[] => [
	message(id, timestamp, "assistant", [{ type: "toolCall", ...call }]),
	...(settled ? [message(`${id}:result`, timestamp, "toolResult", [], { toolCallId: call.id, isError: false })] : []),
];

function decodeItem(item: Json, id: string, timestamp: unknown, line: string): unknown[] {
	const type = str(item.type) ?? "";
	if (SKIPPED_ITEMS[type]) return [];
	switch (type) {
		case "message": {
			if (item.role !== "user" && item.role !== "assistant") return item.role === "developer" || item.role === "system" ? [] : [unreadLine(line, timestamp)];
			const content = blocksOf(item.content, item.role);
			return content.length > 0 ? [message(id, timestamp, item.role, content)] : [];
		}
		case "reasoning": {
			const summary = Array.isArray(item.summary) ? item.summary : [];
			const thinking = summary.flatMap(part => (isObject(part) && typeof part.text === "string" && part.text ? [part.text] : [])).join("\n\n");
			return thinking ? [message(id, timestamp, "assistant", [{ type: "thinking", thinking }])] : [];
		}
		case "function_call":
			return toolCall(id, timestamp, { id: str(item.call_id), name: str(item.name), arguments: argumentsOf(item.arguments) }, false);
		case "custom_tool_call":
			return toolCall(id, timestamp, { id: str(item.call_id), name: str(item.name), arguments: { input: str(item.input) ?? "" } }, false);
		case "function_call_output":
		case "custom_tool_call_output": {
			const { content, isError } = outputOf(item.output);
			return [message(id, timestamp, "toolResult", content, { toolCallId: str(item.call_id), isError })];
		}
		case "web_search_call":
			return toolCall(id, timestamp, { id, name: "web_search", arguments: isObject(item.action) ? item.action : {} }, item.status === "completed");
		case "tool_search_call":
			return toolCall(id, timestamp, { id: str(item.call_id) ?? id, name: "tool_search", arguments: argumentsOf(item.arguments) }, item.status === "completed");
		case "tool_search_output":
			return [message(id, timestamp, "toolResult", [], { toolCallId: str(item.call_id), isError: item.status === "failed" })];
		case "compaction":
			return [{ type: "compaction", id, timestamp }];
		default:
			return [unreadLine(line, timestamp)];
	}
}

function decodeRecord(record: unknown, line: string): unknown[] {
	if (!isObject(record)) return [unreadLine(line, undefined)];
	const type = str(record.type) ?? "";
	if (SKIPPED[type]) return [];
	const id = lineId("codex", line);
	if (type === "compacted") return [{ type: "compaction", id, timestamp: record.timestamp }];
	if (type !== "response_item" || !isObject(record.payload)) return [unreadLine(line, record.timestamp)];
	return decodeItem(record.payload, id, record.timestamp, line);
}

/** One line of a Codex session file as omp entries. */
export const decodeCodexLine = (line: string): unknown[] => decodeRecord(parseJson(line), line);

/** A session's id, working directory, first prompt, and whether it holds a turn, from its file's edges; `null` for a subagent's file, which its parent's transcript covers. */
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

/** The titles sessions were renamed to, by id; the newest line for an id wins. */
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
	};
}
