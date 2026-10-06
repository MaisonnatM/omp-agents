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
	expect(press("b", "KeyB", { ctrl: true, alt: true })).toEqual(["detailsSidebar"]);
	expect(pressOn(true, "b", "KeyB", { meta: true, alt: true })).toEqual(["detailsSidebar"]);
	expect(press("B", "KeyB", { ctrl: true, shift: true })).toEqual([]);
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
		for (const [key, code] of [["t", "KeyT"], ["w", "KeyW"], ["n", "KeyN"], ["l", "KeyL"], ["r", "KeyR"], ["d", "KeyD"], ["o", "KeyO"], ["p", "KeyP"], ["s", "KeyS"], ["6", "Digit6"], ["9", "Digit9"], ["0", "Digit0"]]) {
			expect(pressOn(mac, key, code, mod)).toEqual([]);
		}
	}
});

test("Cmd+1–5 selects dashboard tabs on macOS, Ctrl+1–5 elsewhere, including AZERTY", () => {
	const tabs = ["inbox", "tickets", "sessions", "todo", "calendar"] as const;
	const azerty = ["&", "é", "\"", "'", "("];
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
});

test("a letter key that types no ASCII letter matches by its physical key, an ASCII symbol as typed", () => {
	expect(press("л", "KeyK", { ctrl: true })).toEqual(["switcher"]);
	expect(pressOn(true, "˚", "KeyK", { meta: true })).toEqual(["switcher"]);
	expect(press(",", "KeyM", { ctrl: true })).toEqual(["settings"]);
	expect(press("?", "KeyM", { shift: true })).toEqual(["help"]);
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
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
	expect(shortcutsFor(keyEvent("Escape", "Escape"), null, false)).toEqual([{ id: "restore", scope: "anywhere" }]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true }), null, false)).toEqual([]);
	expect(shortcutsFor(keyEvent("/", "Slash", { ctrl: true, alt: true }), null, false)).toEqual([{ id: "model", scope: "anywhere" }]);
	expect(shortcutsFor(keyEvent("/", "Slash"), null, false)).toEqual([
		{ id: "focusComposer", scope: "outside-fields" },
		{ id: "todoSearch", scope: "outside-fields" },
	]);
	expect(press("i", "KeyI", { ctrl: true })).toEqual(["focusComposer"]);
	expect(press("J", "KeyJ", { ctrl: true, shift: true })).toEqual(["settings"]);
});

test("↑ takes back a queued message, Cmd+[ and Cmd+] step through sessions, and Alt+Shift+arrows move a todo", () => {
	expect(press("ArrowUp", "ArrowUp")).toEqual(["dequeue"]);
	expect(press("[", "BracketLeft", { ctrl: true })).toEqual(["previousSession"]);
	expect(press("]", "BracketRight", { ctrl: true })).toEqual(["nextSession"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual([]);
	expect(press("ArrowDown", "ArrowDown")).toEqual([]);
	expect(press("ArrowUp", "ArrowUp", { alt: true, shift: true })).toEqual(["moveUp"]);
	expect(press("ArrowDown", "ArrowDown", { alt: true, shift: true })).toEqual(["moveDown"]);
});

test("remaining G pairs require a preceding plain G; former tab pairs no longer navigate", () => {
	const after = (previous: string | null, key: string, mods: Mods = {}) => pressOn(false, key, `Key${key.toUpperCase()}`, mods, previous);
	expect(after("g", "r")).toEqual(["routines"]);
	expect(after("g", "p")).toEqual(["project"]);
	expect(after(null, "p")).toEqual([]);
	expect(after("h", "p")).toEqual([]);
	expect(after("g", "P", { shift: true })).toEqual([]);
	expect(after("g", "i", { ctrl: true })).toEqual(["focusComposer"]);
	for (const key of ["i", "t", "s", "d", "c"]) expect(after("g", key)).toEqual([]);
	expect(shortcutsFor(keyEvent("p", "KeyP"), "g", false)).toEqual([{ id: "project", scope: "outside-fields" }]);
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
