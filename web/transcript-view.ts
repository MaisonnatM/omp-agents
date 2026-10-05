/** Pure transforms from the server's `items` messages to the blocks a transcript renders. */
import type { Item } from "../src/shared";

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Consecutive tool calls render as one activity group between messages. */
export type Block = { kind: "item"; item: Exclude<Item, ToolItem> } | { kind: "tools"; id: string; tools: ToolItem[] };

/** Apply an `items` message: replace on reset, else upsert by id and append new ids. */
export function applyItems(prev: Item[], reset: boolean, items: Item[]): Item[] {
	if (reset) return items;
	const next = [...prev];
	const index = new Map(next.map((item, i) => [item.id, i]));
	for (const item of items) {
		const at = index.get(item.id);
		if (at === undefined) {
			index.set(item.id, next.length);
			next.push(item);
		} else {
			next[at] = item;
		}
	}
	return next;
}

export function toBlocks(items: Item[]): Block[] {
	const blocks: Block[] = [];
	for (const item of items) {
		const last = blocks.at(-1);
		if (item.kind !== "tool") blocks.push({ kind: "item", item });
		else if (last?.kind === "tools") last.tools.push(item);
		else blocks.push({ kind: "tools", id: item.id, tools: [item] });
	}
	return blocks;
}

/**
 * The reply each turn ends on: its last assistant message with text. The copy button shows only on these,
 * not on the replies a turn writes between tool calls. A turn still running has no reply yet.
 */
export function turnReplies(items: Item[], working: boolean): Set<string> {
	const replies = new Set<string>();
	let replyFound = working;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.kind === "user") replyFound = false;
		else if (item.kind === "assistant" && !replyFound && item.text.trim() !== "") {
			replyFound = true;
			replies.add(item.id);
		}
	}
	return replies;
}

/** What the last turn suggests sending next: the suggestions its reply ends on; none while it runs or once a prompt follows it. */
export function nextSuggestions(items: Item[], working: boolean): string[] {
	if (working) return [];
	const replies = turnReplies(items, false);
	const last = items.findLast(item => item.kind === "user" || replies.has(item.id));
	return last?.kind === "assistant" ? last.suggestions : [];
}

/** Where a message forks. omp branches only at a user prompt, keeping the history before it. */
export interface ForkPoint {
	entryId: string;
	/** Forking a prompt starts the composer with it to edit; forking a reply starts it empty. */
	prefill: boolean;
}

/**
 * Fork points by item id. A prompt forks at itself. A turn's last reply forks at the next prompt,
 * keeping the whole turn; earlier replies in the turn, a reply still streaming, and a reply no
 * forkable prompt follows have none.
 */
export function forkPoints(items: Item[]): Map<string, ForkPoint> {
	const points = new Map<string, ForkPoint>();
	let nextPrompt: string | null = null;
	let replyFound = false;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item.kind === "user") {
			nextPrompt = item.entryId;
			replyFound = false;
			if (item.entryId) points.set(item.id, { entryId: item.entryId, prefill: true });
		} else if (item.kind === "assistant" && !replyFound) {
			replyFound = true;
			if (nextPrompt && !item.streaming) points.set(item.id, { entryId: nextPrompt, prefill: false });
		}
	}
	return points;
}
