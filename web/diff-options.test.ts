import { expect, test } from "bun:test";
import { withoutWhitespaceChanges } from "./diff-options";

test("hides whitespace-only replacements without losing either line number", () => {
	expect(withoutWhitespaceChanges([
		{ sign: "-", old: 3, new: null, text: "  const a = 1;" },
		{ sign: "+", old: null, new: 3, text: "const a=1;" },
	])).toEqual([{ sign: " ", old: 3, new: 3, text: "const a=1;" }]);
});

test("keeps substantive replacements and inserted blank lines", () => {
	const rows = [
		{ sign: "-" as const, old: 1, new: null, text: "const a = 1" },
		{ sign: "+" as const, old: null, new: 1, text: "const a = 2" },
		{ sign: "+" as const, old: null, new: 2, text: "" },
	];
	expect(withoutWhitespaceChanges(rows)).toEqual(rows);
});
