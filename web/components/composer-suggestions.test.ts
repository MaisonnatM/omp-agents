import { expect, test } from "bun:test";
import { chosenText, suggestionKey } from "./composer-suggestions";

const prompts = ["Run the tests", "Open a PR", "Update the docs"];

const press = (key: string, shiftKey = false) => ({ key, shiftKey, altKey: false, ctrlKey: false, metaKey: false, nativeEvent: { isComposing: false } });
const list = { open: true, count: prompts.length, active: null, marked: false };

test("marks plus the clicked row come back in list order, whatever the click order", () => {
	expect(chosenText(prompts, new Set(["Update the docs"]), 0)).toBe("Run the tests\nUpdate the docs");
	expect(chosenText(prompts, new Set(["Update the docs", "Run the tests"]), 1)).toBe("Run the tests\nOpen a PR\nUpdate the docs");
});

test("a row both marked and clicked appears once", () => {
	expect(chosenText(prompts, new Set(["Open a PR"]), 1)).toBe("Open a PR");
});

test("a mark whose prompt left the list takes nothing", () => {
	expect(chosenText(prompts, new Set(["Deploy"]), 2)).toBe("Update the docs");
});

test("with marks but no highlight, Enter sends and Tab fills just the marks, and Esc clears them", () => {
	const marks = { ...list, marked: true };
	expect(suggestionKey(press("Enter"), marks)).toEqual({ kind: "send", index: null });
	expect(suggestionKey(press("Tab"), marks)).toEqual({ kind: "fill", index: null });
	expect(suggestionKey(press("Escape"), marks)).toEqual({ kind: "clear" });
	expect(chosenText(prompts, new Set(["Run the tests", "Update the docs"]), null)).toBe("Run the tests\nUpdate the docs");
});

test("with nothing marked or highlighted, Enter and Esc stay the composer's", () => {
	expect(suggestionKey(press("Enter"), list)).toBeNull();
	expect(suggestionKey(press("Escape"), list)).toBeNull();
});

test("a digit sends its row, with marks or Shift", () => {
	expect(suggestionKey(press("2"), { ...list, marked: true })).toEqual({ kind: "send", index: 1 });
	expect(suggestionKey(press("3", true), list)).toEqual({ kind: "send", index: 2 });
});

test("a digit past the list stays the composer's", () => {
	expect(suggestionKey(press("4"), list)).toBeNull();
});

test("ArrowUp with no highlight stays the composer's, and walks up and out of the list with one", () => {
	expect(suggestionKey(press("ArrowUp"), list)).toBeNull();
	expect(suggestionKey(press("ArrowUp"), { ...list, active: 1 })).toEqual({ kind: "move", to: 0 });
	expect(suggestionKey(press("ArrowUp"), { ...list, active: 0 })).toEqual({ kind: "move", to: null });
});

test("ArrowDown moves into the list and stops at its last row", () => {
	expect(suggestionKey(press("ArrowDown"), list)).toEqual({ kind: "move", to: 0 });
	expect(suggestionKey(press("ArrowDown"), { ...list, active: 2 })).toEqual({ kind: "move", to: 2 });
});

test("a closed list takes no key", () => {
	expect(suggestionKey(press("1"), { ...list, open: false })).toBeNull();
});
