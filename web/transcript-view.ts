/** Pure transforms from the server's `items` messages to the blocks a transcript renders. */
import type { Item } from "../src/shared/transcript";

export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Consecutive tool calls render as one activity group between messages. */
export type Block = { kind: "item"; item: Exclude<Item, ToolItem> } | { kind: "tools"; id: string; tools: ToolItem[] };

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

/** One row of a transcript's outline: a prompt, or the reply its turn ended on. */
export interface OutlineEntry {
	id: string;
	kind: "prompt" | "reply";
	/** The message's text, or for a prompt that carried only images, how many it carried: `2 images`. */
	text: string;
	/** The skill a prompt invoked; `null` for any other prompt and for every reply. */
	skill: string | null;
}

/** Each prompt and each turn's final reply, in transcript order. A turn still running lists no reply until it ends. */
export function outline(items: Item[], working: boolean): OutlineEntry[] {
	const replies = turnReplies(items, working);
	return items.flatMap((item): OutlineEntry[] => {
		if (item.kind === "user") {
			const images = item.images?.length ?? 0;
			const text = item.text.trim() || (images > 0 ? `${images} ${images === 1 ? "image" : "images"}` : "");
			return [{ id: item.id, kind: "prompt", text, skill: item.skill }];
		}
		return replies.has(item.id) && item.kind === "assistant" ? [{ id: item.id, kind: "reply", text: item.text.trim(), skill: null }] : [];
	});
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

/**
 * The prompt a double-click edits: the last one, once omp has saved it. omp resends an edit as text alone, so a skill
 * prompt or one that carried images is not editable.
 */
export function editablePrompt(items: Item[]): { itemId: string; entryId: string } | null {
	const last = items.findLast(item => item.kind === "user");
	if (last?.kind !== "user" || !last.entryId || last.skill || last.images?.length) return null;
	return { itemId: last.id, entryId: last.entryId };
}
