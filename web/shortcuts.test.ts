import { expect, test } from "bun:test";
import { createShortcutStack, IS_MAC, pairing, type ShortcutHandlers, shortcutsFor } from "./shortcuts";

type Mods = { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean };
const keyEvent = (key: string, code: string, mods: Mods = {}) => ({
	key,
	code,
	ctrlKey: !!mods.ctrl,
	altKey: !!mods.alt,
	metaKey: !!mods.meta,
	shiftKey: !!mods.shift,
});
const pressOn = (mac: boolean, key: string, code: string, mods: Mods = {}, previous: string | null = null) =>
	shortcutsFor(keyEvent(key, code, mods), previous, mac).map(({ id }) => id);
const press = (key: string, code: string, mods: Mods = {}) => pressOn(false, key, code, mods);

test("mod is ⌘ on macOS and Ctrl elsewhere, and a chord needs exactly its modifiers", () => {
	expect(press("b", "KeyB", { ctrl: true })).toEqual(["sessionsSidebar"]);
	expect(pressOn(true, "b", "KeyB", { meta: true })).toEqual(["sessionsSidebar"]);
	expect(press("b", "KeyB", { meta: true })).toEqual([]);
	expect(pressOn(true, "b", "KeyB", { ctrl: true })).toEqual([]);
	expect(press("b", "KeyB", { ctrl: true, alt: true })).toEqual(["detailsSidebar"]);
	expect(pressOn(true, "b", "KeyB", { meta: true, alt: true })).toEqual(["detailsSidebar"]);
	expect(press("B", "KeyB", { ctrl: true, shift: true })).toEqual([]);
	expect(press("O", "KeyO", { ctrl: true, shift: true })).toEqual(["newSession"]);
	expect(press("k", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(press("e", "KeyE", { ctrl: true })).toEqual(["tools"]);
	expect(press("E", "KeyE", { ctrl: true, shift: true })).toEqual(["hideTools"]);
	expect(press("t", "KeyT", { alt: true })).toEqual(["hideThinking"]);
	expect(pressOn(true, "†", "KeyT", { alt: true })).toEqual(["hideThinking"]);
	expect(pressOn(true, "k", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press("K", "KeyK", { ctrl: true, shift: true })).toEqual([]);
	expect(press("k", "KeyK", { ctrl: true, alt: true })).toEqual([]);
	expect(press("b", "KeyB")).toEqual([]);
});

test("Ctrl+` toggles the terminal on every platform, and ⌘` stays macOS's window switch", () => {
	expect(press("`", "Backquote", { ctrl: true })).toEqual(["terminal"]);
	expect(pressOn(true, "`", "Backquote", { ctrl: true })).toEqual(["terminal"]);
	expect(pressOn(true, "`", "Backquote", { meta: true })).toEqual([]);
	expect(pressOn(true, "`", "Backquote", { ctrl: true, meta: true })).toEqual([]);
});

test("browser-reserved chords stay the browser's", () => {
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		for (const [key, code] of [["t", "KeyT"], ["w", "KeyW"], ["n", "KeyN"], ["l", "KeyL"], ["r", "KeyR"], ["d", "KeyD"], ["o", "KeyO"], ["p", "KeyP"], ["s", "KeyS"], ["9", "Digit9"], ["0", "Digit0"]]) {
			expect(pressOn(mac, key, code, mod)).toEqual([]);
		}
	}
});

test("Cmd+1–6 selects dashboard tabs on macOS, Ctrl+1–6 elsewhere, including AZERTY", () => {
	const tabs = ["pull-requests", "tickets", "sessions", "todo", "calendar", "settings"] as const;
	const azerty = ["&", "é", "\"", "'", "(", "-"];
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		for (const [index, id] of tabs.entries()) {
			const key = String(index + 1);
			const code = `Digit${key}`;
			expect(shortcutsFor(keyEvent(key, code, mod), null, mac)).toEqual([{ id, scope: "anywhere" }]);
			expect(pressOn(mac, azerty[index]!, code, mod)).toEqual([id]);
			expect(pressOn(mac, key, code)).toEqual([]);
			expect(pressOn(mac, key, code, { ...mod, shift: true })).toEqual([]);
			expect(pressOn(mac, key, code, { ...mod, alt: true })).toEqual([]);
			expect(pressOn(mac, key, code, { meta: true, ctrl: true })).toEqual([]);
		}
	}
	expect(press(",", "Comma", { ctrl: true })).toEqual([]);
	expect(press("J", "KeyJ", { ctrl: true, shift: true })).toEqual([]);
});

test("a letter key that types no ASCII letter matches by its physical key, an ASCII symbol as typed", () => {
	expect(press("л", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(pressOn(true, "˚", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press("?", "KeyM", { shift: true })).toEqual(["help"]);
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
	expect(press("/", "Digit7", { shift: true })).toEqual(["focusComposer", "todoSearch"]);
	expect(pressOn(true, "÷", "Slash", { meta: true, alt: true })).toEqual(["model"]);
});

test("Cmd+Enter steers now, Enter queues when running, and Cmd+Shift+Backspace stops the turn", () => {
	expect(press("Enter", "Enter", { ctrl: true })).toEqual(["steer", "deliverSteer"]);
	expect(press("Enter", "Enter", { meta: true })).toEqual([]);
	expect(pressOn(true, "Enter", "Enter", { meta: true })).toEqual(["steer", "deliverSteer"]);
	expect(pressOn(true, "Enter", "Enter", { ctrl: true })).toEqual([]);
	for (const mac of [false, true]) {
		expect(pressOn(mac, "Enter", "Enter")).toEqual([]);
		expect(pressOn(mac, "Tab", "Tab", { shift: true })).toEqual(["thinking"]);
		expect(pressOn(mac, "Backspace", "Backspace", { shift: true, ...(mac ? { meta: true } : { ctrl: true }) })).toEqual(["interrupt"]);
	}
});

test("a key matches only its intended scope, with no Esc interrupt or Cmd+/ help", () => {
	expect(shortcutsFor(keyEvent("Escape", "Escape"), null, false)).toEqual([
		{ id: "restore", scope: "anywhere" },
		{ id: "todoClose", scope: "outside-fields" },
	]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true }), null, false)).toEqual([]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true, alt: true }), null, false)).toEqual([{ id: "model", scope: "anywhere" }]);
	expect(shortcutsFor(keyEvent("/", "Slash"), null, false)).toEqual([
		{ id: "focusComposer", scope: "outside-fields" },
		{ id: "todoSearch", scope: "outside-fields" },
	]);
	expect(press("i", "KeyI", { ctrl: true })).toEqual(["focusComposer"]);
});

