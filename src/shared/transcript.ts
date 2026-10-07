/** What a transcript shows: its items, the files its agent changed, its images, and the text files it opens. */

/** The extensions of the files that agent text may open in the page's file dialog, `GET /api/file`. */
export const TEXT_FILE_EXTENSIONS: readonly string[] = ["md", "markdown", "txt", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml", "diff", "patch"];
/** The most bytes of a text file that `GET /api/file` reads. */
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
/** A text file that `GET /api/file` read: at most its first `MAX_TEXT_FILE_BYTES`, then `truncated`. */
export interface TextFile {
	/** Absolute, with `~` and a relative path resolved. */
	path: string;
	text: string;
	/** The whole file's size in bytes. */
	size: number;
	truncated: boolean;
}

export type Item =
	/**
	 * `skill`: the skill a `/skill:<name>` prompt invoked, with `text` holding only what the user typed after it; `null` for
	 * any other prompt. `entryId`: the session-file entry omp can branch at; `null` for Collab and skill prompts and prompts
	 * not yet in the file. `images`: the addresses of the images the prompt carried, a `data:` URL or `/api/image`; absent
	 * when it carried none.
	 */
	| { id: string; kind: "user"; text: string; skill: string | null; from: string | null; entryId: string | null; images?: string[] }
	| { id: string; kind: "assistant"; text: string; streaming: boolean; suggestions: string[] }
	/** The model's reasoning text. `streaming` while that reply is still arriving. A redacted block has no text and is left out. */
	| { id: string; kind: "thinking"; text: string; streaming: boolean }
	/** `agents`: the subagents a `task` call spawned, by id, in the order they appeared; empty for every other tool. */
	| { id: string; kind: "tool"; name: string; summary: string; status: "running" | "ok" | "error"; agents: string[] }
	| { id: string; kind: "notice"; level: "info" | "warning" | "error"; text: string };

/** One successful `edit` or `write` result on a file; `at` is when omp recorded it, in ms since the epoch, or `null` when its entry carries no time. */
export type FileChange =
	/** An edit, with the lines its diff adds and removes; `diff` is omp's numbered-line form, `null` when omp recorded an empty one. */
	| { tool: "edit"; kind: "created" | "edited" | "deleted"; at: number | null; added: number; removed: number; diff: string | null }
	/**
	 * A write, which replaces the whole file and records no diff: `created` when the transcript had not read or changed
	 * the path before, else `rewritten`. `lines` counts what it wrote, `null` when the transcript lacks its call.
	 */
	| { tool: "write"; kind: "created" | "rewritten"; at: number | null; lines: number | null };

export type FileChangeKind = FileChange["kind"];

/** A file the agent's `edit` and `write` calls changed. */
export interface ChangedFile {
	/** Relative to the transcript's working directory when inside it, else absolute with the home directory as `~`. */
	path: string;
	/** Every change, oldest first; never empty. */
	changes: FileChange[];
}

/** One line of omp's numbered diff: `+12|added`, `-12|removed`, ` 12|context`. */
export interface DiffLine {
	sign: "+" | "-" | " ";
	number: string;
	text: string;
}

const DIFF_LINE = /^([+\- ])\s*(\d+)\|(.*)$/;

/** A line of omp's numbered diff, or `null` for the blank line it puts between hunks. */
export function parseDiffLine(line: string): DiffLine | null {
	const parts = DIFF_LINE.exec(line);
	return parts ? { sign: parts[1] as DiffLine["sign"], number: parts[2], text: parts[3] } : null;
}

/** Lines a change adds and removes: an edit's diff counts; a created file's write adds every line it wrote; a rewrite counts none, as omp records no diff of it. */
export function lineDelta(change: FileChange): { added: number; removed: number } {
	switch (change.tool) {
		case "edit":
			return { added: change.added, removed: change.removed };
		case "write":
			return { added: change.kind === "created" ? (change.lines ?? 0) : 0, removed: 0 };
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}

/** Lines added and removed over every change. */
export function lineTotals(changes: readonly FileChange[]): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const change of changes) {
		const delta = lineDelta(change);
		added += delta.added;
		removed += delta.removed;
	}
	return { added, removed };
}

/** What the transcript did to a file over all its changes: deleted it last, created it first, else edited it. */
export type FileStatus = "created" | "edited" | "deleted";

export function fileStatus(changes: ChangedFile["changes"]): FileStatus {
	if (changes[changes.length - 1].kind === "deleted") return "deleted";
	return changes[0].kind === "created" ? "created" : "edited";
}

/** One image an agent's tool returned, such as a browser screenshot or a `read` of an image file. */
export interface AgentMedia {
	/** `/api/image?hash=…&type=…`, or a `data:` URL for an image omp kept in the session file. */
	src: string;
	/** The agent whose transcript holds it, by subagent id; `null` for a session's main agent. */
	agentId: string | null;
	tool: string;
	/** What the tool call said it did, as one line; empty when it said nothing. */
	summary: string;
	/** When the tool returned it, in ms since the epoch. */
	at: number;
}

/** The media list's order: newest first. */
export const newestMediaFirst = (a: AgentMedia, b: AgentMedia): number => b.at - a.at;
