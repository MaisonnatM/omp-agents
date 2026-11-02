/**
 * Pure transforms from the server's `items` messages to what a transcript renders: its blocks, its outline, and the
 * facts its rows, its minimap, its chat history, and its Todos card read, as one {@link TranscriptModel}.
 */
import type { RoutineTask } from "../src/routines";
import { taskOf, taskText } from "../src/shared/routine-message";
import type { Item, TodoPhase } from "../src/shared/transcript";

export type ToolItem = Extract<Item, { kind: "tool" }>;
/** A tool call or the thinking that sits with it. Consecutive ones render as one activity group between messages. */
export type ActivityItem = Extract<Item, { kind: "tool" | "thinking" }>;

/** A prompt the dashboard sent in the user's place, which counts as a turn's prompt but renders nothing. */
type DashboardItem = Extract<Item, { kind: "dashboard" }>;

type Opener = Extract<Item, { kind: "user" | "routine" | "dashboard" }>;
type AssistantItem = Extract<Item, { kind: "assistant" }>;

export type Block = { kind: "item"; item: Exclude<Item, ActivityItem | DashboardItem> } | { kind: "activity"; id: string; entries: ActivityItem[] };

/** Whether `item` opens a turn: a prompt, the user's, one a routine sent, or one the dashboard sent in their place, which shows nothing. */
export const opensTurn = (item: Item): item is Opener => item.kind === "user" || item.kind === "routine" || item.kind === "dashboard";

const blockKey = (block: Block): string => (block.kind === "item" ? block.item.id : block.id);

const sameBlock = (a: Block, b: Block): boolean =>
	a.kind === "item" ? b.kind === "item" && a.item === b.item : b.kind === "activity" && a.entries.length === b.entries.length && a.entries.every((entry, i) => entry === b.entries[i]);

/**
 * The blocks of `items` from index `from`, without the prompts the dashboard sent, each with the index of its first
 * item. A block of `previous` whose items are the same objects comes back as the same object, so a row of an unchanged
 * message or tool group, memoized on its block, skips the render that a streamed token starts.
 */
