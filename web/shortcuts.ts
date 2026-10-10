import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

export type ShortcutId =
	| "interrupt"
	| "steer"
	| "deliverSteer"
	| "dequeue"
	| "switcher"
	| "newSession"
	| "endSession"
	| "previousSession"
	| "nextSession"
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
	| "inbox"
	| "tickets"
	| "newTicket"
	| "sessions"
	| "todo"
	| "calendar"
	| "routines"
	| "project"
	| "nextPullRequest"
	| "previousPullRequest"
	| "pullRequestOnGitHub"
	| "pullRequestActions"
	| "giveToAgent"
	| "todoSearch"
	| "todoNext"
	| "todoPrevious"
	| "todoCheck"
	| "todoStatus"
	| "todoPriority"
	| "todoDue"
	| "todoNew"
	| "todoClose"
	| "nextChangedFile"
	| "previousChangedFile"
	| "moveUp"
	| "moveDown"
	| "terminal";

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

export interface Shortcut {
	id: ShortcutId;
	label: string;
	keys: readonly Binding[];
	/** What the command palette lists the shortcut as, for the page-wide actions it runs: `Go to inbox`. */
	command?: string;
}

/** Every dashboard shortcut, in the order a key tries them. The reference dialog lists exactly these. */
export const SHORTCUTS: readonly Shortcut[] = [
	{ id: "interrupt", label: "Stop the running turn", keys: [{ chord: { key: "Backspace", mod: true, shift: true }, scope: "composer" }] },
	{
		id: "steer",
		label: "Send now, steering the running turn (Enter queues a follow-up)",
		keys: [{ chord: { key: "Enter", mod: true }, scope: "composer" }],
	},
	{
		id: "deliverSteer",
		label: "Deliver the queued steer now (on the empty composer)",
		keys: [{ chord: { key: "Enter", mod: true }, scope: "composer" }],
	},
	{ id: "dequeue", label: "Move the last queued message back into the empty composer", keys: [{ chord: { key: "ArrowUp" }, scope: "composer" }] },
	{ id: "switcher", label: "Open the command menu", keys: [{ chord: { key: "k", mod: true }, scope: "anywhere" }] },
	{ id: "newSession", label: "Start a new session", command: "New session", keys: [{ chord: { key: "o", mod: true, shift: true }, scope: "anywhere" }] },
	{ id: "endSession", label: "End the focused session", keys: [{ chord: { key: "x", mod: true, shift: true }, scope: "anywhere" }] },
	{
		id: "previousSession",
		label: "Open the previous session in the sidebar",
		command: "Open previous session",
		keys: [{ chord: { key: "[", mod: true }, scope: "anywhere" }],
	},
	{ id: "nextSession", label: "Open the next session in the sidebar", command: "Open next session", keys: [{ chord: { key: "]", mod: true }, scope: "anywhere" }] },
	{ id: "model", label: "Choose the session's model", keys: [{ chord: { key: "/", mod: true, alt: true }, scope: "anywhere" }] },
	{ id: "directory", label: "Choose the session's working directory", keys: [{ chord: { key: "p", mod: true, alt: true }, scope: "anywhere" }] },
	{ id: "thinking", label: "Cycle the thinking level", keys: [{ chord: { key: "Tab", shift: true }, scope: "composer" }] },
	{ id: "tools", label: "Expand or collapse tool calls", command: "Toggle tool calls", keys: [{ chord: { key: "e", mod: true }, scope: "anywhere" }] },
	{
		id: "hideTools",
		label: "Show or hide tool calls",
		command: "Show or hide tool calls",
		keys: [{ chord: { key: "e", mod: true, shift: true }, scope: "anywhere" }],
	},
	{
		id: "hideThinking",
		label: "Show or hide thinking",
		command: "Show or hide thinking",
		keys: [{ chord: { key: "t", alt: true }, scope: "anywhere" }],
	},
	{
		id: "sessionsSidebar",
		label: "Show or hide the sessions sidebar, on the left",
		command: "Toggle sessions sidebar",
		keys: [{ chord: { key: "b", mod: true }, scope: "anywhere" }],
	},
	{
		id: "detailsSidebar",
		label: "Show or hide the session details sidebar, on the right",
		command: "Toggle details sidebar",
		keys: [{ chord: { key: "b", mod: true, alt: true }, scope: "anywhere" }],
	},
	{ id: "settings", label: "Open or close settings", command: "Toggle settings", keys: [{ chord: { key: "6", mod: true }, scope: "anywhere" }] },
	{ id: "help", label: "Show keyboard shortcuts", command: "Show keyboard shortcuts", keys: [{ chord: { key: "?" }, scope: "outside-fields" }] },
	{ id: "restore", label: "Restore the split from a maximized pane", keys: [{ chord: { key: "Escape" }, scope: "anywhere" }] },
	{
		id: "focusComposer",
		label: "Focus the composer",
		keys: [
			{ chord: { key: "/" }, scope: "outside-fields" },
			{ chord: { key: "i", mod: true }, scope: "anywhere" },
		],
	},
	{ id: "inbox", label: "Go to the pull request inbox", command: "Go to inbox", keys: [{ chord: { key: "1", mod: true }, scope: "anywhere" }] },
	{ id: "tickets", label: "Go to your Linear tickets", command: "Go to tickets", keys: [{ chord: { key: "2", mod: true }, scope: "anywhere" }] },
	{ id: "newTicket", label: "Create a Linear ticket, except on the Todo page", command: "Create ticket", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "sessions", label: "Go to the sessions", command: "Go to sessions", keys: [{ chord: { key: "3", mod: true }, scope: "anywhere" }] },
	{ id: "todo", label: "Go to your todo list", command: "Go to todo list", keys: [{ chord: { key: "4", mod: true }, scope: "anywhere" }] },
	{ id: "calendar", label: "Go to your calendar", command: "Go to calendar", keys: [{ chord: { key: "5", mod: true }, scope: "anywhere" }] },
	{ id: "routines", label: "Go to your routines", command: "Go to routines", keys: [{ goTo: "r" }] },
	{ id: "project", label: "Choose the sidebar's project", keys: [{ goTo: "p" }] },
	{ id: "nextPullRequest", label: "Inbox: move to the next pull request, or show its details while one shows", keys: [{ chord: { key: "j" }, scope: "outside-fields" }] },
	{ id: "previousPullRequest", label: "Inbox: move to the previous pull request, or show its details while one shows", keys: [{ chord: { key: "k" }, scope: "outside-fields" }] },
	{ id: "pullRequestOnGitHub", label: "Inbox: open the pull request on GitHub", keys: [{ chord: { key: "o" }, scope: "outside-fields" }] },
	{ id: "pullRequestActions", label: "Inbox: open the pull request's quick actions", keys: [{ chord: { key: "." }, scope: "outside-fields" }] },
	{ id: "giveToAgent", label: "Inbox: give the pull request's next move to an agent, through its quick action", keys: [{ chord: { key: "e" }, scope: "outside-fields" }] },
	{ id: "todoSearch", label: "Search the Todo page's todos", keys: [{ chord: { key: "/" }, scope: "outside-fields" }] },
	{
		id: "todoNext",
		label: "Focus the next todo, or open it while a todo is open",
		keys: [
			{ chord: { key: "j" }, scope: "outside-fields" },
			{ chord: { key: "ArrowDown" }, scope: "outside-fields" },
		],
	},
	{
		id: "todoPrevious",
		label: "Focus the previous todo, or open it while a todo is open",
		keys: [
			{ chord: { key: "k" }, scope: "outside-fields" },
			{ chord: { key: "ArrowUp" }, scope: "outside-fields" },
		],
	},
	{ id: "todoCheck", label: "Mark the focused or open todo Done, or a closed one Todo again", keys: [{ chord: { key: "x" }, scope: "outside-fields" }] },
	{ id: "todoStatus", label: "Change the focused or open todo's status", keys: [{ chord: { key: "s" }, scope: "outside-fields" }] },
	{ id: "todoPriority", label: "Change the focused or open todo's priority", keys: [{ chord: { key: "p" }, scope: "outside-fields" }] },
	{ id: "todoDue", label: "Change the focused or open todo's due day", keys: [{ chord: { key: "d", shift: true }, scope: "outside-fields" }] },
	{ id: "todoNew", label: "Add a todo to the Todo group", keys: [{ chord: { key: "c" }, scope: "outside-fields" }] },
	{ id: "todoClose", label: "Close the open todo", keys: [{ chord: { key: "Escape" }, scope: "outside-fields" }] },
	{ id: "nextChangedFile", label: "Changes: open the next changed file", keys: [{ chord: { key: "j" }, scope: "outside-fields" }] },
	{ id: "previousChangedFile", label: "Changes: open the previous changed file", keys: [{ chord: { key: "k" }, scope: "outside-fields" }] },
	{ id: "moveUp", label: "Move the focused todo, or the inbox's focused repository, section, or pull request, up", keys: [{ chord: { key: "ArrowUp", alt: true, shift: true }, scope: "anywhere" }] },
	{ id: "moveDown", label: "Move the focused todo, or the inbox's focused repository, section, or pull request, down", keys: [{ chord: { key: "ArrowDown", alt: true, shift: true }, scope: "anywhere" }] },
	{ id: "terminal", label: "Show or hide the terminal", command: "Toggle terminal", keys: [{ chord: { key: "`", ctrl: true }, scope: "anywhere" }] },
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
		keys.filter(presses).map((binding): Match => ({ id, scope: scopeOf(binding) })),
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
};

