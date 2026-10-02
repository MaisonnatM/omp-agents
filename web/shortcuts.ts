import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef } from "react";

export type ShortcutId =
	| "interrupt"
	| "followUp"
	| "dequeue"
	| "end"
	| "model"
	| "thinking"
	| "tools"
	| "sessions"
	| "sessionsSidebar"
	| "subagentsSidebar"
	| "settings"
	| "project"
	| "inbox"
	| "restore"
	| "help";

/**
 * Where a chord fires. `composer`: from the composer's textarea, before any page-wide chord sees the key.
 * `outside-fields`: only while no text field has focus, because the key types text. `anywhere`: even while typing, so
 * only Ctrl and Alt chords, and an Esc that nothing nearer took, belong there.
 */
type Scope = "composer" | "outside-fields" | "anywhere";

/** A key plus the modifiers it needs. ⌘ is part of a chord only as `mod`: the browser owns every other ⌘ key. */
interface Chord {
	/** A lowercase letter, a printable symbol, or a `KeyboardEvent.key` name such as `Escape`. */
	key: string;
	ctrl?: true;
	alt?: true;
	/** ⌘ on macOS, Ctrl elsewhere. For a key whose Ctrl chord macOS takes, as Ctrl+Enter opens a context menu there. */
	mod?: true;
}

export interface Shortcut {
	id: ShortcutId;
	chord: Chord;
	scope: Scope;
	label: string;
	/** The omp action this mirrors and its default chord in the terminal, or `null` for a dashboard-only key. */
	omp: { action: string; chord: string } | null;
}

/** Every dashboard shortcut, in the order a key tries them. The reference dialog lists exactly these. */
export const SHORTCUTS: readonly Shortcut[] = [
	{ id: "interrupt", chord: { key: "Escape" }, scope: "composer", label: "Interrupt the running turn", omp: { action: "Esc", chord: "Esc" } },
	{
		id: "followUp",
		chord: { key: "Enter", mod: true },
		scope: "composer",
		label: "Send once the running turn finishes, as a follow-up (Enter steers it)",
		omp: { action: "app.message.followUp", chord: "Ctrl+Enter" },
	},
	{
		id: "dequeue",
		chord: { key: "ArrowUp", alt: true },
		scope: "composer",
		label: "Move the last queued message back into the composer",
		omp: { action: "app.message.dequeue", chord: "Alt+Up" },
	},
	{
		id: "end",
		chord: { key: "d", ctrl: true },
		scope: "composer",
		label: "End the session, from its empty composer",
		omp: { action: "app.exit", chord: "Ctrl+D" },
	},
	{ id: "model", chord: { key: "p", alt: true }, scope: "anywhere", label: "Choose the session's model", omp: { action: "app.model.selectTemporary", chord: "Alt+P" } },
	{ id: "thinking", chord: { key: "t", alt: true }, scope: "anywhere", label: "Cycle the thinking level", omp: { action: "app.thinking.cycle", chord: "Shift+Tab" } },
	{ id: "tools", chord: { key: "o", ctrl: true }, scope: "anywhere", label: "Expand or collapse tool calls", omp: { action: "app.tools.expand", chord: "Ctrl+O" } },
	{
		id: "sessions",
		chord: { key: "a", alt: true },
		scope: "anywhere",
		label: "Focus the session list, or go back to the pane",
		omp: { action: "app.agents.hub", chord: "Alt+A" },
	},
	{ id: "sessionsSidebar", chord: { key: "l", alt: true }, scope: "anywhere", label: "Show or hide the sessions sidebar, on the left", omp: null },
	{ id: "subagentsSidebar", chord: { key: "r", alt: true }, scope: "anywhere", label: "Show or hide the subagents sidebar, on the right", omp: null },
	{ id: "settings", chord: { key: "m", alt: true }, scope: "anywhere", label: "Open or close model role settings", omp: { action: "app.model.select", chord: "Alt+M" } },
	{ id: "project", chord: { key: "w", alt: true }, scope: "anywhere", label: "Choose the sidebar's project", omp: null },
	{ id: "inbox", chord: { key: "g", alt: true }, scope: "anywhere", label: "Switch between the pull request inbox and the sessions", omp: null },
	{ id: "restore", chord: { key: "Escape" }, scope: "anywhere", label: "Restore the split from a maximized pane", omp: null },
	{ id: "help", chord: { key: "?" }, scope: "outside-fields", label: "Show keyboard shortcuts", omp: { action: "/hotkeys", chord: "/hotkeys" } },
];