test("↓ and ↑ step through pull requests, todos, and changed files, ↑ also takes back a queued message, and J and K step through nothing", () => {
	expect(press("ArrowDown", "ArrowDown")).toEqual(["nextPullRequest", "todoNext", "nextChangedFile"]);
	expect(press("ArrowUp", "ArrowUp")).toEqual(["dequeue", "previousPullRequest", "todoPrevious", "previousChangedFile"]);
	expect(press("j", "KeyJ")).toEqual([]);
	expect(press("k", "KeyK")).toEqual([]);
});

test("Cmd+[ and Cmd+] step through sessions, and Alt+Shift+arrows move a todo", () => {
	expect(press("[", "BracketLeft", { ctrl: true })).toEqual(["previousSession"]);
	expect(press("]", "BracketRight", { ctrl: true })).toEqual(["nextSession"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual([]);
	expect(press("ArrowUp", "ArrowUp", { alt: true, shift: true })).toEqual(["moveUp"]);
	expect(press("ArrowDown", "ArrowDown", { alt: true, shift: true })).toEqual(["moveDown"]);
});

test("G then R or W goes to a page only right after a plain G, and P alone picks a todo's priority", () => {
	const after = (previous: string | null, key: string, mods: Mods = {}) => pressOn(false, key, `Key${key.toUpperCase()}`, mods, previous);
	expect(after("g", "r")).toEqual(["routines"]);
	expect(after("g", "w")).toEqual(["workspace"]);
	expect(after(null, "w")).toEqual([]);
	expect(after("h", "w")).toEqual([]);
	expect(after("g", "W", { shift: true })).toEqual([]);
	expect(after("g", "p")).toEqual(["todoPriority"]);
	expect(after("g", "i", { ctrl: true })).toEqual(["focusComposer"]);
	expect(shortcutsFor(keyEvent("w", "KeyW"), "g", false)).toEqual([{ id: "workspace", scope: "outside-fields" }]);
});

test("a pair forms from a plain key outside text fields, within a second and a half", () => {
	const at = (timeStamp: number, key: string, mods: Mods = {}) => ({ ...keyEvent(key, `Key${key.toUpperCase()}`, mods), timeStamp });

	const quick = pairing();
	expect(quick(at(0, "g"), true)).toBe(null);
	expect(quick(at(400, "i"), true)).toBe("g");

	const slow = pairing();
	slow(at(0, "g"), true);
	expect(slow(at(1600, "i"), true)).toBe(null);

	const typed = pairing();
	typed(at(0, "g"), false);
	expect(typed(at(100, "i"), true)).toBe(null);

	const shifted = pairing();
	shifted(at(0, "G", { shift: true }), true);
	expect(shifted(at(100, "i"), true)).toBe(null);

	const broken = pairing();
	broken(at(0, "g"), true);
	broken(at(100, "x"), true);
	expect(broken(at(200, "i"), true)).toBe("x");
});

const pressed = (key: string, code: string, mods: Mods = {}) => {
	const event = { ...keyEvent(key, code, mods), defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) };
	return event;
};

test("the newest registration tries a key first, and the first handler that takes it ends the press", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ nextPullRequest: () => void calls.push("app") }));
	stack.add(3, () => ({ todoNext: () => void calls.push("page") }));
	stack.add(2, () => ({ nextChangedFile: () => void calls.push("middle") }));
	const event = pressed("ArrowDown", "ArrowDown");
	stack.dispatch(event, true, null);
	expect(calls).toEqual(["page"]);
	expect(event.defaultPrevented).toBe(true);
});

