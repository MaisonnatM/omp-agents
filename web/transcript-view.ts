/**
 * Pure transforms from the server's `items` messages to what a transcript renders: its blocks, its outline, and the
 * facts its rows, its minimap, its chat history, and its Session card read, as one {@link TranscriptModel}.
 */
import type { RoutineTask } from "../src/routines";
import { promptTitle } from "../src/shared/prompt-files";
import { taskOf, taskText } from "../src/shared/routine-message";
import { isPrompt, type Item, type PromptItem } from "../src/shared/transcript";
import type { ActionState } from "./use-action";

export type ToolItem = Extract<Item, { kind: "tool" }>;
/** A tool call or the thinking that sits with it. Consecutive ones render as one activity group between messages. */
export type ActivityItem = Extract<Item, { kind: "tool" | "thinking" }>;

/** A prompt the dashboard sent in the user's place, which counts as a turn's prompt but renders nothing. */
type DashboardItem = Extract<Item, { kind: "dashboard" }>;

type Opener = PromptItem | DashboardItem;
type AssistantItem = Extract<Item, { kind: "assistant" }>;

export type Block = { kind: "item"; item: Exclude<Item, ActivityItem | DashboardItem> } | { kind: "activity"; id: string; entries: ActivityItem[] };

/** Whether `item` opens a turn: a prompt, the user's, one a routine or another Bot sent, or one the dashboard sent in their place, which shows nothing. */
export const opensTurn = (item: Item): item is Opener => isPrompt(item) || item.kind === "dashboard";

const blockKey = (block: Block): string => (block.kind === "item" ? block.item.id : block.id);

const sameBlock = (a: Block, b: Block): boolean =>
	a.kind === "item" ? b.kind === "item" && a.item === b.item : b.kind === "activity" && a.entries.length === b.entries.length && a.entries.every((entry, i) => entry === b.entries[i]);

/**
 * The blocks of the items from `start` to `end`, without the prompts the dashboard sent. A block of `previous` whose
 * items are the same objects comes back as the same object, so a row of an unchanged message or tool group, memoized on
 * its block, skips the render that a streamed token starts.
 */
