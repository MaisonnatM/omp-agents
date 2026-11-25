/** The Board's search, as Slack's: every word of the query must appear in a Board task or a reply, in the open thread, the open Workspace, or every Workspace. */
import { everyWord, searchWords, snippetOf } from "../../../src/shared/every-word";
import { plainMarkdown } from "../../../src/shared/plain-markdown";
import { splitSuggestions } from "../../../src/shared/transcript";
import type { BoardAuthor, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";

/** Where a search looks: the open Board thread, the open Workspace, or every Workspace. */
export type BoardScope = "thread" | "workspace" | "all";

export interface BoardSearch {
	query: string;
	scope: BoardScope;
}

/** The scope `value` names, the open Workspace for any other value, and for `thread` while no Board thread is open. */
export const scopeOf = (value: string | null | undefined, thread: number | null): BoardScope => (value === "all" ? "all" : value === "thread" && thread !== null ? "thread" : "workspace");

/** One message that matched: a Board task when `reply` is `null`, else its reply at that index of `task.replies`; `text` is the part of it that matched. */
export interface BoardHit {
	task: BoardTask;
	reply: number | null;
	by: BoardAuthor;
	at: number;
	text: string;
}

/** A reply's text as the thread shows it: a session's without its `Suggestions:` block. */
export const replyText = (by: BoardAuthor, text: string): string => (by.kind === "session" ? splitSuggestions(text).body : text);

/** The messages matching `search`, newest first; `workspace` and `thread` are the open ones, which the narrower scopes read. */
export function searchBoard(state: BoardState, search: BoardSearch, workspace: string | null, thread: number | null): BoardHit[] {
	const words = searchWords(search.query);
	if (words.length === 0) return [];
	const matches = everyWord(search.query);
	const holdsAny = (text: string): boolean => words.some(word => text.toLowerCase().includes(word));
	const scope = scopeOf(search.scope, thread);
	const tasks = state.tasks.filter(task => (scope === "all" ? true : scope === "workspace" ? task.workspace === workspace : task.id === thread));
	const hits: BoardHit[] = [];
	for (const task of tasks) {
		const parts = [task.text, task.title, Object.entries(task.labels).map(([key, value]) => `${key}=${value}`).join(" ")].filter(Boolean);
		if (matches(parts.join("\n"))) hits.push({ task, reply: null, by: task.by, at: task.at, text: parts.find(matches) ?? parts.find(holdsAny) ?? parts[0] ?? "" });
		task.replies.forEach((entry, index) => {
			if (!("by" in entry)) return;
			const text = replyText(entry.by, entry.text);
			if (matches(text)) hits.push({ task, reply: index, by: entry.by, at: entry.at, text });
		});
	}
	return hits.sort((a, b) => b.at - a.at);
}

/** The parts of `text` any word covers, in order and merged where they touch, to mark. */
export function matchRanges(text: string, words: readonly string[]): { start: number; end: number }[] {
	const lower = text.toLowerCase();
	const found: { start: number; end: number }[] = [];
	for (const word of words) {
		for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) found.push({ start: at, end: at + word.length });
	}
	found.sort((a, b) => a.start - b.start);
	const merged: { start: number; end: number }[] = [];
	for (const range of found) {
		const last = merged.at(-1);
		if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	return merged;
}

/** At most `max` characters of `text` on one line without its Markdown marks, starting a little before the query's first word. */
export const snippet = (text: string, query: string, max = 280): string => snippetOf(plainMarkdown(text), query, max, 60);
