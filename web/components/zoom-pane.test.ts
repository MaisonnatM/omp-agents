import { expect, mock, test } from "bun:test";
import type { KeyboardEvent } from "react";
import { stepped, type Zoom, zoomKey } from "./zoom-pane";

test("stepped moves to the next listed level, from a pinch's in-between level too, and stops at either end", () => {
	expect([stepped(1, 1), stepped(1, -1), stepped(1.3, 1), stepped(1.3, -1), stepped(8, 1), stepped(0.25, -1), stepped(9, -1)]).toEqual([1.1, 0.9, 1.5, 1.25, 8, 0.25, 8]);
});

const press = (key: string, modifiers: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey">> = {}) => {
	const zoom: Zoom = { level: 1, set: mock(), scale: mock(), step: mock() };
	const preventDefault = mock();
	const event = { key, metaKey: false, ctrlKey: false, altKey: false, ...modifiers, preventDefault } as unknown as KeyboardEvent;
	return { took: zoomKey(zoom, event), zoom, prevented: preventDefault.mock.calls.length > 0 };
};

test("zoomKey zooms on bare +, −, and 0, with the shifted keys of the same row", () => {
	const plus = press("=");
	expect([plus.took, plus.prevented]).toEqual([true, true]);
	expect(plus.zoom.step).toHaveBeenCalledWith(1);
	expect(press("_").zoom.step).toHaveBeenCalledWith(-1);
	expect(press("0").zoom.set).toHaveBeenCalledWith(1);
});

test("zoomKey leaves ⌘, Ctrl, and Alt chords, and other keys, to the window", () => {
	for (const pressed of [press("+", { metaKey: true }), press("-", { ctrlKey: true }), press("0", { altKey: true }), press("ArrowRight")]) {
		expect(pressed.took).toBe(false);
		expect(pressed.prevented).toBe(false);
		expect(pressed.zoom.step).not.toHaveBeenCalled();
		expect(pressed.zoom.set).not.toHaveBeenCalled();
	}
});
