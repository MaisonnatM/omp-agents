import { expect, test } from "bun:test";
import type { DiffRow } from "../src/shared/changes";
import { highlightRows } from "./code-highlight";

test("colors a hunk's rows by their place in it, whatever line it starts at", () => {
	const at = (start: number): DiffRow[] => [
		{ sign: " ", old: start, new: start, text: "const a = 1;" },
		{ sign: "-", old: start + 1, new: null, text: "const b = \"old\";" },
		{ sign: "+", old: null, new: start + 1, text: "const b = \"new\";" },
		{ sign: " ", old: start + 2, new: start + 2, text: "// done" },
	];
	const hunk = at(12);
	const tokens = highlightRows(hunk, "src/file.ts");
	expect(tokens.map(line => line.map(token => token.text).join(""))).toEqual(hunk.map(row => row.text));
	expect(tokens).toEqual(highlightRows(at(1), "src/file.ts"));
});
