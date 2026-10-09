/** Pure transforms from the server's `items` messages to the blocks a transcript renders. */
import type { Item } from "../src/shared/transcript";

export type ToolItem = Extract<Item, { kind: "tool" }>;
/** A tool call or the thinking that sits with it. Consecutive ones render as one activity group between messages. */
export type ActivityItem = Extract<Item, { kind: "tool" | "thinking" }>;

export type Block = { kind: "item"; item: Exclude<Item, ActivityItem> } | { kind: "activity"; id: string; entries: ActivityItem[] };

const blockKey = (block: Block): string => (block.kind === "item" ? block.item.id : block.id);

const sameBlock = (a: Block, b: Block): boolean =>
	a.kind === "item" ? b.kind === "item" && a.item === b.item : b.kind === "activity" && a.entries.length === b.entries.length && a.entries.every((entry, i) => entry === b.entries[i]);

/**
 * The blocks of `items`. A block of `previous` whose items are the same objects comes back as the same object, so a
 * row of an unchanged message or tool group, memoized on its block, skips the render that a streamed token starts.
 */
export function toBlocks(items: Item[], previous: readonly Block[] = []): Block[] {
	const blocks: Block[] = [];
	for (const item of items) {
		const last = blocks.at(-1);
		if (item.kind === "tool" || item.kind === "thinking") {
			if (last?.kind === "activity") last.entries.push(item);
			else blocks.push({ kind: "activity", id: item.id, entries: [item] });
		} else blocks.push({ kind: "item", item });
	}
	if (previous.length === 0) return blocks;
	const before = new Map(previous.map(block => [blockKey(block), block]));
	return blocks.map(block => {
		const kept = before.get(blockKey(block));
		return kept && sameBlock(kept, block) ? kept : block;
	});
}

/** Keeps the prompt being edited at its original position until its resend settles, even after a transcript reset. */
export function withEditedPrompt(blocks: readonly Block[], edit: { item: Extract<Item, { kind: "user" }>; position: number; submitted: string | null } | null): readonly Block[] {
	if (!edit) return blocks;
	const at = blocks.findIndex(block => block.kind === "item" && block.item.id === edit.item.id);
	const prompt: Block = { kind: "item", item: edit.item };
	if (at >= 0) return blocks.with(at, prompt);
	const replacement = blocks[edit.position];
	if (edit.submitted !== null && replacement?.kind === "item" && replacement.item.kind === "user" &&
		replacement.item.text === edit.submitted && replacement.item.skill === null &&
		!replacement.item.images?.length && !replacement.item.files?.length) {
		return blocks.with(edit.position, prompt);
	}
	return blocks.toSpliced(Math.min(edit.position, blocks.length), 0, prompt);
}

/** How many turns the transcript holds: one per prompt, as {@link outline} counts them. */
export const turnCount = (items: Item[]): number => items.reduce((count, item) => count + (item.kind === "user" ? 1 : 0), 0);

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

/** One turn of a transcript's outline: the prompt that opened it and the reply it ended on. */
export interface OutlineTurn {
	/** The prompt's item id. */
	id: string;
	/** The prompt's text, or for a prompt that carried only images, how many it carried: `2 images`. */
	prompt: string;
	/** The skill the prompt invoked; `null` for any other prompt. */
	skill: string | null;
	/**
	 * A prompt of a few words that only lets the agent carry on: `approve`, such as `go`, accepts the reply before it as a
	 * plan; `resume`, such as `continue`, picks up work the turn before stopped. `null` for any other prompt.
	 */
	nudge: "approve" | "resume" | null;
	/** The turn's final reply; `null` while the turn runs or when it ended without one. */
	reply: { id: string; text: string } | null;
	tools: number;
	failed: number;
	running: boolean;
}

/**
 * A nudge: a prompt led by `go`, which in this workflow always approves, even with a choice after it (`go with the
 * defaults`); or approval words alone, such as `yes`, `lgtm`, `fix all then push`, or `continue`, which resumes.
 * `ok` with more words, or `push` or `ship it` alone, asks for something else, so it nudges nothing.
 */
const NUDGE = /^(?:go\b|(?:(continue)|yes|yep|yeah|y|ok|okay|sure|proceed|lgtm|do|fix)\b(?:[\s,.!]+(?:yes|ok|go|continue|all|on|ahead|it|please|then|push|don['’]?t|commit)\b)*[\s,.!]*$)/i;

/** Each turn in transcript order. A turn still running has no reply until it ends. */
export function outline(items: Item[], working: boolean): OutlineTurn[] {
	const replies = turnReplies(items, working);
	const turns: OutlineTurn[] = [];
	for (const item of items) {
		if (item.kind === "user") {
			const text = item.text.trim();
			const images = item.images?.length ?? 0;
			const files = item.files ?? [];
			const prompt = text || files.join(", ") || (images > 0 ? `${images} ${images === 1 ? "image" : "images"}` : "");
			const match = turns.length > 0 && !item.skill && images === 0 && files.length === 0 ? NUDGE.exec(text) : null;
			const nudge = match ? (match[1] ? "resume" : "approve") : null;
			turns.push({ id: item.id, prompt, skill: item.skill, nudge, reply: null, tools: 0, failed: 0, running: false });
			continue;
		}
		const turn = turns.at(-1);
		if (!turn) continue;
		if (item.kind === "tool") {
			turn.tools++;
			if (item.status === "error") turn.failed++;
		} else if (item.kind === "assistant" && replies.has(item.id)) turn.reply = { id: item.id, text: item.text.trim() };
	}
	const last = turns.at(-1);
	if (last && working) last.running = true;
	return turns;
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
 * prompt or one that carried images or files is not editable.
 */
export function editablePrompt(items: Item[]): { itemId: string; entryId: string } | null {
	const last = items.findLast(item => item.kind === "user");
	if (last?.kind !== "user" || !last.entryId || last.skill || last.images?.length || last.files?.length) return null;
	return { itemId: last.id, entryId: last.entryId };
}
