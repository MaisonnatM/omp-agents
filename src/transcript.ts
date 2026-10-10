/**
 * Folds a session file's entries, plus live agent events, into display items.
 *
 * The session file is the record: every message it holds renders from it. Live
 * events only fill the gap before a message reaches the file, streaming the
 * assistant's partial text and the running state of tool calls. Both sources key
 * a message by its `timestamp`, which omp writes to the file unchanged, so the
 * file's copy replaces the streamed one in place and a late event cannot undo it.
 */
import { isObject, str } from "./json";
import { imagesOf, oneLine, textOf, toolSummary } from "./session-entries";
import { splitFiles } from "./shared/prompt-files";
import type { Item } from "./shared/transcript";

type Json = Record<string, unknown>;
type ToolItem = Extract<Item, { kind: "tool" }>;

const COLLAB_PROMPT = "collab-prompt";
/** How omp's terminal and RPC clients record a `/skill:<name>` prompt: the skill's text, with the invocation in `details`. */
export const SKILL_PROMPT = "skill-prompt";
/**
 * omp's `prompts/skills/user-invocation.md` as rendered: the skill's name, its body, its directory, then what the user
 * typed around the `/skill:` token. Collab and subagent prompts carry only this text, since the dashboard expands
 * skills before sending them.
 */
const SKILL_INVOCATION =
	/^\[IMPORTANT: User invoked the "([^"]+)" skill; follow its instructions\. Full skill below\.\]\n[\s\S]*\n\[Skill directory: [^\n]*\]\n[^\n]*(?:\nUser: ([\s\S]*))?$/;

/** The key a message shares between its live events and its file entry. */
const messageKey = (message: Json): string | undefined =>
	typeof message.timestamp === "number" ? `m${message.timestamp}` : undefined;

/** Plain user messages and `/skill:` prompts the user typed; a subagent's skill is hidden context instead. */
export const isUserPrompt = (value: Json): boolean =>
	value.role === "user" || (value.customType === SKILL_PROMPT && value.attribution === "user");

/**
 * A prompt as the user typed it: an expanded skill reads as the skill's name and the user's words, not the skill's
 * text, and attached files as their names, not their text.
 */
function userPrompt(prompt: string): { text: string; skill: string | null; files?: string[] } {
	const match = SKILL_INVOCATION.exec(prompt);
	return { ...typed(match ? (match[2]?.trim() ?? "") : prompt), skill: match ? match[1] : null };
}

/** `prompt` without the files the composer attached after it, which `files` names when there are any. */
function typed(prompt: string): { text: string; files?: string[] } {
	const { text, files } = splitFiles(prompt);
	return files.length > 0 ? { text, files } : { text };
}