/** `⇧⌘O` on macOS, `Ctrl+Shift+O` elsewhere. */
export function chordLabel({ key, mod, ctrl, alt, shift }: Chord): string {
	const name = KEY_LABEL[key] ?? key.toUpperCase();
	if (IS_MAC) return `${ctrl ? "⌃" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`;
	return [(mod || ctrl) && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
}

/** {@link chordLabel}, or `G then P` for a pair. */
export function bindingLabel(binding: Binding): string {
	if ("goTo" in binding) return `${GO.toUpperCase()} then ${binding.goTo.toUpperCase()}`;
	return chordLabel(binding.chord);
}

const EITHER = new Intl.ListFormat("en", { type: "disjunction" });

const LABELS = {} as Record<ShortcutId, readonly string[]>;
for (const { id, keys } of SHORTCUTS) LABELS[id] = keys.map(bindingLabel);

/** Every key that runs `id`, one label each, as a tooltip's chips draw them: `["⌘/", "?"]`. */
export const shortcutLabels = (id: ShortcutId): readonly string[] => LABELS[id];

/** Every key that runs `id`, as prose names them: `⌘/ or ?`. */
export const shortcutKeys = (id: ShortcutId): string => EITHER.format(shortcutLabels(id));

const typing = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** What to do for each shortcut. Returning `false` means the action does not apply now, so the key keeps its usual meaning. */
export type ShortcutHandlers = Partial<Record<ShortcutId, () => boolean | void>>;

type HandledEvent = KeyEvent & Pick<KeyboardEvent, "defaultPrevented" | "preventDefault">;

/** Runs the first handler in scope that takes the key. A key something nearer already handled is left alone. */
function dispatch(event: HandledEvent, handlers: ShortcutHandlers, inScope: (scope: Scope) => boolean, previous: string | null): void {
	if (event.defaultPrevented) return;
	for (const { id, scope } of shortcutsFor(event, previous)) {
		const handler = handlers[id];
		if (handler && inScope(scope) && handler() !== false) {
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
