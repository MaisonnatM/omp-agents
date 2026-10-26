import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

/** The keys that go to the sidebar's tabs by position: Cmd+1 goes to the first tab the sidebar shows, whichever it is. */
export const TAB_SHORTCUTS = ["tab1", "tab2", "tab3", "tab4", "tab5", "tab6", "tab7", "tab8"] as const;

export type TabShortcut = (typeof TAB_SHORTCUTS)[number];

export type ShortcutId =
	| "interrupt"
	| "steer"
	| "deliverSteer"
	| "dequeue"
	| "switcher"
	| "newSession"
	| "sessionSearch"
	| "endSession"
	| "openPullRequest"
	| "previousSession"
	| "nextSession"
	| "sessionsNext"
	| "sessionsPrevious"
	| "model"
	| "directory"
	| "thinking"
	| "tools"
	| "hideTools"
	| "hideThinking"
	| "sessionsSidebar"
	| "detailsSidebar"
	| "settings"
	| "help"
	| "restore"
	| "focusComposer"
	| "pull-requests"
	| "tickets"
	| "newTicket"
	| "sessions"
	| "todo"
	| "notes"
	| "calendar"
	| "inbox"
	| "routines"
	| "workspace"
	| "nextPullRequest"
	| "previousPullRequest"
	| "pullRequestOnGitHub"
	| "pullRequestActions"
	| "liftPullRequest"
	| "giveToAgent"
	| "copyPullRequestNumber"
	| "copyPullRequestLink"
	| "todoSearch"
	| "todoNext"
	| "todoPrevious"
	| "todoCheck"
	| "todoStatus"
	| "todoPriority"
	| "todoAssignee"
	| "todoDue"
	| "todoNew"
	| "todoClose"
	| "notesSearch"
	| "notesNext"
	| "notesPrevious"
	| "notesNew"
	| "notesClose"
	| "calendarNewEvent"
	| "inboxNext"
	| "inboxPrevious"
	| "inboxClose"
	| "inboxOnGmail"
	| "inboxReply"
	| "inboxReplyAll"
	| "inboxTrash"
	| "inboxCompose"
	| "nextChangedFile"
	| "previousChangedFile"
	| "moveUp"
	| "moveDown"
	| "terminal"
	| "answer"
	| TabShortcut;

/**
 * Where a binding fires. `composer`: from the composer's text field, before any page-wide binding sees the key.
 * `outside-fields`: only while no text field has focus, because the key types text. `anywhere`: even while typing, so
 * only ⌘/Ctrl and Alt chords, and an Esc that nothing nearer took, belong there.
 */
export type Scope = "composer" | "outside-fields" | "anywhere";

/**
 * A key plus the modifiers it needs. `mod` is ⌘ on macOS and Ctrl elsewhere, as web apps bind it; `ctrl` is Ctrl on
 * every platform, as editors bind their terminal.
 */
export interface Chord {
	/** A lowercase letter, a printable symbol, or a `KeyboardEvent.key` name such as `Escape`. */
	key: string;
	mod?: true;
	ctrl?: true;
	alt?: true;
	/** For letters, digits, and named keys only: which symbols need Shift depends on the layout. */
	shift?: true;
}

/** A chord, or G then a key, as GitHub, Gmail, and Linear go to a page. Both keys of a pair type text, so pairs work only outside text fields. */
export type Binding = { chord: Chord; scope: Scope } | { goTo: string };

/** The shortcuts dialog's tabs, in order. */
export const SHORTCUT_CATEGORIES = [
	{ id: "general", label: "General" },
	{ id: "sessions", label: "Sessions" },
	{ id: "pull-requests", label: "Pull requests" },
	{ id: "todo", label: "Todo" },
	{ id: "notes", label: "Notes" },
	{ id: "inbox", label: "Inbox" },
	{ id: "calendar", label: "Calendar" },
	{ id: "changes", label: "Changes" },
] as const;

export type ShortcutCategory = (typeof SHORTCUT_CATEGORIES)[number]["id"];

export interface Shortcut {
	id: ShortcutId;
	/** The shortcuts dialog's tab that lists it. */
	category: ShortcutCategory;
	label: string;
	keys: readonly Binding[];
	/** What the command palette lists the shortcut as, for the page-wide actions it runs: `Go to pull requests`. */
	command?: string;
}

