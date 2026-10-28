/**
 * The Analytics tab's context sources: which instruction files, skills, MCP servers, injected messages, and conversation
 * parts fill each request's input, counted per request from the session file and folded into a report.
 */
import { isObject, num, str } from "./json";
import { type SessionSummary, sessionOfFile } from "./analytics";
import { CONTEXT_SOURCE_KINDS, type AnalyticsRange, type ContextReport, type ContextSource, type ContextSourceKind } from "./shared/analytics";

/** How many sessions the session filter offers. */
const FILTER_SESSIONS = 20;

/** A source as one string, `<kind>:<name>`, which the index stores. */
export const sourceId = (kind: ContextSourceKind, name: string): string => `${kind}:${name}`;

/** The kind and name `id` joins, or `null` for an id this version does not know. */
export function parseSourceId(id: string): { kind: ContextSourceKind; name: string } | null {
	const colon = id.indexOf(":");
	const kind = CONTEXT_SOURCE_KINDS.find(known => known === id.slice(0, colon));
	return colon > 0 && kind ? { kind, name: id.slice(colon + 1) } : null;
}

const SECTION = /^§ (.+)$/;
const HEADING = /^(#{1,3}) (.+)$/;
const FILE_OPEN = /^\s*<file path="([^"]+)">/;
const LIST_ITEM = /^- ([^\s:(]+)/;
const MCP_DEVICE = /xd:\/\/mcp__([\w-]+)/;
/** A tool route line, `- "<tool>" → \`xd://mcp__<server>_<tool>\``, which names its server exactly. */
const MCP_ROUTE = /"([^"]+)" → `?xd:\/\/mcp__([\w-]+)/;
const MCP_INSTRUCTIONS = "MCP Server Instructions";

/** The MCP servers the prompt names: those with instructions and those a tool route spells out, longest first. */
function mcpServers(lines: readonly string[]): string[] {
	const servers = new Set<string>();
	let instructions = false;
	for (const line of lines) {
		const heading = HEADING.exec(line);
		if (heading) {
			if (heading[1] === "###" && instructions) servers.add(heading[2]!.trim());
			else instructions = heading[2]!.trim() === MCP_INSTRUCTIONS;
			continue;
		}
		const route = MCP_ROUTE.exec(line);
		if (route && route[2]!.endsWith(`_${route[1]}`)) servers.add(route[2]!.slice(0, -route[1]!.length - 1));
	}
	return [...servers].sort((a, b) => b.length - a.length);
}

/**
 * The system prompt's text by source: each `<file path>` block, each skill and rule the lists name, each MCP server's tool
 * routes, devices, and instructions, and the rest under its `§` section, or its `##` heading in a block without one.
 */
export function splitSystemPrompt(blocks: readonly string[]): Map<string, string> {
	const lines = blocks.flatMap(block => block.split("\n"));
	const servers = mcpServers(lines);
	const parts = new Map<string, string[]>();
	const add = (id: string, line: string) => {
		const part = parts.get(id);
		if (part) part.push(line);
		else parts.set(id, [line]);
	};
	for (const block of blocks) {
		let section = "Preamble";
		let sectioned = false;
		let file: string | null = null;
		let list: "skill" | "rule" | null = null;
		let instructions = false;
		let server: string | null = null;
		for (const line of block.split("\n")) {
			if (file !== null) {
				add(file, line);
				if (line.trim() === "</file>") file = null;
				continue;
			}
			const opened = FILE_OPEN.exec(line);
			if (opened) {
				file = sourceId("file", opened[1]!);
				add(file, line);
				if (line.trimEnd().endsWith("</file>")) file = null;
				continue;
			}
			const top = SECTION.exec(line);
			const heading = HEADING.exec(line);
			if (top || heading) {
				list = null;
				server = null;
				const title = (top?.[1] ?? heading![2]!).trim();
				if (heading?.[1] === "###" && instructions) {
					server = title;
					add(sourceId("mcp", server), line);
					continue;
				}
				instructions = !top && title === MCP_INSTRUCTIONS;
				if (top) {
					section = title;
					sectioned = true;
				} else if (!sectioned && heading![1] === "##") {
					section = title;
				}
			} else if (line.startsWith("<project-context>") && !sectioned) {
				section = "Project context";
			} else if (line === "<skills>" || line === "<domain-rules>") {
				list = line === "<skills>" ? "skill" : "rule";
			} else if (line === "</skills>" || line === "</domain-rules>") {
				list = null;
			} else if (server !== null) {
				add(sourceId("mcp", server), line);
				continue;
			} else {
				const item = list && LIST_ITEM.exec(line);
				if (list && item) {
					add(sourceId(list, item[1]!), line);
					continue;
				}
				const device = MCP_DEVICE.exec(line);
				if (device) {
					const name = device[1]!;
					add(sourceId("mcp", servers.find(known => name.startsWith(`${known}_`)) ?? name.split("_")[0]!), line);
					continue;
				}
			}
			add(sourceId("prompt", section), line);
		}
	}
	return new Map([...parts].map(([id, part]) => [id, part.join("\n")]));
}

