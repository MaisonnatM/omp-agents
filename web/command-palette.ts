import { defaultFilter } from "cmdk";
import { Command, Folder, ListTodo, type LucideIcon } from "lucide-react";
import type { HostStatus } from "../src/shared/sessions";
import { type Chord, type KeyEvent, pressesChord, SHORTCUTS, type Shortcut, type ShortcutHandlers, type ShortcutId } from "./shortcuts";

/** A list the command palette shows: the root search, or a view an action pushed onto it. */
export type PaletteViewId = "root" | "projects" | "createTodo";

export interface PaletteView {
	/** What the footer and the back chip name the view. */
	title: string;
	icon: LucideIcon;
	placeholder: string;
	/** How many of the most used items an empty search leads with. */
	suggestions: number;
}

export const PALETTE_VIEWS: Record<PaletteViewId, PaletteView> = {
	root: { title: "omp agents", icon: Command, placeholder: "Search sessions and commands…", suggestions: 5 },
	projects: { title: "Choose project", icon: Folder, placeholder: "Search projects…", suggestions: 0 },
	createTodo: { title: "Create todo", icon: ListTodo, placeholder: "Todo title, optionally ending in a due day or #category", suggestions: 0 },
};

export type ActionRun =
	| { kind: "do"; fn: () => void }
	| { kind: "push"; view: PaletteViewId }
	| { kind: "link"; href: string; external?: boolean };

/** Something an item does. The palette closes after any action but a `push`, which opens its view instead. */
export interface PaletteAction<Run extends ActionRun = ActionRun> {
	/** Unique among its item's actions. */
	id: string;
	title: string;
	icon: LucideIcon;
	/** Runs the action from the list and the action panel without choosing it. The first two actions take Enter and ⌘Enter instead. */
	chord?: Chord;
	tone?: "destructive";
	disabled?: boolean;
	run: Run;
}

/** Actions a separator sets apart from the next group, in the action panel and in a session row's menu. */
export type ActionGroup<Run extends ActionRun = ActionRun> = readonly PaletteAction<Run>[];

/** What a row shows at its end, before its type label. */
export type Accessory =
	| { kind: "age"; at: number }
	| { kind: "status"; status: HostStatus }
	| { kind: "keys"; labels: readonly string[] }
	| { kind: "text"; text: string };

/** The section an item belongs to; **Suggestions** borrows items from the others. */
export type HomeSection = "running" | "past" | "commands" | "projects" | "createTodo" | "fallback";

export type SectionId = "suggestions" | HomeSection;

export interface PaletteItem {
	/** Stable across reloads, since frecency keys on it: `session:<id>`, `command:<id>`, `project:<cwd>`, `fallback:create-todo`. */
	id: string;
	section: HomeSection;
	title: string;
	subtitle?: string;
	/** Words a search also matches besides the title and subtitle. */
	keywords: readonly string[];
	icon: LucideIcon;
	accessories: readonly Accessory[];
	/** The type label at the row's end: `Session`, `Command`, `Project`. */
	kind: string;
	/** Every action, as the action panel groups them. The first group's first action runs on Enter, so it is never empty. */
	actions: readonly [ActionGroup, ...ActionGroup[]];
}

/** The action Enter runs on `item`. */
export const primaryAction = (item: PaletteItem): PaletteAction => item.actions[0][0]!;

/** ⌘K, which opens and closes the selected item's action panel while the palette is open. */
export const PANEL_CHORD: Chord = { key: "k", mod: true };

export const ENTER: Chord = { key: "Enter" };

/** ⌘Enter, or Ctrl+Enter off macOS, which runs an item's second action. */
export const SECONDARY: Chord = { key: "Enter", mod: true };

/** The chord that runs `action` on `item`: {@link ENTER} for its first action, {@link SECONDARY} for its second, else its own. */
export function actionChord(item: PaletteItem, action: PaletteAction): Chord | undefined {
	const index = item.actions.flat().indexOf(action);
	return index === 0 ? ENTER : index === 1 ? SECONDARY : action.chord;
}

/** The action of `item` that `event` runs by its chord. Enter is left to the list, which runs the highlighted entry. */
export function chordAction(item: PaletteItem, event: KeyEvent, mac?: boolean): PaletteAction | undefined {
	return item.actions.flat().find(action => {
		const chord = actionChord(item, action);
		return chord !== undefined && chord !== ENTER && pressesChord(event, chord, mac);
	});
}

