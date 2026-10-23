import { expect, test } from "bun:test";
import { editHunks } from "./transcript";

test("numbers each line on both sides, carrying the offset across hunks", () => {
	const diff = ["+1|import re", " 1|from copy import deepcopy", "", " 12|)", "-13|old", "-14|old too", "+14|new", " 15|after"].join("\n");
	expect(editHunks(diff)).toEqual([
		[
			{ sign: "+", old: null, new: 1, text: "import re" },
			{ sign: " ", old: 1, new: 2, text: "from copy import deepcopy" },
		],
		[
			{ sign: " ", old: 12, new: 13, text: ")" },
			{ sign: "-", old: 13, new: null, text: "old" },
			{ sign: "-", old: 14, new: null, text: "old too" },
			{ sign: "+", old: null, new: 14, text: "new" },
			{ sign: " ", old: 15, new: 15, text: "after" },
		],
	]);
});

test("keeps blank code rows and carries a negative offset across gaps", () => {
	const diff = ["-1|first", "-2|second", " 3|", "", " 10|before", "+9|inserted", " 11|after"].join("\n");
	expect(editHunks(diff)).toEqual([
		[
			{ sign: "-", old: 1, new: null, text: "first" },
			{ sign: "-", old: 2, new: null, text: "second" },
			{ sign: " ", old: 3, new: 1, text: "" },
		],
		[
			{ sign: " ", old: 10, new: 8, text: "before" },
			{ sign: "+", old: null, new: 9, text: "inserted" },
			{ sign: " ", old: 11, new: 10, text: "after" },
		],
	]);
});