function blocksOf(items: readonly Item[], start: number, end: number, previous: readonly Block[]): Block[] {
	const blocks: Block[] = [];
	for (let at = start; at < end; at++) {
		const item = items[at]!;
		if (item.kind === "dashboard") continue;
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

/**
 * Where the resend of `edit` stands, read from the one action that sends it: the text it sent while that runs, or why
 * it failed. A resend of an earlier edit, such as one that answers after you moved on, shows on neither.
 */
export function resendOf<E>(edit: E | null, resend: ActionState<[E, string]>): { submitted: string | null; error: string | null } {
	if (edit === null || resend.kind === "idle" || resend.args[0] !== edit) return { submitted: null, error: null };
	return resend.kind === "pending" ? { submitted: resend.args[1], error: null } : { submitted: null, error: resend.error };
}

/** One turn of a transcript's outline: the prompt that opened it and the reply it ended on. */
export interface OutlineTurn {
	/** The prompt's item id. */
	id: string;
	/** The prompt's text, or for a prompt that carried only images, how many it carried: `2 images`; a routine's prompt or command; another Bot's message. */
	prompt: string;
	/** The skill the prompt invoked; `null` for any other prompt. */
	skill: string | null;
	/** The routine that sent the prompt, as of the send; `null` for any other prompt. */
	routine: { name: string; task: RoutineTask } | null;
	/** The name of the Bot that sent the prompt, as of the send; `null` for any other prompt. */
	botMessage: string | null;
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

/** One image the viewer steps through: its prompt or tool item, its place among that item's images, and the line that captions it. */
export interface TranscriptImage {
	id: string;
	at: number;
	src: string;
	caption: string;
}

/** What an outline turn takes from its prompt; `nudge` as it reads in any turn but the first, which nudges nothing. */
type TurnHead = Pick<OutlineTurn, "id" | "prompt" | "skill" | "routine" | "botMessage" | "nudge">;

/**
 * The items from one prompt up to the next, or before the first prompt, with what the transcript reads from them. A
 * prompt the dashboard sent opens one too: it ends the reply and fork rules of the one before, though the outline counts
 * its items in the turn before.
 */
interface Segment {
	opener: Opener | null;
	/** What its outline turn shows of its prompt; `null` without one, or for a prompt the dashboard sent. */
	head: TurnHead | null;
	/** Its reply, the last assistant message with text; `null` while it is the last one and the transcript works. */
	reply: AssistantItem | null;
	/** The fork points of its prompt and of its last assistant message, which forks at the next segment's prompt. */
	forks: [string, ForkPoint][];
	tools: number;
	failed: number;
	images: TranscriptImage[];
}

/**
 * The items of one outline turn, from a prompt the user or a routine sent up to the next such prompt, or the items before
 * the first one, which make no turn. Its segments split it at the prompts the dashboard sent. No activity group crosses
 * from one region into the next, since the prompt that opens a region is a block of its own.
 */
interface Region {
	/** The index of its first item. */
	start: number;
	segments: readonly Segment[];
	blocks: readonly Block[];
	turn: OutlineTurn | null;
}

/**
 * A transcript as its renderers read it. {@link transcriptModel} builds the next one from the one before, again only
 * from the turn holding the first item that changed, so a streamed token redoes the last turn and its last block, not
 * the whole transcript.
 */
export interface TranscriptModel {
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
	/** Every image the prompts carried and the tool calls returned, in reading order, each captioned with what sent it. */
	images: readonly TranscriptImage[];
	/**
	 * The prompt a double-click edits: the last one, once omp has saved it. omp resends an edit as text alone, so a skill
	 * prompt or one that carried images or files is not editable. None after a prompt a routine or the dashboard sent,
	 * which an edit of the user's prompt before it would drop.
	 */
	editable: { itemId: string; entryId: string } | null;
}

/** What each model was built from, which the next one starts from; kept off the model, so its readers see none of it. */
const builtFrom = new WeakMap<TranscriptModel, { items: readonly Item[]; working: boolean; regions: readonly Region[] }>();

export const EMPTY_TRANSCRIPT: TranscriptModel = { blocks: [], forks: new Map(), replies: new Set(), outline: [], images: [], editable: null };
builtFrom.set(EMPTY_TRANSCRIPT, { items: [], working: false, regions: [] });

/** A comparer for each field of `T`, so a field added to `T` does not compile until it says how it compares. */
type FieldEqual<T> = { [K in keyof T]-?: (a: T[K], b: T[K]) => boolean };

function equalBy<T extends object>(fields: FieldEqual<T>, a: T, b: T): boolean {
	for (const key in fields) if (!fields[key](a[key], b[key])) return false;
	return true;
}

const same = Object.is;

const TURN_EQUAL: FieldEqual<OutlineTurn> = {
	id: same,
	prompt: same,
	skill: same,
	// A turn keeps the head the model before built for the same prompt, so its routine is the same object.
	routine: same,
	botMessage: same,
	nudge: same,
	reply: (a, b) => a?.id === b?.id && a?.text === b?.text,
	tools: same,
	failed: same,
	running: same,
};

const IMAGE_EQUAL: FieldEqual<TranscriptImage> = { id: same, at: same, src: same, caption: same };

const FORK_EQUAL: FieldEqual<ForkPoint> = { entryId: same, prefill: same };

/** Whether two segments add the same fork points, reply, and images to the model. */
const sameFacts = (a: Segment, b: Segment): boolean =>
	a.reply?.id === b.reply?.id &&
	a.forks.length === b.forks.length &&
	a.forks.every(([id, point], i) => id === b.forks[i]![0] && equalBy(FORK_EQUAL, point, b.forks[i]![1])) &&
	a.images.length === b.images.length &&
	a.images.every((image, i) => equalBy(IMAGE_EQUAL, image, b.images[i]!));

function headOf(opener: Opener): TurnHead | null {
	if (opener.kind === "routine") {
		const { message } = opener;
		return { id: opener.id, prompt: taskText(message), skill: null, routine: { name: message.routine.name, task: taskOf(message) }, botMessage: null, nudge: null };
	}
	if (opener.kind === "bot-message") return { id: opener.id, prompt: opener.message.text, skill: null, routine: null, botMessage: opener.message.name, nudge: null };
	if (opener.kind !== "user") return null;
	const text = opener.text.trim();
	const images = opener.images?.length ?? 0;
	const files = opener.files ?? [];
	const prompt = promptTitle(text, files) || (images > 0 ? `${images} ${images === 1 ? "image" : "images"}` : "");
	const match = !opener.skill && images === 0 && files.length === 0 ? NUDGE.exec(text) : null;
	return { id: opener.id, prompt, skill: opener.skill, routine: null, botMessage: null, nudge: match ? (match[1] ? "resume" : "approve") : null };
}

/**
 * The segment of `items` from `start` to `end`. `next` is the prompt after it; `ends` marks the last segment while the
 * transcript works. `previous` is the segment at its place in the model before, whose head it keeps for the same prompt.
 */
function segmentOf(items: readonly Item[], start: number, end: number, next: Item | undefined, ends: boolean, previous: Segment | undefined): Segment {
	const first = items[start]!;
	const opener = opensTurn(first) ? first : null;
	let reply: AssistantItem | null = null;
	let lastAssistant: AssistantItem | null = null;
	let tools = 0;
	let failed = 0;
	const images: TranscriptImage[] = [];
	for (let at = start; at < end; at++) {
		const item = items[at]!;
		if (item.kind === "assistant") {
			lastAssistant = item;
			if (HAS_TEXT.test(item.text)) reply = item;
		} else if (item.kind === "tool") {
			tools++;
			if (item.status === "error") failed++;
			if (item.images) {
				const caption = [item.name, item.summary].filter(Boolean).join(" · ");
				item.images.forEach((src, index) => images.push({ id: item.id, at: index, src, caption }));
			}
		} else if (item.kind === "user" && item.images) {
			item.images.forEach((src, index) => images.push({ id: item.id, at: index, src, caption: "Your message" }));
		}
	}
	const forks: [string, ForkPoint][] = [];
	if (opener?.kind === "user" && opener.entryId) forks.push([opener.id, { entryId: opener.entryId, prefill: true }]);
	const nextEntry = next && opensTurn(next) ? next.entryId : null;
	if (lastAssistant && nextEntry && !lastAssistant.streaming) forks.push([lastAssistant.id, { entryId: nextEntry, prefill: false }]);
	return {
		opener,
		head: opener && previous?.opener === opener ? previous.head : opener && headOf(opener),
		reply: ends ? null : reply,
		forks,
		tools,
		failed,
		images,
	};
}

/**
 * The region of `items` from `start` to `end`; `ends` marks the last one while the transcript works. `previous` is the
 * region at its place in the model before, whose segments, blocks, and turn it keeps where they are unchanged; `before`
 * is the region just before it.
 */
function regionOf(items: readonly Item[], start: number, end: number, ends: boolean, previous: Region | undefined, before: Region | undefined): Region {
	const segments: Segment[] = [];
	for (let from = start; from < end; ) {
		let to = from + 1;
		while (to < end && items[to]!.kind !== "dashboard") to++;
		segments.push(segmentOf(items, from, to, items[to], ends && to === end, previous?.segments[segments.length]));
		from = to;
	}
	const head = segments[0]!.head;
	let turn: OutlineTurn | null = null;
	if (head) {
		// The prompts the dashboard sent count in the turn: their tools add to it, and the latest reply is its reply.
		const reply = segments.findLast(segment => segment.reply)?.reply;
		turn = {
			...head,
			nudge: before?.turn ? head.nudge : null,
			reply: reply ? { id: reply.id, text: reply.text.trim() } : null,
			tools: segments.reduce((sum, segment) => sum + segment.tools, 0),
			failed: segments.reduce((sum, segment) => sum + segment.failed, 0),
			running: ends,
		};
		if (previous?.turn && equalBy(TURN_EQUAL, previous.turn, turn)) turn = previous.turn;
	}
	return { start, segments, blocks: blocksOf(items, start, end, previous?.blocks ?? []), turn };
}

/** The index of the region holding item `at`: the last one that starts at or before it. The first starts at 0. */
function regionHolding(regions: readonly Region[], at: number): number {
	let low = 0;
	let high = regions.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (regions[mid]!.start <= at) low = mid;
		else high = mid - 1;
	}
	return low;
}

/** How many leading items `a` and `b` share as the same objects. */
function sharedPrefix(a: readonly Item[], b: readonly Item[]): number {
	const length = Math.min(a.length, b.length);
	let at = 0;
	while (at < length && a[at] === b[at]) at++;
	return at;
}

/** `previous` with its entries from `kept` on replaced by `fresh`; `previous` itself when they are the same objects. */
function withTail<T>(previous: readonly T[], kept: number, fresh: readonly T[]): readonly T[] {
	return fresh.length === previous.length - kept && fresh.every((entry, i) => entry === previous[kept + i]) ? previous : [...previous.slice(0, kept), ...fresh];
}

/**
 * The model of `items` while the transcript works or not, built from `previous`, the model of the same view's items
 * before: the turns before the one holding the first changed item come from it as they are, the same objects included.
 */
export function transcriptModel(items: readonly Item[], working: boolean, previous: TranscriptModel = EMPTY_TRANSCRIPT): TranscriptModel {
	const was = builtFrom.get(previous)!;
	if (items === was.items && working === was.working) return previous;
	const unchanged = items === was.items ? items.length : sharedPrefix(was.items, items);

	// The region holding the last unchanged item is built again, with every one after it: it may have grown, and the last
	// one's reply and running state follow `working`. The ones before it, and the prompt that ends each, are unchanged.
	const from = unchanged === 0 ? 0 : regionHolding(was.regions, unchanged - 1);
	const regions = was.regions.slice(0, from);
	for (let start = was.regions[from]?.start ?? 0; start < items.length; ) {
		let end = start + 1;
		while (end < items.length && !isPrompt(items[end]!)) end++;
		regions.push(regionOf(items, start, end, working && end === items.length, was.regions[regions.length], regions.at(-1)));
		start = end;
	}
	const fresh = regions.slice(from);
	const stale = was.regions.slice(from);

	// The fork points, replies, and images stay the same objects while the rebuilt segments add the same ones.
	const freshSegments = fresh.flatMap(region => region.segments);
	const staleSegments = stale.flatMap(region => region.segments);
	const factsKept = freshSegments.length === staleSegments.length && freshSegments.every((segment, i) => sameFacts(segment, staleSegments[i]!));
	const segments = factsKept ? [] : regions.flatMap(region => region.segments);

	const last = regions.at(-1)?.segments.at(-1);
	const prompt = last?.opener;
	const editable = prompt?.kind === "user" && prompt.entryId && !prompt.skill && !prompt.images?.length && !prompt.files?.length ? { itemId: prompt.id, entryId: prompt.entryId } : null;
	const model: TranscriptModel = {
		blocks: withTail(previous.blocks, previous.blocks.length - stale.reduce((sum, region) => sum + region.blocks.length, 0), fresh.flatMap(region => region.blocks)),
		forks: factsKept ? previous.forks : new Map(segments.flatMap(segment => segment.forks)),
		replies: factsKept ? previous.replies : new Set(segments.flatMap(segment => (segment.reply ? [segment.reply.id] : []))),
		outline: withTail(previous.outline, previous.outline.length - stale.filter(region => region.turn).length, fresh.flatMap(region => (region.turn ? [region.turn] : []))),
		images: factsKept ? previous.images : segments.flatMap(segment => segment.images),
		editable: editable && previous.editable?.itemId === editable.itemId && previous.editable.entryId === editable.entryId ? previous.editable : editable,
	};
	builtFrom.set(model, { items, working, regions });
	return model;
}