/** How the conversation's own messages read in the report, by omp's message role. */
const CONVERSATION: Record<string, string> = {
	user: "User prompts",
	assistant: "Assistant replies",
	compactionSummary: "Compaction summaries",
	branchSummary: "Branch summaries",
	fileMention: "File mentions",
	bashExecution: "Shell commands from the prompt",
	pythonExecution: "Eval commands from the prompt",
	hookMessage: "Hook messages",
};

/** A rule reminder omp injects when a tool call breaks a rule: `<system-reminder reason="rule_violation" rule="<name>"`. */
const RULE_REMINDER = /<system-reminder reason="rule_violation" rule="([^"]+)"/;

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map(block => (isObject(block) ? (str(block.text) ?? "") : "")).join("");
}

/** The source of one message of a request's context, as omp's session context builds it. */
export function sourceOfMessage(message: unknown): string {
	if (!isObject(message)) return sourceId("conversation", "Other");
	const role = str(message.role) ?? "unknown";
	if (role === "toolResult") return sourceId("tool", str(message.toolName) ?? "unknown");
	if (role === "developer") {
		const rule = RULE_REMINDER.exec(textOf(message.content));
		return rule ? sourceId("rule", rule[1]!) : sourceId("injection", "System reminders");
	}
	if (role === "custom") {
		const type = str(message.customType) ?? "custom";
		const skill = type === "skill-prompt" && isObject(message.details) ? str(message.details.name) : undefined;
		return skill ? sourceId("skill", skill) : sourceId("injection", type);
	}
	return sourceId("conversation", CONVERSATION[role] ?? role);
}

/** What a request to one model counts: a message as omp's tokenizer for that model counts it, and plain text. */
export interface TokenCounter {
	message(message: unknown): number;
	text(text: string): number;
}

/** One session file read for attribution, the parsed entries in file order. */
export interface SessionReading {
	entries: readonly unknown[];
	/** The messages of the request whose newest entry is `leafId`, as omp builds them for the model. */
	context(leafId: string): readonly unknown[];
	counter(model: { provider: string; model: string; api: string }): TokenCounter;
}

/** One request's input: its time, input tokens with cache reads and writes, their cost, and its tokens by source id. */
export interface Turn {
	entryId: string;
	at: number;
	input: number;
	cost: number;
	tokens: Map<string, number>;
}

const count = (value: unknown): number => {
	const n = num(value);
	return n !== undefined && n > 0 ? n : 0;
};

function inputOf(usage: unknown): { input: number; cost: number } {
	if (!isObject(usage)) return { input: 0, cost: 0 };
	const cost = isObject(usage.cost) ? count(usage.cost.input) + count(usage.cost.cacheRead) + count(usage.cost.cacheWrite) : 0;
	return { input: count(usage.input) + count(usage.cacheRead) + count(usage.cacheWrite), cost };
}

function timeOf(entry: Record<string, unknown>, message?: Record<string, unknown>): number {
	const at = count(message?.timestamp);
	return at > 0 ? at : (Date.parse(str(entry.timestamp) ?? "") || 0);
}

/**
 * Each request of a session file, its input split by source. A conversation request counts the system prompt's sections
 * when the file records them (a subagent's `session_init`) and every message of its context; the part of its billed
 * input left over is what no transcript records, the tool definitions and, without `session_init`, the system prompt.
 * Counts above the billed input scale down to it, so a request's sources always add up to its input.
 * A side request (`model_usage`, such as a cache warm) records no context, so its input is one source.
 * A fork (a header naming `parentSession`) copies its parent's entries; omp-stats counts those for the parent, so they are skipped here.
 */
