import { expect, test } from "bun:test";
import { shortcutsFor } from "./shortcuts";

type Mods = { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean };
const pressOn = (mac: boolean, key: string, code: string, mods: Mods = {}) =>
	shortcutsFor({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: !!mods.meta, shiftKey: !!mods.shift }, mac).map(({ id }) => id);
const press = (key: string, code: string, mods: Mods = {}) => pressOn(false, key, code, mods);

test("Alt chords match by physical key when macOS Option composes a character", () => {
	expect(press("π", "KeyP", { alt: true })).toEqual(["model"]);
	expect(press("p", "KeyP", { alt: true })).toEqual(["model"]);
	expect(press("†", "KeyT", { alt: true })).toEqual(["thinking"]);
	expect(press("∑", "KeyW", { alt: true })).toEqual(["project"]);
	expect(press("©", "KeyG", { alt: true })).toEqual(["inbox"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual(["dequeue"]);
});

test("chords need exactly their modifiers and never take ⌘ unless they name it", () => {
	expect(press("o", "KeyO", { ctrl: true })).toEqual(["tools"]);
	expect(press("o", "KeyO", { meta: true })).toEqual([]);
	expect(pressOn(true, "o", "KeyO", { meta: true })).toEqual([]);
	expect(press("O", "KeyO", { ctrl: true, shift: true })).toEqual([]);
	expect(press("p", "KeyP")).toEqual([]);
	expect(press("ArrowUp", "ArrowUp")).toEqual([]);
	expect(press("Escape", "Escape", { meta: true })).toEqual([]);
});

test("the follow-up is Ctrl+Enter as in omp, and ⌘Enter on macOS, where Ctrl+Enter opens a context menu", () => {
	expect(press("Enter", "Enter", { ctrl: true })).toEqual(["followUp"]);
	expect(press("Enter", "Enter", { meta: true })).toEqual([]);
	expect(pressOn(true, "Enter", "Enter", { meta: true })).toEqual(["followUp"]);
	expect(pressOn(true, "Enter", "Enter", { ctrl: true })).toEqual([]);
	expect(pressOn(true, "Enter", "Enter", { ctrl: true, meta: true })).toEqual([]);
	for (const mac of [false, true]) {
		expect(pressOn(mac, "Enter", "Enter")).toEqual([]);
		expect(pressOn(mac, "Enter", "Enter", { alt: true })).toEqual([]);
		expect(pressOn(mac, "Enter", "Enter", { ctrl: true, meta: true, shift: true })).toEqual([]);
	}
});

test("Ctrl+D ends the session as omp's exit key, on macOS too, and ⌘D stays the browser's", () => {
	expect(press("d", "KeyD", { ctrl: true })).toEqual(["end"]);
	expect(pressOn(true, "d", "KeyD", { ctrl: true })).toEqual(["end"]);
	expect(pressOn(true, "d", "KeyD", { meta: true })).toEqual([]);
	expect(press("D", "KeyD", { ctrl: true, shift: true })).toEqual([]);
});

test("? matches whichever key types it on the layout", () => {
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
	expect(press("?", "Comma", { shift: true })).toEqual(["help"]);
	expect(press("/", "Slash")).toEqual([]);
});