type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">;

function keyOf({ key, code }: KeyEvent): string {
	if (key.length !== 1) return key;
	if (/[a-z]/i.test(key)) return key.toLowerCase();
	// Option on macOS composes a character (Option+P types π), so a letter key matches by its physical key.
	return /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : key;
}

export const IS_MAC =
	typeof navigator !== "undefined" &&
	/mac/i.test((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "");

/** The shortcuts `event` presses, in {@link SHORTCUTS} order. `mac` reads ⌘ as `mod` instead of Ctrl. */
export function shortcutsFor(event: KeyEvent, mac = IS_MAC): Shortcut[] {
	const key = keyOf(event);
	// Which symbols need Shift depends on the layout (`?` is Shift+/ in US, Shift+, in AZERTY), so symbols ignore it.
	const symbol = key.length === 1 && !/[a-z]/.test(key);
	return SHORTCUTS.filter(
		({ chord }) =>
			chord.key === key &&
			event.metaKey === (mac && !!chord.mod) &&
			event.ctrlKey === (!!chord.ctrl || (!mac && !!chord.mod)) &&
			event.altKey === !!chord.alt &&
			(symbol || !event.shiftKey),
	);
}

const KEY_LABEL: Record<string, string> = { Escape: "Esc", ArrowUp: "↑", Enter: IS_MAC ? "↩" : "Enter" };

/** `⌥P` on macOS, `Alt+P` elsewhere. */
export function chordLabel({ key, ctrl, alt, mod }: Chord): string {
	const name = KEY_LABEL[key] ?? key.toUpperCase();
	if (IS_MAC) return `${ctrl ? "⌃" : ""}${alt ? "⌥" : ""}${mod ? "⌘" : ""}${name}`;
	return [(ctrl || mod) && "Ctrl", alt && "Alt", name].filter(Boolean).join("+");
}

const typing = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** What to do for each shortcut. Returning `false` means the action does not apply now, so the key keeps its usual meaning. */
export type ShortcutHandlers = Partial<Record<ShortcutId, () => boolean | void>>;

type HandledEvent = KeyEvent & Pick<KeyboardEvent, "defaultPrevented" | "preventDefault">;

/** Runs the first handler in `scopes` that takes the key. A key something nearer already handled is left alone. */
function dispatch(event: HandledEvent, handlers: ShortcutHandlers, inScope: (scope: Scope) => boolean): void {
	if (event.defaultPrevented) return;
	for (const { id, scope } of shortcutsFor(event)) {
		const handler = handlers[id];
		if (handler && inScope(scope) && handler() !== false) {
			event.preventDefault();
			return;
		}
	}
}

/**
 * Runs `handlers` for page-wide chords, and returns the key handler a composer's textarea attaches for `composer`
 * chords. That handler runs before the page-wide listener, so Esc interrupts a turn before it restores a split.
 */
export function useShortcuts(handlers: ShortcutHandlers): (event: ReactKeyboardEvent) => void {
	const latest = useRef(handlers);
	latest.current = handlers;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.isComposing) return;
			dispatch(event, latest.current, scope => scope === "anywhere" || (scope === "outside-fields" && !typing(event.target)));
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
	return useCallback((event: ReactKeyboardEvent) => {
		if (!event.nativeEvent.isComposing) dispatch(event, latest.current, scope => scope === "composer");
	}, []);
}
