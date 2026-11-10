import { expect, test } from "bun:test";
import { findMatches } from "./transcript-find";

test("finds every occurrence regardless of case, without overlaps", () => {
	expect(findMatches(["Foo foo FOO"], "foo")).toEqual([
		{ start: [0, 0], end: [0, 3] },
		{ start: [0, 4], end: [0, 7] },
		{ start: [0, 8], end: [0, 11] },
	]);
	expect(findMatches(["aaaa"], "aa")).toEqual([
		{ start: [0, 0], end: [0, 2] },
		{ start: [0, 2], end: [0, 4] },
	]);
});

test("a match spans segments, as a highlighted code token's text does, and skips empty ones", () => {
	expect(findMatches(["const ", "", "value", " = 1"], "t value =")).toEqual([{ start: [0, 4], end: [3, 2] }]);
	expect(findMatches(["ab", "cd"], "ab")).toEqual([{ start: [0, 0], end: [0, 2] }]);
	expect(findMatches(["ab", "cd"], "cd")).toEqual([{ start: [1, 0], end: [1, 2] }]);
});

test("a blank query or missing text matches nothing", () => {
	expect(findMatches(["some text"], "")).toEqual([]);
	expect(findMatches(["some text"], "   ")).toEqual([]);
	expect(findMatches(["some text"], "absent")).toEqual([]);
	expect(findMatches([], "x")).toEqual([]);
});

test("a segment whose lowercase changes length keeps its offsets", () => {
	expect(findMatches(["İx", "Find"], "find")).toEqual([{ start: [1, 0], end: [1, 4] }]);
});
