import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef } from "react";

export type ShortcutId =
	| "interrupt"
	| "followUp"
	| "dequeue"
	| "switcher"
	| "newSession"
	| "previousSession"
	| "nextSession"
	| "model"
	| "thinking"
	| "tools"
	| "sessionsSidebar"
	| "planSidebar"
	| "settings"
	| "help"
	| "restore"
	| "focusComposer"
	| "inbox"
	| "tickets"
	| "sessions"
	| "todo"
	| "project";

/**
 * Where a binding fires. `composer`: from the composer's textarea, before any page-wide binding sees the key.
 * `outside-fields`: only while no text field has focus, because the key types text. `anywhere`: even while typing, so
 * only ⌘/Ctrl and Alt chords, and an Esc that nothing nearer took, belong there.
 */
export type Scope = "composer" | "outside-fields" | "anywhere";

/** A key plus the modifiers it needs. `mod` is ⌘ on macOS and Ctrl elsewhere, as web apps bind it. */
interface Chord {
	/** A lowercase letter, a printable symbol, or a `KeyboardEvent.key` name such as `Escape`. */
	key: string;
	mod?: true;
	alt?: true;
	/** For letters and named keys only: which symbols need Shift depends on the layout. */
	shift?: true;
}

/** A chord, or G then a key, as GitHub, Gmail, and Linear go to a page. Both keys of a pair type text, so pairs work only outside text fields. */
export type Binding = { chord: Chord; scope: Scope } | { goTo: string };

export interface Shortcut {
	id: ShortcutId;
	label: string;
	keys: readonly Binding[];
}

/** Every dashboard shortcut, in the order a key tries them. The reference dialog lists exactly these. */
export const SHORTCUTS: readonly Shortcut[] = [
	{ id: "interrupt", label: "Interrupt the running turn", keys: [{ chord: { key: "Escape" }, scope: "composer" }] },
	{
		id: "followUp",
		label: "Send once the running turn finishes, as a follow-up (Enter steers it)",
		keys: [{ chord: { key: "Enter", mod: true }, scope: "composer" }],
	},
	{ id: "dequeue", label: "Move the last queued message back into the empty composer", keys: [{ chord: { key: "ArrowUp" }, scope: "composer" }] },
	{ id: "switcher", label: "Jump to a session", keys: [{ chord: { key: "k", mod: true }, scope: "anywhere" }] },
	{ id: "newSession", label: "Start a new session", keys: [{ chord: { key: "o", mod: true, shift: true }, scope: "anywhere" }] },
	{ id: "previousSession", label: "Open the previous session in the sidebar", keys: [{ chord: { key: "ArrowUp", alt: true }, scope: "anywhere" }] },
	{ id: "nextSession", label: "Open the next session in the sidebar", keys: [{ chord: { key: "ArrowDown", alt: true }, scope: "anywhere" }] },
	{ id: "model", label: "Choose the session's model", keys: [{ chord: { key: ".", mod: true }, scope: "anywhere" }] },
	{ id: "thinking", label: "Cycle the thinking level", keys: [{ chord: { key: "j", mod: true }, scope: "anywhere" }] },
	{ id: "tools", label: "Expand or collapse tool calls", keys: [{ chord: { key: "e", mod: true }, scope: "anywhere" }] },
	{ id: "sessionsSidebar", label: "Show or hide the sessions sidebar, on the left", keys: [{ chord: { key: "b", mod: true }, scope: "anywhere" }] },
	{
		id: "planSidebar",
		label: "Show or hide the plan and changes sidebar, on the right",
		keys: [{ chord: { key: "b", mod: true, shift: true }, scope: "anywhere" }],
	},
	{ id: "settings", label: "Open or close settings", keys: [{ chord: { key: ",", mod: true }, scope: "anywhere" }] },
	{
		id: "help",
		label: "Show keyboard shortcuts",
		keys: [
			{ chord: { key: "/", mod: true }, scope: "anywhere" },
			{ chord: { key: "?" }, scope: "outside-fields" },
		],
	},
	{ id: "restore", label: "Restore the split from a maximized pane", keys: [{ chord: { key: "Escape" }, scope: "anywhere" }] },
	{ id: "focusComposer", label: "Focus the composer", keys: [{ chord: { key: "/" }, scope: "outside-fields" }] },
	{ id: "inbox", label: "Go to the pull request inbox", keys: [{ goTo: "i" }] },
	{ id: "tickets", label: "Go to your Linear tickets", keys: [{ goTo: "t" }] },
	{ id: "sessions", label: "Go to the sessions", keys: [{ goTo: "s" }] },
	{ id: "todo", label: "Go to your todo list", keys: [{ goTo: "d" }] },
	{ id: "project", label: "Choose the sidebar's project", keys: [{ goTo: "p" }] },
];