/**
 * Every dashboard shortcut, in the order a key tries them: every binding the key listeners match, and the commands the
 * palette lists. The reference dialog shows `shortcutRows` in `web/sidebar-tabs.ts`, by category: these as the tabs the
 * sidebar shows take the position keys.
 */
export const SHORTCUTS: readonly Shortcut[] = [
	{ id: "interrupt", category: "sessions", label: "Stop the running turn", keys: [{ chord: { key: "Backspace", mod: true, shift: true }, scope: "composer" }] },
	{
		id: "steer",
		category: "sessions",
		label: "Send now, steering the running turn (Enter queues a follow-up)",
		keys: [{ chord: { key: "Enter", mod: true }, scope: "composer" }],
	},
	{
		id: "deliverSteer",
		category: "sessions",
		label: "Deliver the queued steer now (on the empty composer)",
		keys: [{ chord: { key: "Enter", mod: true }, scope: "composer" }],
	},
	{ id: "dequeue", category: "sessions", label: "Move the last queued message back into the empty composer", keys: [{ chord: { key: "ArrowUp" }, scope: "composer" }] },
	{ id: "switcher", category: "general", label: "Open the command menu", keys: [{ chord: { key: "k", mod: true }, scope: "anywhere" }] },
	{
		id: "newSession",
		category: "sessions",
		label: "Start a new session",
		command: "New session",
		keys: [
			{ chord: { key: "n", mod: true }, scope: "anywhere" },
			{ chord: { key: "s" }, scope: "outside-fields" },
		],
	},
	{ id: "sessionSearch", category: "sessions", label: "Search the sidebar's sessions", keys: [{ chord: { key: "f", mod: true }, scope: "anywhere" }] },
	{ id: "endSession", category: "sessions", label: "End the focused session", keys: [{ chord: { key: "x", mod: true, shift: true }, scope: "anywhere" }] },
	{ id: "openPullRequest", category: "sessions", label: "Review, push, and open a pull request for the focused session's branch", command: "Open pull request", keys: [] },
	{
		id: "previousSession",
		category: "sessions",
		label: "Open the previous session in the sidebar",
		command: "Open previous session",
		keys: [{ chord: { key: "[", mod: true }, scope: "anywhere" }],
	},
	{ id: "nextSession", category: "sessions", label: "Open the next session in the sidebar", command: "Open next session", keys: [{ chord: { key: "]", mod: true }, scope: "anywhere" }] },
	{ id: "sessionsNext", category: "sessions", label: "Sessions: open the next session in the sidebar", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "sessionsPrevious", category: "sessions", label: "Sessions: open the previous session in the sidebar", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "model", category: "sessions", label: "Choose the session's model", keys: [{ chord: { key: "/", mod: true, alt: true }, scope: "anywhere" }] },
	{ id: "directory", category: "sessions", label: "Choose the session's working directory", keys: [{ chord: { key: "p", mod: true, alt: true }, scope: "anywhere" }] },
	{ id: "thinking", category: "sessions", label: "Cycle the thinking level", keys: [{ chord: { key: "Tab", shift: true }, scope: "composer" }] },
	{ id: "tools", category: "sessions", label: "Expand or collapse tool calls", command: "Toggle tool calls", keys: [{ chord: { key: "e", mod: true }, scope: "anywhere" }] },
	{
		id: "hideTools",
		category: "sessions",
		label: "Show or hide tool calls",
		command: "Show or hide tool calls",
		keys: [{ chord: { key: "e", mod: true, shift: true }, scope: "anywhere" }],
	},
	{
		id: "hideThinking",
		category: "sessions",
		label: "Show or hide thinking",
		command: "Show or hide thinking",
		keys: [{ chord: { key: "t", alt: true }, scope: "anywhere" }],
	},
	{
		id: "sessionsSidebar",
		category: "general",
		label: "Show or hide the sessions sidebar, on the left",
		command: "Toggle sessions sidebar",
		keys: [{ chord: { key: "b", mod: true }, scope: "anywhere" }],
	},
	{
		id: "detailsSidebar",
		category: "sessions",
		label: "Show or hide the session details sidebar, on the right",
		command: "Toggle details sidebar",
		keys: [{ chord: { key: "b", mod: true, alt: true }, scope: "anywhere" }],
	},
	{ id: "settings", category: "general", label: "Open or close settings", command: "Toggle settings", keys: [] },
	{ id: "help", category: "general", label: "Show keyboard shortcuts", command: "Show keyboard shortcuts", keys: [{ chord: { key: "?" }, scope: "outside-fields" }] },
	{ id: "restore", category: "sessions", label: "Restore the split from a maximized pane", keys: [{ chord: { key: "Escape" }, scope: "anywhere" }] },
	{
		id: "focusComposer",
		category: "sessions",
		label: "Focus the composer",
		keys: [
			{ chord: { key: "/" }, scope: "outside-fields" },
			{ chord: { key: "i", mod: true }, scope: "anywhere" },
		],
	},
	{
		id: "answer",
		category: "sessions",
		label: "Answer the focused session's question with the option of that number",
		keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key): Binding => ({ chord: { key }, scope: "outside-fields" })),
	},
	// No one reads these rows' labels, by design: the dialog lists each position key on the tab it goes to, and the palette lists no command for them.
	...TAB_SHORTCUTS.map((id, index): Shortcut => ({ id, category: "general", label: `Go to tab ${index + 1} of the sidebar`, keys: [{ chord: { key: String(index + 1), mod: true }, scope: "anywhere" }] })),
	{ id: "pull-requests", category: "general", label: "Go to Pull requests", command: "Go to pull requests", keys: [] },
	{ id: "tickets", category: "general", label: "Go to your Linear tickets", command: "Go to tickets", keys: [] },
	{ id: "newTicket", category: "general", label: "Create a Linear ticket, except on the Todo, Notes, Calendar, and Inbox pages", command: "Create ticket", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "sessions", category: "general", label: "Go to the sessions", command: "Go to sessions", keys: [] },
	{ id: "todo", category: "general", label: "Go to your todo list", command: "Go to todo list", keys: [] },
	{ id: "notes", category: "general", label: "Go to your notes", command: "Go to notes", keys: [{ goTo: "n" }] },
	{ id: "calendar", category: "general", label: "Go to your calendar", command: "Go to calendar", keys: [] },
	{ id: "inbox", category: "general", label: "Go to your Gmail inbox", command: "Open inbox", keys: [{ goTo: "i" }] },
	// After a G, R is also the Inbox page's `inboxReply`: the page outranks the App, so G then R replies while a conversation is open.
	{ id: "routines", category: "general", label: "Go to your routines", command: "Go to routines", keys: [{ goTo: "r" }] },
	{ id: "workspace", category: "general", label: "Choose the sidebar's workspace", keys: [{ goTo: "w" }] },
	{ id: "nextPullRequest", category: "pull-requests", label: "Pull requests: move to the next pull request, or show its details while one shows", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "previousPullRequest", category: "pull-requests", label: "Pull requests: move to the previous pull request, or show its details while one shows", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "pullRequestOnGitHub", category: "pull-requests", label: "Pull requests: open the pull request on GitHub", keys: [{ chord: { key: "o" }, scope: "outside-fields" }] },
	{ id: "pullRequestActions", category: "pull-requests", label: "Pull requests: open the pull request's actions menu", keys: [{ chord: { key: "." }, scope: "outside-fields" }] },
	{
		id: "liftPullRequest",
		category: "pull-requests",
		label: "Pull requests board: pick up the focused card, then ← and → choose a column, Space or Enter drops it there, and Esc puts it back",
		keys: [{ chord: { key: " " }, scope: "outside-fields" }],
	},
	{ id: "giveToAgent", category: "pull-requests", label: "Pull requests: give the pull request's next move to an agent, through its quick action", keys: [{ chord: { key: "e" }, scope: "outside-fields" }] },
	{ id: "copyPullRequestNumber", category: "pull-requests", label: "Open pull request: copy #N", keys: [{ chord: { key: "k", mod: true, shift: true }, scope: "anywhere" }] },
	{ id: "copyPullRequestLink", category: "pull-requests", label: "Open pull request: copy its GitHub link", keys: [{ chord: { key: "c", mod: true, shift: true }, scope: "anywhere" }] },
	{ id: "todoSearch", category: "todo", label: "Search the Todo page's todos", keys: [{ chord: { key: "/" }, scope: "outside-fields" }] },
	{ id: "todoNext", category: "todo", label: "Focus the next todo, or open it while a todo is open", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "todoPrevious", category: "todo", label: "Focus the previous todo, or open it while a todo is open", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "todoCheck", category: "todo", label: "Mark the focused or open todo Done, or a closed one Todo again", keys: [{ chord: { key: "x" }, scope: "outside-fields" }] },
	{ id: "todoStatus", category: "todo", label: "Change the focused or open todo's status", keys: [{ chord: { key: "s" }, scope: "outside-fields" }] },
	{ id: "todoPriority", category: "todo", label: "Change the focused or open todo's priority", keys: [{ chord: { key: "p" }, scope: "outside-fields" }] },
	{ id: "todoAssignee", category: "todo", label: "Change the focused or open todo's assignee", keys: [{ chord: { key: "a" }, scope: "outside-fields" }] },
	{ id: "todoDue", category: "todo", label: "Change the focused or open todo's due day", keys: [{ chord: { key: "d", shift: true }, scope: "outside-fields" }] },
	{ id: "todoNew", category: "todo", label: "Add a todo to the Todo group", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "todoClose", category: "todo", label: "Close the open todo", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
	{ id: "notesSearch", category: "notes", label: "Search the Notes page's notes", keys: [{ chord: { key: "/" }, scope: "outside-fields" }] },
	{ id: "notesNext", category: "notes", label: "Focus the next note, or open it while a note is open", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "notesPrevious", category: "notes", label: "Focus the previous note, or open it while a note is open", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "notesNew", category: "notes", label: "Add a note and open it", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "notesClose", category: "notes", label: "Close the open note", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
	{ id: "calendarNewEvent", category: "calendar", label: "Calendar: add an event", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "inboxNext", category: "inbox", label: "Inbox: focus the next conversation, or open it while a conversation is open", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "inboxPrevious", category: "inbox", label: "Inbox: focus the previous conversation, or open it while a conversation is open", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "inboxClose", category: "inbox", label: "Inbox: close the open conversation", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
	{ id: "inboxOnGmail", category: "inbox", label: "Inbox: open the focused or open conversation in Gmail", keys: [{ chord: { key: "o" }, scope: "outside-fields" }] },
	{ id: "inboxReply", category: "inbox", label: "Inbox: reply to the open conversation's last message", keys: [{ chord: { key: "r" }, scope: "outside-fields" }] },
	{ id: "inboxReplyAll", category: "inbox", label: "Inbox: reply to everyone on the open conversation's last message", keys: [{ chord: { key: "a" }, scope: "outside-fields" }] },
	{ id: "inboxTrash", category: "inbox", label: "Inbox: move the open conversation to Gmail's Trash", keys: [{ chord: { key: "#" }, scope: "outside-fields" }] },
	{ id: "inboxCompose", category: "inbox", label: "Inbox: write a new mail", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "nextChangedFile", category: "changes", label: "Changes: open the next changed file", keys: [{ chord: { key: "ArrowDown" }, scope: "outside-fields" }] },
	{ id: "previousChangedFile", category: "changes", label: "Changes: open the previous changed file", keys: [{ chord: { key: "ArrowUp" }, scope: "outside-fields" }] },
	{ id: "moveUp", category: "todo", label: "Move the focused todo, or the focused repository, section, or pull request of the pull request list, up", keys: [{ chord: { key: "ArrowUp", alt: true, shift: true }, scope: "anywhere" }] },
	{ id: "moveDown", category: "todo", label: "Move the focused todo, or the focused repository, section, or pull request of the pull request list, down", keys: [{ chord: { key: "ArrowDown", alt: true, shift: true }, scope: "anywhere" }] },
	{ id: "terminal", category: "general", label: "Show or hide the terminal", command: "Toggle terminal", keys: [{ chord: { key: "`", ctrl: true }, scope: "anywhere" }] },
];

const GO = "g";
/** How long G waits for the key it goes to. */
const GO_TO_MS = 1500;

/** The parts of a DOM or React key press that a chord reads. */
export type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">;

function keyOf({ key, code, metaKey, ctrlKey }: KeyEvent): string {
	// AZERTY needs physical number-row keys for shortcuts; unmodified symbols must still match as typed.
	if ((metaKey || ctrlKey) && /^Digit[0-9]$/.test(code)) return code.slice(5);
	if (/^[a-z]$/i.test(key)) return key.toLowerCase();
	// A letter key, or the / key, that types no ASCII character, on a Cyrillic layout or with macOS Option (Option+B
	// types ∫, Option+/ types ÷), matches by its physical key. An ASCII symbol matches as typed: AZERTY types `,` and `?`
	// on the M key.
	if (key.length === 1 && key.charCodeAt(0) > 127) {
		if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
		if (code === "Slash") return "/";
	}
	return key;
}

const plain = (event: KeyEvent): boolean => !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

export const IS_MAC =
	typeof navigator !== "undefined" &&
	/mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "");

/** Whether `event` holds ⌘ on macOS, where Ctrl-click opens the context menu, or Ctrl elsewhere. */
export const modHeld = (event: { metaKey: boolean; ctrlKey: boolean }): boolean => (IS_MAC ? event.metaKey : event.ctrlKey);

export interface Match {
	id: ShortcutId;
	scope: Scope;
	/** Which of the shortcut's keys was pressed: its place in the shortcut's `keys`. */
	key: number;
}

/** Whether `event` presses `chord`. `mac` reads ⌘ as `mod` instead of Ctrl. */
export function pressesChord(event: KeyEvent, chord: Chord, mac = IS_MAC): boolean {
	const key = keyOf(event);
	// Which symbols need Shift depends on the layout (`?` is Shift+/ in US, Shift+, in AZERTY), so symbols ignore it.
	const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
	return (
		chord.key === key &&
		event.metaKey === (mac && !!chord.mod) &&
		event.ctrlKey === (!!chord.ctrl || (!mac && !!chord.mod)) &&
		event.altKey === !!chord.alt &&
		(symbol || event.shiftKey === !!chord.shift)
	);
}

/**
 * The shortcuts `event` presses, in {@link SHORTCUTS} order. `previous` is the plain key pressed just before outside a
 * text field, which a G pair needs. `mac` reads ⌘ as `mod` instead of Ctrl.
 */
export function shortcutsFor(event: KeyEvent, previous: string | null = null, mac = IS_MAC): Match[] {
	const presses = (binding: Binding): boolean =>
		"goTo" in binding ? previous === GO && keyOf(event) === binding.goTo && plain(event) : pressesChord(event, binding.chord, mac);
	return SHORTCUTS.flatMap(({ id, keys }) =>
		keys.flatMap((binding, key): Match[] => (presses(binding) ? [{ id, scope: scopeOf(binding), key }] : [])),
	);
}

export const scopeOf = (binding: Binding): Scope => ("goTo" in binding ? "outside-fields" : binding.scope);

const KEY_LABEL: Record<string, string> = {
	Escape: "Esc",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Enter: IS_MAC ? "↩" : "Enter",
	Backspace: IS_MAC ? "⌫" : "Backspace",
	Tab: IS_MAC ? "⇥" : "Tab",
	" ": "Space",
};

/** `⇧⌘X` on macOS, `Ctrl+Shift+X` elsewhere. */
export function chordLabel({ key, mod, ctrl, alt, shift }: Chord): string {
	const name = KEY_LABEL[key] ?? key.toUpperCase();
	if (IS_MAC) return `${ctrl ? "⌃" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`;
	return [(mod || ctrl) && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
}

/** {@link chordLabel}, or `G then R` for a pair. */
export function bindingLabel(binding: Binding): string {
	if ("goTo" in binding) return `${GO.toUpperCase()} then ${binding.goTo.toUpperCase()}`;
	return chordLabel(binding.chord);
}

const EITHER = new Intl.ListFormat("en", { type: "disjunction" });

const KEYS = {} as Record<ShortcutId, readonly Binding[]>;
const LABELS = {} as Record<ShortcutId, readonly string[]>;
for (const { id, keys } of SHORTCUTS) {
	KEYS[id] = keys;
	LABELS[id] = keys.map(bindingLabel);
}

/** Every key that runs `id`: `[{ goTo: "i" }]`. */
export const shortcutBindings = (id: ShortcutId): readonly Binding[] => KEYS[id];

/** Every key that runs `id`, one label each, as a tooltip's chips draw them: `["⌘/", "?"]`. */
export const shortcutLabels = (id: ShortcutId): readonly string[] => LABELS[id];

/** Every key that runs `id`, as prose names them: `⌘/ or ?`. */
export const shortcutKeys = (id: ShortcutId): string => EITHER.format(shortcutLabels(id));

const typing = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * What one shortcut does, given which of its keys was pressed, its place in the shortcut's `keys`. Returning `false`
 * means the action does not apply now, so the key keeps its usual meaning.
 */
export type ShortcutHandler = (key: number) => boolean | void;

/** What to do for each shortcut. */
export type ShortcutHandlers = Partial<Record<ShortcutId, ShortcutHandler>>;

type HandledEvent = KeyEvent & Pick<KeyboardEvent, "defaultPrevented" | "preventDefault">;

/** Runs the first handler in scope that takes the key. A key something nearer already handled is left alone. */
function dispatch(event: HandledEvent, handlers: ShortcutHandlers, inScope: (scope: Scope) => boolean, previous: string | null): void {
	if (event.defaultPrevented) return;
	for (const { id, scope, key } of shortcutsFor(event, previous)) {
		const handler = handlers[id];
		if (handler && inScope(scope) && handler(key) !== false) {
			event.preventDefault();
			return;
		}
	}
}

/**
 * Feed it every key the page sees; it returns the key a G pair can complete with: the plain key pressed just before
 * outside a text field, within {@link GO_TO_MS}. A key typed into a field, or any chord, breaks the pair.
 */
export function pairing(): (event: KeyEvent & Pick<KeyboardEvent, "timeStamp">, outsideFields: boolean) => string | null {
	let last: { key: string; at: number } | null = null;
	return (event, outsideFields) => {
		const previous = last && event.timeStamp - last.at < GO_TO_MS ? last.key : null;
		last = outsideFields && plain(event) ? { key: keyOf(event), at: event.timeStamp } : null;
		return previous;
	};
}

/**
 * Every `useShortcuts` of the page, tried for each key press by precedence: the highest rank first, and the first
 * handler that takes the key ends the press. A rank is assigned when its component first renders, so a component
 * renders after the ones that contain it and mounts after the ones already on the page: a page beats the App's
 * shared bindings, and a dialog beats the page under it. Within one rank, {@link SHORTCUTS} order decides.
 */
export interface ShortcutStack {
	/** Registers the handlers `read` returns at `rank`. Returns what removes them. */
	add(rank: number, read: () => ShortcutHandlers): () => void;
	/** Offers a key press to each registration in turn. `outside` is whether no text field has focus; `previous` is the key a G pair completes with. */
	dispatch(event: HandledEvent, outside: boolean, previous: string | null): void;
	readonly size: number;
}

export function createShortcutStack(): ShortcutStack {
	const entries: { rank: number; read: () => ShortcutHandlers }[] = [];
	return {
		add(rank, read) {
			const entry = { rank, read };
			entries.push(entry);
			entries.sort((a, b) => b.rank - a.rank);
			return () => {
				entries.splice(entries.indexOf(entry), 1);
			};
		},
		dispatch(event, outside, previous) {
			const inScope = (scope: Scope): boolean => scope === "anywhere" || (scope === "outside-fields" && outside);
			for (const { read } of entries) {
				if (event.defaultPrevented) return;
				dispatch(event, read(), inScope, previous);
			}
		},
		get size() {
			return entries.length;
		},
	};
}

const stack = createShortcutStack();
const nextKey = pairing();
let ranks = 0;

/** The page's one keydown listener, attached while any component registers shortcuts. */
function onKeyDown(event: KeyboardEvent): void {
	if (event.isComposing) return;
	const outside = !typing(event.target);
	stack.dispatch(event, outside, nextKey(event, outside));
}

/**
 * Runs `handlers` for page-wide shortcuts, and returns the key handler a composer's text field attaches for `composer`
 * ones. That handler runs before the page-wide listener, so a composer binding wins over a page-wide one on the same key.
 * Page-wide handlers share one window listener and try in the order of {@link ShortcutStack}.
 */
export function useShortcuts(handlers: ShortcutHandlers): (event: ReactKeyboardEvent) => void {
	const latest = useRef(handlers);
	latest.current = handlers;
	const [rank] = useState(() => ++ranks);
	useEffect(() => {
		const remove = stack.add(rank, () => latest.current);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			remove();
			if (stack.size === 0) window.removeEventListener("keydown", onKeyDown);
		};
	}, [rank]);
	return useCallback((event: ReactKeyboardEvent) => {
		if (!event.nativeEvent.isComposing) dispatch(event, latest.current, scope => scope === "composer", null);
	}, []);
}
