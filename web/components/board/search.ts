/** The Board's search, as Slack's: every word of the query must appear in a Board task or a reply, in the open thread, the open Workspace, or every Workspace. */
import { splitSuggestions } from "../../../src/shared/transcript";
import type { BoardAuthor, BoardState, BoardTask } from "../../../templates/omp/agent/extensions/board/log";

/** Where a search looks: the open Board thread, the open Workspace, or every Workspace. */
export type BoardScope = "thread" | "workspace" | "all";

export interface BoardSearch {
	query: string;
	scope: BoardScope;
}

/** One message that matched: a Board task when `reply` is `null`, else its reply at that index of `task.replies`. */
export interface BoardHit {
	task: BoardTask;
	reply: number | null;
	by: BoardAuthor;
	at: number;
	text: string;
}

/** The query's words, lowercased; quotes and extra spaces drop out. */
export const termsOf = (query: string): string[] => [...new Set(query.toLowerCase().replace(/["“”]/g, " ").split(/\s+/).filter(Boolean))];

/** A reply's text as the thread shows it: a session's without its `Suggestions:` block. */
export const replyText = (by: BoardAuthor, text: string): string => (by.kind === "session" ? splitSuggestions(text).body : text);

/** The messages matching `search`, newest first; `workspace` and `thread` are the open ones, which the narrower scopes read. */
export function searchBoard(state: BoardState, search: BoardSearch, workspace: string | null, thread: number | null): BoardHit[] {
	const terms = termsOf(search.query);
	if (terms.length === 0) return [];
	const matches = (text: string): boolean => {
		const lower = text.toLowerCase();
		return terms.every(term => lower.includes(term));
	};
	const tasks = state.tasks.filter(task => (search.scope === "all" ? true : search.scope === "workspace" ? task.workspace === workspace : task.id === thread));
	const hits: BoardHit[] = [];
	for (const task of tasks) {
		const searchable = [task.title, task.text, ...Object.entries(task.labels).map(([key, value]) => `${key}=${value}`)].join("\n");
		if (matches(searchable)) hits.push({ task, reply: null, by: task.by, at: task.at, text: task.text || task.title });
		task.replies.forEach((entry, index) => {
			if (!("by" in entry)) return;
			const text = replyText(entry.by, entry.text);
			if (matches(text)) hits.push({ task, reply: index, by: entry.by, at: entry.at, text });
		});
	}
	return hits.sort((a, b) => b.at - a.at);
}

/** The parts of `text` any term covers, in order and merged where they touch, to mark. */
export function matchRanges(text: string, terms: readonly string[]): { start: number; end: number }[] {
	const lower = text.toLowerCase();
	const found: { start: number; end: number }[] = [];
	for (const term of terms) {
		for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) found.push({ start: at, end: at + term.length });
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

/** At most `max` characters of `text` on one line without its Markdown marks, starting a little before its first match, with `…` where it was cut. */
export function snippet(text: string, terms: readonly string[], max = 280): string {
	const flat = text
		.replace(/^\s*(?:[-*+]|\d+\.|#{1,6})\s+/gm, "")
		.replace(/\*\*|__|`/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (flat.length <= max) return flat;
	const first = matchRanges(flat, terms)[0]?.start ?? 0;
	const start = Math.max(0, Math.min(first - 60, flat.length - max));
	const cut = flat.slice(start, start + max);
	return `${start > 0 ? "…" : ""}${cut}${start + max < flat.length ? "…" : ""}`;
}
