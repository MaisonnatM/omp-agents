import { expect, test } from "bun:test";
import { parseDelimited } from "./delimited";

test("a CSV cell in quotes keeps its commas, line breaks, and doubled quotes", () => {
	expect(parseDelimited('name,note\r\nada,"says ""hi"", then\nleaves"\r\nbob,\n', ",")).toEqual([
		["name", "note"],
		["ada", 'says "hi", then\nleaves'],
		["bob", ""],
	]);
});

test("a TSV keeps quotes as text and splits only at tabs", () => {
	expect(parseDelimited('model\tnote\nopus\t"fast, mostly"\n', "\t")).toEqual([
		["model", "note"],
		["opus", '"fast, mostly"'],
	]);
	expect(parseDelimited("", "\t")).toEqual([]);
});