function blocksFrom(items: readonly Item[], from: number, previous: readonly Block[]): { blocks: Block[]; starts: number[] } {
	const blocks: Block[] = [];
	const starts: number[] = [];
	for (let at = from; at < items.length; at++) {
		const item = items[at]!;
		if (item.kind === "dashboard") continue;
		const last = blocks.at(-1);
		if (item.kind === "tool" || item.kind === "thinking") {
			if (last?.kind === "activity") {
				last.entries.push(item);
				continue;
			}
			blocks.push({ kind: "activity", id: item.id, entries: [item] });
		} else blocks.push({ kind: "item", item });
		starts.push(at);
	}
	if (previous.length === 0) return { blocks, starts };
	const before = new Map(previous.map(block => [blockKey(block), block]));
	return {
		blocks: blocks.map(block => {
			const kept = before.get(blockKey(block));
			return kept && sameBlock(kept, block) ? kept : block;
		}),
		starts,
	};
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

/** One turn of a transcript's outline: the prompt that opened it and the reply it ended on. */
export interface OutlineTurn {
	/** The prompt's item id. */
	id: string;
	/** The prompt's text, or for a prompt that carried only images, how many it carried: `2 images`; a routine's prompt or command. */
	prompt: string;
	/** The skill the prompt invoked; `null` for any other prompt. */
	skill: string | null;
	/** The routine that sent the prompt, as of the send; `null` for the user's. */
	routine: { name: string; task: RoutineTask } | null;
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

const HAS_TEXT = /\S/;

/**
 * What the last turn suggests sending next: the suggestions its reply, its last assistant message with text, ends on;
 * none while it runs or once a prompt follows it.
 */
export function nextSuggestions(items: readonly Item[], working: boolean): string[] {
	if (working) return [];
	for (let at = items.length - 1; at >= 0; at--) {
		const item = items[at]!;
		if (opensTurn(item)) return [];
		if (item.kind === "assistant" && HAS_TEXT.test(item.text)) return item.suggestions;
	}
	return [];
}

/** Where a message forks. omp branches only at a user prompt, keeping the history before it. */
export interface ForkPoint {
	entryId: string;
	/** Forking a prompt starts the composer with it to edit; forking a reply starts it empty. */
	prefill: boolean;
}

/** The prompt of `items` that took the place of the pending one `previous` ended on. */
export function replacingPrompt(previous: readonly Item[], items: readonly Item[]): string | null {
	const pending = previous.findLast(item => item.kind === "user");
	if (pending?.kind !== "user" || !pending.pending || items.some(item => item.id === pending.id)) return null;
	const prompt = items.findLast(item => item.kind === "user");
	return prompt && !previous.some(item => item.id === prompt.id) ? prompt.id : null;
}

/** One image a tool's result returned: its tool item, its place among that item's images, and the line that captions it. */
export interface ToolImage {
	id: string;
	at: number;
	src: string;
	caption: string;
}

/** What an outline turn takes from its prompt; `nudge` as it reads in any turn but the first, which nudges nothing. */
type TurnHead = Pick<OutlineTurn, "id" | "prompt" | "skill" | "routine" | "nudge">;

/**
 * The items from one prompt up to the next, or before the first prompt, with what the transcript reads from them. A
 * prompt the dashboard sent opens one too: it ends the reply and fork rules of the one before, though the outline counts
 * its items in the turn before.
 */
interface Segment {
	/** The index of its first item, its prompt when it opens with one. */
	start: number;
	opener: Opener | null;
	/** What its outline turn shows of its prompt; `null` without one, or for a prompt the dashboard sent. */
	head: TurnHead | null;
	/** Its reply, the last assistant message with text; `null` while it is the last one and the transcript works. */
	reply: AssistantItem | null;
	/** The fork points of its prompt and of its last assistant message, which forks at the next segment's prompt. */
	forks: [string, ForkPoint][];
	tools: number;
	failed: number;
	images: ToolImage[];
	/** The user's prompts up to and including this segment. */
	prompts: number;
	/** The agent's todo list as its latest successful `todo` call up to and including this segment left it. */
	todos: TodoPhase[];
}

/**
 * A transcript as its renderers read it. {@link transcriptModel} builds the next one from the one before, again only
 * from the turn holding the first item that changed, so a streamed token redoes the last turn and its last block, not
 * the whole transcript.
 */
export interface TranscriptModel {
	items: readonly Item[];
	working: boolean;
	blocks: readonly Block[];
	/**
	 * Fork points by item id. A prompt forks at itself. A turn's last reply forks at the next prompt, keeping the whole
	 * turn; earlier replies in the turn, a reply still streaming, and a reply no forkable prompt follows have none. A prompt
	 * a routine or the dashboard sent has no fork point of its own, but a reply before it forks there.
	 */
	forks: ReadonlyMap<string, ForkPoint>;
	/**
	 * The reply each turn ends on: its last assistant message with text. The copy button shows only on these, not on the
	 * replies a turn writes between tool calls. A turn still running has no reply yet.
	 */
	replies: ReadonlySet<string>;
	/** Each turn in transcript order. A turn still running has no reply until it ends. */
	outline: readonly OutlineTurn[];
	/** How many prompts the user sent. */
	prompts: number;
	/** Every image the tool calls returned, in reading order, each captioned with its tool and what the call said it did. */
	images: readonly ToolImage[];
	/** The agent's todo list as its latest successful `todo` call left it; empty before its first one. */
	todos: TodoPhase[];
	/**
	 * The prompt a double-click edits: the last one, once omp has saved it. omp resends an edit as text alone, so a skill
	 * prompt or one that carried images or files is not editable. None after a prompt a routine or the dashboard sent,
	 * which an edit of the user's prompt before it would drop.
	 */
	editable: { itemId: string; entryId: string } | null;
	/** What the next model starts from: the segments, the first item of each block, and the segment each outline turn opens. */
	segments: readonly Segment[];
	blockStarts: readonly number[];
	turnStarts: readonly number[];
}

const NO_TODOS: TodoPhase[] = [];

export const EMPTY_TRANSCRIPT: TranscriptModel = {
	items: [],
	working: false,
	blocks: [],
	forks: new Map(),
	replies: new Set(),
	outline: [],
	prompts: 0,
	images: [],
	todos: NO_TODOS,
	editable: null,
	segments: [],
	blockStarts: [],
	turnStarts: [],
};

function headOf(opener: Opener): TurnHead | null {
	if (opener.kind === "routine") {
		const { message } = opener;
		return { id: opener.id, prompt: taskText(message), skill: null, routine: { name: message.routine.name, task: taskOf(message) }, nudge: null };
	}
	if (opener.kind !== "user") return null;
	const text = opener.text.trim();
	const images = opener.images?.length ?? 0;
	const files = opener.files ?? [];
	const prompt = text || files.join(", ") || (images > 0 ? `${images} ${images === 1 ? "image" : "images"}` : "");
	const match = !opener.skill && images === 0 && files.length === 0 ? NUDGE.exec(text) : null;
	return { id: opener.id, prompt, skill: opener.skill, routine: null, nudge: match ? (match[1] ? "resume" : "approve") : null };
}

/**
 * The segment of `items` from `start` to `end`. `next` is the prompt after it; `ends` marks the last segment while the
 * transcript works. `previous` is the segment at its place in the model before, whose head it keeps for the same prompt;
 * `before` is the segment just before it, whose counts it carries on.
 */
function segmentOf(items: readonly Item[], start: number, end: number, next: Item | undefined, ends: boolean, previous: Segment | undefined, before: Segment | undefined): Segment {
	const first = items[start]!;
	const opener = opensTurn(first) ? first : null;
	let reply: AssistantItem | null = null;
	let lastAssistant: AssistantItem | null = null;
	let tools = 0;
	let failed = 0;
	let todos = before?.todos ?? NO_TODOS;
	const images: ToolImage[] = [];
	for (let at = start; at < end; at++) {
		const item = items[at]!;
		if (item.kind === "assistant") {
			lastAssistant = item;
			if (HAS_TEXT.test(item.text)) reply = item;
		} else if (item.kind === "tool") {
			tools++;
			if (item.status === "error") failed++;
			if (item.todos) todos = item.todos;
			if (item.images) {
				const caption = [item.name, item.summary].filter(Boolean).join(" · ");
				item.images.forEach((src, index) => images.push({ id: item.id, at: index, src, caption }));
			}
		}
	}
	const forks: [string, ForkPoint][] = [];
	if (opener?.kind === "user" && opener.entryId) forks.push([opener.id, { entryId: opener.entryId, prefill: true }]);
	const nextEntry = next && opensTurn(next) ? next.entryId : null;
	if (lastAssistant && nextEntry && !lastAssistant.streaming) forks.push([lastAssistant.id, { entryId: nextEntry, prefill: false }]);
	return {
		start,
		opener,
		head: opener && previous?.opener === opener ? previous.head : opener && headOf(opener),
		reply: ends ? null : reply,
		forks,
		tools,
		failed,
		images,
		prompts: (before?.prompts ?? 0) + (opener?.kind === "user" ? 1 : 0),
		todos,
	};
}

/** The index of the last of `count` ascending numbers, read through `at`, that is at most `value`; -1 when none is. */
function lastAtMost(count: number, at: (index: number) => number, value: number): number {
	let low = 0;
	let high = count - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (at(mid) <= value) {
			found = mid;
			low = mid + 1;
		} else high = mid - 1;
	}
	return found;
}

/** How many leading items `a` and `b` share as the same objects. */
function sharedPrefix(a: readonly Item[], b: readonly Item[]): number {
	const length = Math.min(a.length, b.length);
	let at = 0;
	while (at < length && a[at] === b[at]) at++;
	return at;
}

const sameTurn = (a: OutlineTurn, b: OutlineTurn): boolean =>
	a.id === b.id && a.prompt === b.prompt && a.skill === b.skill && a.routine === b.routine && a.nudge === b.nudge &&
	a.tools === b.tools && a.failed === b.failed && a.running === b.running && a.reply?.id === b.reply?.id && a.reply?.text === b.reply?.text;

const sameImage = (a: ToolImage, b: ToolImage): boolean => a.id === b.id && a.at === b.at && a.src === b.src && a.caption === b.caption;

/** `next`, or `previous` when it holds the same entries, so a reader memoized on it skips a token that left it alone. */
function keepSame<T>(previous: readonly T[], next: readonly T[], same: (a: T, b: T) => boolean): readonly T[] {
	return previous.length === next.length && next.every((entry, i) => same(previous[i]!, entry)) ? previous : next;
}

/**
 * The model of `items` while the transcript works or not, built from `previous`, the model of the same view's items
 * before: what lies before the turn holding the first changed item comes from it as it is, the same objects included.
 */
export function transcriptModel(items: readonly Item[], working: boolean, previous: TranscriptModel = EMPTY_TRANSCRIPT): TranscriptModel {
	if (items === previous.items && working === previous.working) return previous;
	const same = items === previous.items ? items.length : sharedPrefix(previous.items, items);

	// The segment holding the last unchanged item is built again, with every one after it: it may have grown, and the last
	// one's reply follows `working`. The ones before it, and the prompt that ends each, are unchanged.
	const kept = same === 0 ? 0 : Math.max(0, lastAtMost(previous.segments.length, i => previous.segments[i]!.start, same - 1));
	const from = same === 0 ? 0 : previous.segments[kept]!.start;
	const segments = previous.segments.slice(0, kept);
	const starts: number[] = [];
	for (let at = from; at < items.length; at++) if (at === from || opensTurn(items[at]!)) starts.push(at);
	starts.forEach((start, i) => {
		const end = starts[i + 1] ?? items.length;
		segments.push(segmentOf(items, start, end, items[end], working && end === items.length, previous.segments[segments.length], segments.at(-1)));
	});

	// A block that starts before the first changed item and is followed by another one is unchanged.
	let blocks = previous.blocks;
	let blockStarts = previous.blockStarts;
	if (items !== previous.items) {
		const last = same === 0 ? -1 : lastAtMost(previous.blockStarts.length, i => previous.blockStarts[i]!, same - 1);
		const keep = Math.max(last, 0);
		const tail = blocksFrom(items, last < 0 ? 0 : previous.blockStarts[last]!, previous.blocks.slice(keep));
		blocks = [...previous.blocks.slice(0, keep), ...tail.blocks];
		blockStarts = [...previous.blockStarts.slice(0, keep), ...tail.starts];
	}

	// The outline turns before the one holding the first rebuilt segment are unchanged.
	const turn = lastAtMost(previous.turnStarts.length, i => previous.turnStarts[i]!, kept);
	const keepTurns = Math.max(turn, 0);
	const turns = previous.outline.slice(0, keepTurns);
	const turnStarts = previous.turnStarts.slice(0, keepTurns);
	let open: OutlineTurn | null = null;
	for (let s = turn < 0 ? kept : previous.turnStarts[turn]!; s < segments.length; s++) {
		const segment = segments[s]!;
		if (segment.head) {
			open = { ...segment.head, nudge: turns.length > 0 ? segment.head.nudge : null, reply: null, tools: 0, failed: 0, running: false };
			turns.push(open);
			turnStarts.push(s);
		}
		if (!open) continue;
		open.tools += segment.tools;
		open.failed += segment.failed;
		if (segment.reply) open.reply = { id: segment.reply.id, text: segment.reply.text.trim() };
	}
	if (open && working) open.running = true;
	const outline = keepSame(previous.outline, turns.map((entry, i) => (i >= keepTurns && previous.outline[i] && sameTurn(previous.outline[i]!, entry) ? previous.outline[i]! : entry)), Object.is);

	const forks = new Map<string, ForkPoint>();
	const replies = new Set<string>();
	for (const segment of segments) {
		for (const [id, point] of segment.forks) forks.set(id, point);
		if (segment.reply) replies.add(segment.reply.id);
	}
	const sameForks = forks.size === previous.forks.size && [...forks].every(([id, point]) => {
		const was = previous.forks.get(id);
		return was?.entryId === point.entryId && was.prefill === point.prefill;
	});
	const sameReplies = replies.size === previous.replies.size && [...replies].every(id => previous.replies.has(id));

	const last = segments.at(-1);
	const prompt = last?.opener;
	const editable = prompt?.kind === "user" && prompt.entryId && !prompt.skill && !prompt.images?.length && !prompt.files?.length ? { itemId: prompt.id, entryId: prompt.entryId } : null;
	return {
		items,
		working,
		blocks,
		forks: sameForks ? previous.forks : forks,
		replies: sameReplies ? previous.replies : replies,
		outline,
		prompts: last?.prompts ?? 0,
		images: keepSame(previous.images, segments.flatMap(segment => segment.images), sameImage),
		todos: last?.todos ?? NO_TODOS,
		editable: editable && previous.editable?.itemId === editable.itemId && previous.editable.entryId === editable.entryId ? previous.editable : editable,
		segments,
		blockStarts,
		turnStarts,
	};
}