const GO = "g";
/** How long G waits for the key it goes to. */
const GO_TO_MS = 1500;

type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">;

function keyOf({ key, code }: KeyEvent): string {
	if (/^[a-z]$/i.test(key)) return key.toLowerCase();
	// A letter key that types no ASCII character, on a Cyrillic layout or with macOS Option (Option+B types ∫), matches
	// by its physical key. An ASCII symbol matches as typed: AZERTY types `,` and `?` on the M key.
	if (/^Key[A-Z]$/.test(code) && key.length === 1 && key.charCodeAt(0) > 127) return code.slice(3).toLowerCase();
	return key;
}

const plain = (event: KeyEvent): boolean => !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

export const IS_MAC =
	typeof navigator !== "undefined" &&
	/mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "");

export interface Match {
	id: ShortcutId;
	scope: Scope;
}

/**
 * The shortcuts `event` presses, in {@link SHORTCUTS} order. `previous` is the plain key pressed just before outside a
 * text field, which a G pair needs. `mac` reads ⌘ as `mod` instead of Ctrl.
 */
export function shortcutsFor(event: KeyEvent, previous: string | null = null, mac = IS_MAC): Match[] {
	const key = keyOf(event);
	// Which symbols need Shift depends on the layout (`?` is Shift+/ in US, Shift+, in AZERTY), so symbols ignore it.
	const symbol = key.length === 1 && !/[a-z]/.test(key);
	const presses = (binding: Binding): boolean => {
		if ("goTo" in binding) return previous === GO && key === binding.goTo && plain(event);
		const { chord } = binding;
		return (
			chord.key === key &&
			event.metaKey === (mac && !!chord.mod) &&
			event.ctrlKey === (!mac && !!chord.mod) &&
			event.altKey === !!chord.alt &&
			(symbol || event.shiftKey === !!chord.shift)
		);
	};
	return SHORTCUTS.flatMap(({ id, keys }) =>
		keys.filter(presses).map((binding): Match => ({ id, scope: scopeOf(binding) })),
	);
}

export const scopeOf = (binding: Binding): Scope => ("goTo" in binding ? "outside-fields" : binding.scope);

const KEY_LABEL: Record<string, string> = { Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", Enter: IS_MAC ? "↩" : "Enter" };

/** `⇧⌘O` on macOS, `Ctrl+Shift+O` elsewhere, `G then I` for a pair. */
export function bindingLabel(binding: Binding): string {
	if ("goTo" in binding) return `${GO.toUpperCase()} then ${binding.goTo.toUpperCase()}`;
	const { key, mod, alt, shift } = binding.chord;
	const name = KEY_LABEL[key] ?? key.toUpperCase();
	if (IS_MAC) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}${mod ? "⌘" : ""}${name}`;
	return [mod && "Ctrl", alt && "Alt", shift && "Shift", name].filter(Boolean).join("+");
}

const EITHER = new Intl.ListFormat("en", { type: "disjunction" });

/** Every key that runs `id`, as a tooltip names them: `⌘/ or ?`. */
export const shortcutKeys = (id: ShortcutId): string => EITHER.format(SHORTCUTS.find(shortcut => shortcut.id === id)?.keys.map(bindingLabel) ?? []);

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
 * Runs `handlers` for page-wide shortcuts, and returns the key handler a composer's textarea attaches for `composer`
 * ones. That handler runs before the page-wide listener, so Esc interrupts a turn before it restores a split.
 */
export function useShortcuts(handlers: ShortcutHandlers): (event: ReactKeyboardEvent) => void {
	const latest = useRef(handlers);
	latest.current = handlers;
	useEffect(() => {
		const previousKey = pairing();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.isComposing) return;
			const outside = !typing(event.target);
			const previous = previousKey(event, outside);
			dispatch(event, latest.current, scope => scope === "anywhere" || (scope === "outside-fields" && outside), previous);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	return useCallback((event: ReactKeyboardEvent) => {
		if (!event.nativeEvent.isComposing) dispatch(event, latest.current, scope => scope === "composer", null);
	}, []);
}