/** A `!` command the user ran, as omp's terminal shows it: the command and its output, then how it ended when it failed. */
function shellRun(message: Json): string {
	const run = [`$ ${str(message.command) ?? ""}`, (str(message.output) ?? "").replace(/\n+$/, "")].filter(Boolean).join("\n");
	const fence = "`".repeat(Math.max(3, ...[...run.matchAll(/`+/g)].map(match => match[0].length + 1)));
	const exitCode = message.exitCode;
	const ended = message.cancelled === true ? "Cancelled." : typeof exitCode === "number" && exitCode !== 0 ? `Exit code ${exitCode}.` : null;
	return [`${fence}sh\n${run}\n${fence}`, ended].filter(Boolean).join("\n\n");
}

/**
 * The subagents a `task` result names: `progress` while they run (async spawns report only it), `results` once they
 * finished. These ids, not the call's task names, open their views: omp suffixes a name that repeats (`Name2`).
 */
function spawnedAgents(toolName: unknown, result: unknown): string[] {
	if (toolName !== "task" || !isObject(result) || !isObject(result.details)) return [];
	const rows = [result.details.progress, result.details.results].flatMap(list => (Array.isArray(list) ? list : []));
	return [...new Set(rows.flatMap(row => (isObject(row) && typeof row.id === "string" && row.id ? [row.id] : [])))];
}

/** `next` merged after `prev`, without repeats; `prev` itself when `next` adds nothing. */
function union(prev: string[], next: string[]): string[] {
	const added = next.filter(id => !prev.includes(id));
	return added.length === 0 ? prev : [...prev, ...added];
}

/** Whether two field values are equal: primitives by value, string lists (a tool's `agents`, a reply's `suggestions`) item by item. */
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Whether two items show the same thing, field by field. */
function sameItem(a: Item, b: Item): boolean {
	const x: Json = a;
	const y: Json = b;
	const keys = Object.keys(x);
	return keys.length === Object.keys(y).length && keys.every(key => sameValue(x[key], y[key]));
}

/** The numbered list the reply ends on after a `Suggestions:` heading, or none. */
const SUGGESTIONS_HEADING = /^\s*Suggestions:\s*$/;
const SUGGESTION_LINE = /^\s*\d+\.\s+(.+?)\s*$/;

/** Whether a reply ends on a numbered `Suggestions:` block and, if so, the lines the body keeps and the prompts it offers. */
export function splitSuggestions(text: string): { body: string; suggestions: string[] } {
	const suggestions: string[] = [];
	for (let end = text.length; end > 0; ) {
		const start = text.lastIndexOf("\n", end - 1) + 1;
		const line = text.slice(start, end);
		end = start - 1;
		if (line.trim() === "") continue;
		const match = SUGGESTION_LINE.exec(line);
		if (match) suggestions.unshift(match[1]);
		else if (suggestions.length > 0 && SUGGESTIONS_HEADING.test(line)) return { body: text.slice(0, start).trimEnd(), suggestions };
		else break;
	}
	return { body: text, suggestions: [] };
}

/** A prompt or a reply as the transcript shows it. */
export type MessageItem = Extract<Item, { kind: "user" | "assistant" }>;

/**
 * The prompts and replies one session-file entry holds, as a fold of the whole file shows them. Their ids and text
 * come from the entry alone (its message's timestamp, else its own id), so one entry folded by itself names them the
 * same, without the thinking, tool calls, and order a whole fold keeps.
 */
export function messageItemsOf(entry: unknown): MessageItem[] {
	return new Transcript().applyEntry(entry).filter((item): item is MessageItem => item.kind === "user" || item.kind === "assistant");
}

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
	/** The latest time a file message got. The file holds messages in the order the agent took them. */
	#fileLatest = 0;
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
		// omp writes a `/skill:` prompt's entry with the timestamp of the message its live events carried.
		const skillPrompt = entry.type === "custom_message" && isUserPrompt(entry) && !Number.isNaN(written);
		this.#now = typeof sent === "number" ? sent : Number.isNaN(written) ? this.#latest : written;
		// omp stamps a queued steer or follow-up when it was sent, but the agent takes it later, after what the file holds before it.
		if ((entry.type === "message" && typeof sent === "number") || skillPrompt) {
			this.#now = Math.max(this.#now, this.#fileLatest);
			this.#fileLatest = this.#now;
		}
		switch (entry.type) {
			case "message": {
				if (!isObject(entry.message)) return [];
				const key = messageKey(entry.message) ?? id;
				this.#settled.add(key);
				return this.#applyMessage(key, entry.message, false, str(entry.id) ?? null);
			}
			case "custom_message": {
				if (!skillPrompt) return this.#applyMessage(id, { ...entry, role: "custom" }, false, null);
				const key = `m${written}`;
				this.#settled.add(key);
				return this.#applyMessage(key, { ...entry, role: "custom" }, false, null);
			}
			case "compaction":
				return this.#upsert({ id, kind: "notice", level: "info", text: "Earlier context was compacted." });
			default:
				return [];
		}
	}

	/** Live agent event. Returns the items it created or changed. */
	applyEvent(event: unknown): Item[] {
		if (!isObject(event)) return [];
		const message = isObject(event.assistantMessageEvent) && isObject(event.assistantMessageEvent.partial)
			? event.assistantMessageEvent.partial
			: event.message;
		this.#now = isObject(message) && typeof message.timestamp === "number" ? message.timestamp : Date.now();
		// A prompt starts when the agent takes it, so a queued one goes after everything already shown.
		if (isObject(message) && isUserPrompt(message)) this.#now = Math.max(this.#now, this.#latest);
		switch (event.type) {
			case "message_start":
			case "message_update":
				return this.#applyLive(message, true);
			case "message_end":
				return this.#applyLive(message, false);
			case "tool_execution_start":
				return this.#upsertLiveTool(str(event.toolCallId), str(event.toolName), toolSummary(event.args, event.intent), "running");
			case "tool_execution_update":
				// A running `task` reports its subagents as they spawn, long before its result reaches the file.
				return this.#upsertLiveTool(str(event.toolCallId), str(event.toolName), undefined, undefined, spawnedAgents(event.toolName, event.partialResult));
			case "tool_execution_end":
				return this.#upsertLiveTool(str(event.toolCallId), str(event.toolName), undefined, event.isError ? "error" : "ok", spawnedAgents(event.toolName, event.result));
			case "agent_end":
				// An interrupted turn ends without tool_execution_end for the call it cut off, or message_end for thinking still streaming.
				return [...this.#items.values()].flatMap(item => {
					if (item.kind === "tool" && item.status === "running") return this.#upsert({ ...item, status: "error" });
					if (item.kind === "thinking" && item.streaming) return this.#upsert({ ...item, streaming: false });
					return [];
				});
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
		if (!isObject(message) || (message.role !== "assistant" && !isUserPrompt(message))) return [];
		const key = messageKey(message);
		if (!key || this.#settled.has(key)) return [];
		return this.#applyMessage(key, message, streaming, null);
	}

	/** `entryId`: the file entry holding `message`, or `null` for a live event. */
	#applyMessage(key: string, message: Json, streaming: boolean, entryId: string | null): Item[] {
		switch (message.role) {
			case "user": {
				if (message.synthetic) return [];
				return this.#upsert({ id: key, kind: "user", ...userPrompt(textOf(message.content)), from: null, entryId, ...imagesOf(message.content) });
			}
			case "custom": {
				const details = isObject(message.details) ? message.details : {};
				if (message.customType === SKILL_PROMPT) {
					const skill = str(details.name);
					// Subagents get skills as hidden context the user never typed.
					if (message.attribution !== "user" || !skill) return [];
					return this.#upsert({ id: key, kind: "user", ...typed(str(details.args) ?? ""), skill, from: null, entryId: null });
				}
				if (message.customType !== COLLAB_PROMPT) return [];
				return this.#upsert({
					id: key,
					kind: "user",
					...userPrompt(textOf(message.content)),
					from: str(details.from) ?? null,
					entryId: null,
					...imagesOf(message.content),
				});
			}
			case "assistant":
				return this.#applyAssistant(key, message, streaming);
			case "toolResult": {
				const callId = str(message.toolCallId);
				if (callId) this.#settled.add(`tool:${callId}`);
				return this.#upsertTool(callId, str(message.toolName), undefined, message.isError ? "error" : "ok", spawnedAgents(message.toolName, message));
			}
			case "bashExecution":
				return this.#upsert({ id: key, kind: "user", text: shellRun(message), skill: null, from: null, entryId: null });
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
				const { body, suggestions } = splitSuggestions(block.text);
				changed.push(...this.#upsert({ id: `${key}:${index}`, kind: "assistant", text: body, streaming, suggestions }));
			} else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
				changed.push(...this.#upsert({ id: `${key}:${index}`, kind: "thinking", text: block.thinking, streaming }));
			} else if (block.type === "toolCall") {
				changed.push(...this.#upsertTool(str(block.id), str(block.name), toolSummary(block.arguments, block.intent), undefined, []));
			}
		});
		if (!streaming && (message.stopReason === "error" || message.stopReason === "aborted")) {
			const text = message.stopReason === "aborted" ? "Interrupted." : `Error: ${str(message.errorMessage) ?? "request failed"}`;
			changed.push(...this.#upsert({ id: `${key}:stop`, kind: "notice", level: message.stopReason === "aborted" ? "warning" : "error", text }));
		}
		return changed;
	}

	#upsertLiveTool(
		callId: string | undefined,
		name: string | undefined,
		summary: string | undefined,
		status: ToolItem["status"] | undefined,
		agents: string[] = [],
	): Item[] {
		if (!callId || this.#settled.has(`tool:${callId}`)) return [];
		return this.#upsertTool(callId, name, summary, status, agents);
	}

	/** Tool calls show up as content blocks, execution events, and result messages; merge them by call id. */
	#upsertTool(
		callId: string | undefined,
		name: string | undefined,
		summary: string | undefined,
		status: ToolItem["status"] | undefined,
		agents: string[],
	): Item[] {
		if (!callId) return [];
		const id = `tool:${callId}`;
		const prev = this.#items.get(id);
		const base: ToolItem = prev?.kind === "tool" ? prev : { id, kind: "tool", name: name ?? "tool", summary: "", status: "running", agents: [] };
		return this.#upsert({
			...base,
			name: name ?? base.name,
			summary: summary || base.summary,
			// A finished call stays finished when a later content-block replay reports no status.
			status: status ?? base.status,
			// Each report names the subagents it knows of; a workpool update names only the one that moved.
			agents: union(base.agents, agents),
		});
	}

	#upsert(item: Item): Item[] {
		const prev = this.#items.get(item.id);
		if (prev && sameItem(prev, item)) return [];
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