export function attributeTurns(reading: SessionReading): Turn[] {
	const header = reading.entries.find(entry => isObject(entry) && entry.type === "session");
	const forkedAt = isObject(header) && str(header.parentSession) ? Date.parse(str(header.timestamp) ?? "") || 0 : 0;
	const init = reading.entries.find(entry => isObject(entry) && entry.type === "session_init");
	const blocks = isObject(init) && Array.isArray(init.systemPrompt) ? init.systemPrompt.filter(block => typeof block === "string") : null;
	const sections = blocks ? splitSystemPrompt(blocks) : null;
	const unrecorded = sourceId("unrecorded", sections ? "Tool definitions" : "System prompt and tool definitions");
	const sectionTokens = new Map<TokenCounter, [string, number][]>();
	const turns: Turn[] = [];
	for (const entry of reading.entries) {
		if (!isObject(entry) || typeof entry.id !== "string" || entry.id === "") continue;
		if (entry.type === "model_usage") {
			const { input, cost } = inputOf(entry.usage);
			const at = timeOf(entry);
			if (input > 0 && at >= forkedAt) turns.push({ entryId: entry.id, at, input, cost, tokens: new Map([[sourceId("side", str(entry.purpose) ?? "unknown"), input]]) });
			continue;
		}
		const message = entry.type === "message" && isObject(entry.message) ? entry.message : null;
		if (message?.role !== "assistant") continue;
		const { input, cost } = inputOf(message.usage);
		const at = timeOf(entry, message);
		if (input === 0 || at < forkedAt) continue;
		const counter = reading.counter({ provider: str(message.provider) ?? "", model: str(message.model) ?? "", api: str(message.api) ?? "" });
		const tokens = new Map<string, number>();
		const put = (id: string, n: number) => n > 0 && tokens.set(id, (tokens.get(id) ?? 0) + n);
		if (sections) {
			let counted = sectionTokens.get(counter);
			if (!counted) {
				counted = [...sections].map(([id, text]) => [id, counter.text(text)]);
				sectionTokens.set(counter, counted);
			}
			for (const [id, n] of counted) put(id, n);
		}
		const leaf = str(entry.parentId);
		for (const part of leaf ? reading.context(leaf) : []) put(sourceOfMessage(part), counter.message(part));
		let measured = 0;
		for (const n of tokens.values()) measured += n;
		if (measured > input) for (const [id, n] of tokens) tokens.set(id, (n * input) / measured);
		else put(unrecorded, input - measured);
		turns.push({ entryId: entry.id, at, input, cost, tokens });
	}
	return turns;
}

/** One source over one session file's requests in the range: how many held it, its tokens, and its cost. */
export interface ContextSourceRow {
	sessionFile: string;
	source: string;
	turns: number;
	tokens: number;
	cost: number;
}

/** One session file's requests in the range: the working directory its header names, their count, input tokens, and input cost. */
export interface ContextFileRow {
	sessionFile: string;
	cwd: string;
	turns: number;
	input: number;
	cost: number;
}

export interface ContextReportInput {
	range: AnalyticsRange;
	cwd: string | null;
	sessionId: string | null;
	indexing: ContextReport["indexing"];
	files: readonly ContextFileRow[];
	sources: readonly ContextSourceRow[];
	/** The sessions directory, which places each file under its session. */
	root: string;
	factsOf: (sessionId: string) => SessionSummary | null;
}

/**
 * The report over the range's rows: subagents fold into their session, a session takes its listed working directory,
 * else its own file's, and `cwd` and `sessionId` narrow the requests the sources sum.
 */
export function buildContextReport({ range, cwd, sessionId, indexing, files, sources, root, factsOf }: ContextReportInput): ContextReport {
	interface Session {
		cwd: string;
		/** Whether `cwd` came from the session's own file rather than a subagent's, whose checkout may be another. */
		own: boolean;
		input: number;
	}
	const sessions = new Map<string, Session>();
	const sessionOf = new Map<string, string>();
	for (const row of files) {
		const place = sessionOfFile(row.sessionFile, root);
		sessionOf.set(row.sessionFile, place.sessionId);
		const session = sessions.get(place.sessionId);
		if (!session) sessions.set(place.sessionId, { cwd: factsOf(place.sessionId)?.workspace ?? row.cwd, own: !place.subagent, input: row.input });
		else {
			session.input += row.input;
			if (!session.own && !place.subagent && !factsOf(place.sessionId)) Object.assign(session, { cwd: row.cwd, own: true });
		}
	}
	const workspaces = new Map<string, number>();
	for (const { cwd: dir, input } of sessions.values()) workspaces.set(dir, (workspaces.get(dir) ?? 0) + input);
	const chosen = (file: string): boolean => {
		const id = sessionOf.get(file);
		if (id === undefined) return false;
		return (sessionId === null || id === sessionId) && (cwd === null || sessions.get(id)!.cwd === cwd);
	};
	let turns = 0;
	let input = 0;
	let cost = 0;
	for (const row of files) {
		if (!chosen(row.sessionFile)) continue;
		turns += row.turns;
		input += row.input;
		cost += row.cost;
	}
	const bySource = new Map<string, ContextSource>();
	for (const row of sources) {
		if (!chosen(row.sessionFile)) continue;
		const known = bySource.get(row.source);
		if (known) {
			known.turns += row.turns;
			known.tokens += row.tokens;
			known.cost += row.cost;
			continue;
		}
		const parsed = parseSourceId(row.source);
		if (parsed) bySource.set(row.source, { ...parsed, turns: row.turns, tokens: row.tokens, cost: row.cost });
	}
	return {
		range,
		cwd,
		sessionId,
		indexing,
		turns,
		input,
		cost,
		sources: [...bySource.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)),
		workspaces: [...workspaces].map(([dir, tokens]) => ({ cwd: dir, input: tokens })).sort((a, b) => b.input - a.input),
		sessions: [...sessions]
			.filter(([, session]) => cwd === null || session.cwd === cwd)
			.sort((a, b) => b[1].input - a[1].input)
			.slice(0, FILTER_SESSIONS)
			.map(([id, session]) => ({ sessionId: id, title: factsOf(id)?.title ?? null, input: session.input })),
	};
}
