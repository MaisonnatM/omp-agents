import { expect, test } from "bun:test";
import { shortcutsFor } from "./shortcuts";

const press = (key: string, code: string, mods: { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean } = {}) =>
	shortcutsFor({ key, code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, metaKey: !!mods.meta, shiftKey: !!mods.shift }).map(({ id }) => id);

test("Alt chords match by physical key when macOS Option composes a character", () => {
	expect(press("π", "KeyP", { alt: true })).toEqual(["model"]);
	expect(press("p", "KeyP", { alt: true })).toEqual(["model"]);
	expect(press("†", "KeyT", { alt: true })).toEqual(["thinking"]);
	expect(press("∑", "KeyW", { alt: true })).toEqual(["project"]);
	expect(press("©", "KeyG", { alt: true })).toEqual(["inbox"]);
	expect(press("ArrowUp", "ArrowUp", { alt: true })).toEqual(["dequeue"]);
});

test("chords need exactly their modifiers and never take ⌘", () => {
	expect(press("o", "KeyO", { ctrl: true })).toEqual(["tools"]);
	expect(press("o", "KeyO", { meta: true })).toEqual([]);
	expect(press("O", "KeyO", { ctrl: true, shift: true })).toEqual([]);
	expect(press("p", "KeyP")).toEqual([]);
	expect(press("ArrowUp", "ArrowUp")).toEqual([]);
	expect(press("Escape", "Escape", { meta: true })).toEqual([]);
});

test("Ctrl+Enter sends a follow-up as in omp, while Enter, Alt+Enter, and ⌘Enter stay the composer's own keys", () => {
	expect(press("Enter", "Enter", { ctrl: true })).toEqual(["followUp"]);
	expect(press("Enter", "Enter")).toEqual([]);
	expect(press("Enter", "Enter", { alt: true })).toEqual([]);
	expect(press("Enter", "Enter", { meta: true })).toEqual([]);
	expect(press("Enter", "Enter", { ctrl: true, shift: true })).toEqual([]);
});

test("? matches whichever key types it on the layout", () => {
	expect(press("?", "Slash", { shift: true })).toEqual(["help"]);
	expect(press("?", "Comma", { shift: true })).toEqual(["help"]);
	expect(press("/", "Slash")).toEqual([]);
});