/** One view on the palette's stack, with what was typed in it and the item highlighted there, restored on going back. */
export interface Frame {
	view: PaletteViewId;
	query: string;
	/** The highlighted item's id, or `""` before the list highlights one. */
	selected: string;
}

/** The open palette; `null` stands for a closed one, so each opening starts fresh. */
export interface PaletteState {
	stack: readonly [Frame, ...Frame[]];
	/** The action panel, open on item `itemId`, with its own search. */
	panel: { itemId: string; query: string } | null;
}

export type PaletteEvent =
	| { type: "open"; view?: PaletteViewId }
	| { type: "close" }
	| { type: "query"; query: string }
	| { type: "select"; itemId: string }
	| { type: "push"; view: PaletteViewId }
	| { type: "pop" }
	| { type: "escape" }
	| { type: "backspaceOnEmpty" }
	| { type: "togglePanel" }
	| { type: "panelQuery"; query: string };

type Stack = PaletteState["stack"];

const frame = (view: PaletteViewId): Frame => ({ view, query: "", selected: "" });

export const topFrame = (state: PaletteState): Frame => state.stack[state.stack.length - 1]!;

const withTop = (stack: Stack, change: Partial<Frame>): Stack =>
	stack.map((entry, index) => (index === stack.length - 1 ? { ...entry, ...change } : entry)) as [Frame, ...Frame[]];

const pop = (state: PaletteState): PaletteState =>
	state.stack.length > 1 ? { stack: state.stack.slice(0, -1) as [Frame, ...Frame[]], panel: null } : state;

/**
 * The palette's navigation. Esc closes the action panel, then goes back a view, then clears the search, then closes the
 * palette. Opening on a view other than the root stacks it on the root, so going back from it lands on the search.
 */
export function paletteReducer(state: PaletteState | null, event: PaletteEvent): PaletteState | null {
	if (event.type === "open") {
		return { stack: event.view && event.view !== "root" ? [frame("root"), frame(event.view)] : [frame("root")], panel: null };
	}
	if (state === null) return null;
	switch (event.type) {
		case "close":
			return null;
		case "query":
			return { stack: withTop(state.stack, { query: event.query }), panel: null };
		case "select":
			return { ...state, stack: withTop(state.stack, { selected: event.itemId }) };
		case "push":
			return { stack: [...state.stack, frame(event.view)] as [Frame, ...Frame[]], panel: null };
		case "pop":
			return pop(state);
		case "escape":
			if (state.panel) return { ...state, panel: null };
			if (state.stack.length > 1) return pop(state);
			if (topFrame(state).query) return { ...state, stack: withTop(state.stack, { query: "" }) };
			return null;
		case "backspaceOnEmpty":
			return topFrame(state).query === "" ? pop(state) : state;
		case "togglePanel": {
			const { selected } = topFrame(state);
			return { ...state, panel: state.panel || !selected ? null : { itemId: selected, query: "" } };
		}
		case "panelQuery":
			return state.panel ? { ...state, panel: { ...state.panel, query: event.query } } : state;
	}
}

export const FRECENCY_KEY = "omp-agents.palette-frecency";

export interface FrecencyEntry {
	count: number;
	/** When an action of the item last ran, in ms since the epoch. */
	last: number;
}

/** How often and how lately each palette item's actions ran, by item id. */
export type Frecency = Readonly<Partial<Record<string, FrecencyEntry>>>;

const DAY_MS = 86_400_000;
const HALF_LIFE_DAYS = 7;
/** Entries kept, the most recent; an item gone for good drops out once newer ones crowd it. */
const FRECENCY_CAP = 200;

