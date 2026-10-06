import { expect, test } from "bun:test";
import { pairing, shortcutsFor } from "./shortcuts";

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
	expect(press("B", "KeyB", { ctrl: true, shift: true })).toEqual(["planSidebar"]);
	expect(pressOn(true, "b", "KeyB", { meta: true, shift: true })).toEqual(["planSidebar"]);
	expect(press("b", "KeyB", { ctrl: true, alt: true })).toEqual([]);
	expect(press("O", "KeyO", { ctrl: true, shift: true })).toEqual(["newSession"]);
	expect(press("k", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(pressOn(true, "k", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press("K", "KeyK", { ctrl: true, shift: true })).toEqual([]);
	expect(press("k", "KeyK", { ctrl: true, alt: true })).toEqual([]);
	expect(press("b", "KeyB")).toEqual([]);
});

test("browser-reserved chords stay the browser's", () => {
	for (const mac of [false, true]) {
		const mod = mac ? { meta: true } : { ctrl: true };
		for (const [key, code] of [["t", "KeyT"], ["w", "KeyW"], ["n", "KeyN"], ["l", "KeyL"], ["r", "KeyR"], ["d", "KeyD"], ["o", "KeyO"], ["p", "KeyP"], ["s", "KeyS"], ["1", "Digit1"]]) {
			expect(pressOn(mac, key, code, mod)).toEqual([]);
		}
	}
});

test("a letter key that types no ASCII letter matches by its physical key, an ASCII symbol as typed", () => {
	expect(press("л", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(pressOn(true, "˚", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press(",", "KeyM", { ctrl: true })).toEqual(["settings"]);
	expect(press("?", "KeyM", { shift: true })).toEqual(["help"]);
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
});

test("the follow-up is ⌘Enter on macOS, where Ctrl+Enter opens a context menu, and Ctrl+Enter elsewhere", () => {
	expect(press("Enter", "Enter", { ctrl: true })).toEqual(["followUp"]);
	expect(press("Enter", "Enter", { meta: true })).toEqual([]);
	expect(pressOn(true, "Enter", "Enter", { meta: true })).toEqual(["followUp"]);
	expect(pressOn(true, "Enter", "Enter", { ctrl: true })).toEqual([]);
	for (const mac of [false, true]) {
		expect(pressOn(mac, "Enter", "Enter")).toEqual([]);
		expect(pressOn(mac, "Enter", "Enter", { shift: true, ...(mac ? { meta: true } : { ctrl: true }) })).toEqual([]);
	}
});

test("one key can name several shortcuts, tried in table order, each in its own scope", () => {
	expect(shortcutsFor(keyEvent("Escape", "Escape"), null, false)).toEqual([
		{ id: "interrupt", scope: "composer" },
		{ id: "restore", scope: "anywhere" },
	]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true }), null, false)).toEqual([{ id: "help", scope: "anywhere" }]);
	expect(shortcutsFor(keyEvent("/", "Slash"), null, false)).toEqual([
		{ id: "focusComposer", scope: "outside-fields" },
		{ id: "todoSearch", scope: "outside-fields" },
	]);
});

test("↑ alone takes back a queued message, Alt+↑ and Alt+↓ step through the sessions, and with Shift they move a todo", () => {
	expect(press("ArrowUp", "ArrowUp")).toEqual(["dequeue"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual(["previousSession"]);
	expect(press("ArrowDown", "ArrowDown", { alt: true })).toEqual(["nextSession"]);
	expect(press("ArrowDown", "ArrowDown")).toEqual([]);
	expect(press("ArrowUp", "ArrowUp", { alt: true, shift: true })).toEqual(["moveUp"]);
	expect(press("ArrowDown", "ArrowDown", { alt: true, shift: true })).toEqual(["moveDown"]);
});

test("G then a key goes to a page only right after a plain G", () => {
	const after = (previous: string | null, key: string, mods: Mods = {}) => pressOn(false, key, `Key${key.toUpperCase()}`, mods, previous);
	expect(after("g", "i")).toEqual(["inbox"]);
	expect(after("g", "s")).toEqual(["sessions"]);
	expect(after("g", "p")).toEqual(["project"]);
	expect(after(null, "i")).toEqual([]);
	expect(after("h", "i")).toEqual([]);
	expect(after("g", "I", { shift: true })).toEqual([]);
	expect(after("g", "i", { ctrl: true })).toEqual([]);
	expect(shortcutsFor(keyEvent("i", "KeyI"), "g", false)).toEqual([{ id: "inbox", scope: "outside-fields" }]);
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