test("a handler that declines passes the key to the registration below, and one that returns nothing takes it", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ focusComposer: () => void calls.push("app") }));
	stack.add(2, () => ({ todoSearch: () => (calls.push("page"), false) }));
	const event = pressed("/", "Slash");
	stack.dispatch(event, true, null);
	expect(calls).toEqual(["page", "app"]);
	expect(event.defaultPrevented).toBe(true);
	const declined = pressed("/", "Slash");
	const empty = createShortcutStack();
	empty.add(1, () => ({ todoSearch: () => false }));
	empty.dispatch(declined, true, null);
	expect(declined.defaultPrevented).toBe(false);
});

test("a registration reads its handlers when the key is pressed, and removing it returns the key to the one below", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	let handlers: ShortcutHandlers = {};
	stack.add(1, () => ({ newTicket: () => void calls.push("app") }));
	const remove = stack.add(2, () => handlers);
	expect(stack.size).toBe(2);
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app"]);
	handlers = { todoNew: () => void calls.push("page") };
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app", "page"]);
	remove();
	expect(stack.size).toBe(1);
	stack.dispatch(pressed("c", "KeyC"), true, null);
	expect(calls).toEqual(["app", "page", "app"]);
});

test("scope limits who runs: text fields keep their keys, chords work anywhere, and composer bindings never reach the page", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({
		newTicket: () => void calls.push("ticket"),
		switcher: () => void calls.push("switcher"),
		interrupt: () => void calls.push("interrupt"),
	}));
	const mod = IS_MAC ? { meta: true } : { ctrl: true };
	stack.dispatch(pressed("c", "KeyC"), false, null);
	stack.dispatch(pressed("k", "KeyK", mod), false, null);
	stack.dispatch(pressed("Backspace", "Backspace", { ...mod, shift: true }), true, null);
	expect(calls).toEqual(["switcher"]);
});

test("a key something nearer already handled is left alone", () => {
	const stack = createShortcutStack();
	const calls: string[] = [];
	stack.add(1, () => ({ newTicket: () => void calls.push("app") }));
	const event = pressed("c", "KeyC");
	event.preventDefault();
	stack.dispatch(event, true, null);
	expect(calls).toEqual([]);
});