/** 1 for an item never used, more the more often and the more lately it was, halving each week it rests. */
export function frecencyBoost(entry: FrecencyEntry | undefined, now: number): number {
	if (!entry) return 1;
	const ageDays = Math.max(0, now - entry.last) / DAY_MS;
	return 1 + Math.log1p(entry.count) * 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

/** `frecency` after an action of item `id` ran at `now`. */
export function bumpFrecency(frecency: Frecency, id: string, now: number): Frecency {
	const next: Record<string, FrecencyEntry> = {};
	for (const [key, entry] of Object.entries(frecency)) if (entry) next[key] = entry;
	next[id] = { count: (frecency[id]?.count ?? 0) + 1, last: now };
	const entries = Object.entries(next);
	if (entries.length <= FRECENCY_CAP) return next;
	return Object.fromEntries(entries.toSorted(([, a], [, b]) => b.last - a.last).slice(0, FRECENCY_CAP));
}

export function decodeFrecency(raw: string | null): Frecency {
	try {
		const parsed: unknown = JSON.parse(raw ?? "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const valid = Object.entries(parsed).filter(
			(entry): entry is [string, FrecencyEntry] =>
				typeof entry[1] === "object" && entry[1] !== null && typeof entry[1].count === "number" && typeof entry[1].last === "number",
		);
		return Object.fromEntries(valid.map(([id, { count, last }]) => [id, { count, last }]));
	} catch {
		return {};
	}
}

export interface Section {
	id: SectionId;
	/** `null` for a section that needs no heading, as the one item of Create todo. */
	heading: string | null;
	items: readonly PaletteItem[];
}

/** Sections in the order an empty search lists them. */
const BROWSE_ORDER: readonly SectionId[] = ["suggestions", "running", "commands", "past", "projects", "createTodo", "fallback"];
/** Sections a search ranks by their best match; equal ones keep this order. */
const RANKED_ORDER: readonly HomeSection[] = ["running", "past", "commands", "projects"];
/** Sections that hold what the search itself becomes: they match anything, and list after every match. */
const UNRANKED_ORDER: readonly HomeSection[] = ["createTodo", "fallback"];

const HEADINGS: Record<Exclude<SectionId, "fallback">, string | null> = {
	suggestions: "Suggestions",
	running: "Running",
	past: "Past",
	commands: "Commands",
	projects: "Projects",
	createTodo: null,
};

const headingOf = (id: SectionId, search: string): string | null => (id === "fallback" ? `Use “${search}”` : HEADINGS[id]);

/** cmdk's match of `search` against the item's words, times its frecency boost; 0 when it does not match. */
function matchScore(item: PaletteItem, search: string, frecency: Frecency, now: number): number {
	const words = item.subtitle ? [item.subtitle, ...item.keywords] : [...item.keywords];
	return defaultFilter(item.title, search, words) * frecencyBoost(frecency[item.id], now);
}

/**
 * The sections a view lists for `query`. With nothing typed, the `suggestions` most used items lead, and leave their
 * own sections. With a search, the matches rank by cmdk's score times frecency, within a section and section against
 * section, and what the search itself becomes, such as a todo, lists last.
 */
export function paletteSections(items: readonly PaletteItem[], query: string, frecency: Frecency, now: number, suggestions = 0): Section[] {
	const search = query.trim();
	const inSection = (list: readonly PaletteItem[], id: SectionId): Section => ({ id, heading: headingOf(id, search), items: list.filter(item => item.section === id) });
	const filled = (section: Section): boolean => section.items.length > 0;
	if (!search) {
		const suggested = items
			.filter(item => !UNRANKED_ORDER.includes(item.section) && frecency[item.id])
			.toSorted((a, b) => frecencyBoost(frecency[b.id], now) - frecencyBoost(frecency[a.id], now))
			.slice(0, suggestions);
		const taken = new Set(suggested.map(item => item.id));
		const rest = items.filter(item => !taken.has(item.id));
		return BROWSE_ORDER.map(id => (id === "suggestions" ? { id, heading: headingOf(id, search), items: suggested } : inSection(rest, id))).filter(filled);
	}
	const scores = new Map<string, number>();
	for (const item of items) if (!UNRANKED_ORDER.includes(item.section)) scores.set(item.id, matchScore(item, search, frecency, now));
	const score = (item: PaletteItem): number => scores.get(item.id) ?? 0;
	const ranked = RANKED_ORDER.map(id => {
		const hits = items.filter(item => item.section === id && score(item) > 0).toSorted((a, b) => score(b) - score(a));
		return { id, heading: headingOf(id, search), items: hits };
	})
		.filter(filled)
		.toSorted((a, b) => score(b.items[0]!) - score(a.items[0]!));
	return [...ranked, ...UNRANKED_ORDER.map(id => inSection(items, id)).filter(filled)];
}

export type PaletteCommand = Shortcut & { command: string };

/** The shortcuts the palette lists as commands: those with a `command` title, a handler, and not `unavailable` now. */
export function paletteCommands(handlers: ShortcutHandlers, unavailable: ReadonlySet<ShortcutId>): PaletteCommand[] {
	return SHORTCUTS.filter((shortcut): shortcut is PaletteCommand => shortcut.command !== undefined && handlers[shortcut.id] !== undefined && !unavailable.has(shortcut.id));
}
