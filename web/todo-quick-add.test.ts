import { describe, expect, test } from "bun:test";
import { parseQuickTodo, quickAddTodo } from "./todo-quick-add";

const categories = [
	{ id: "w", name: "Work" },
	{ id: "h", name: "home" },
];
// A Wednesday.
const day = "2026-10-07";
const parse = (input: string) => parseQuickTodo(input, categories, day);

describe("parseQuickTodo", () => {
	test("trailing day words set the due day", () => {
		expect(parse("Call the bank today")).toEqual({ text: "Call the bank", due: "2026-10-07", categoryId: null });
		expect(parse("Call the bank tomorrow")).toMatchObject({ text: "Call the bank", due: "2026-10-08" });
		expect(parse("Call the bank fri")).toMatchObject({ due: "2026-10-09" });
		expect(parse("Call the bank Monday")).toMatchObject({ due: "2026-10-12" });
		expect(parse("Call the bank wed")).toMatchObject({ due: "2026-10-07" });
		expect(parse("Call the bank 2026-11-02")).toMatchObject({ due: "2026-11-02" });
	});

	test("a trailing #category matches a category name in any case", () => {
		expect(parse("Fix the sink #Home tomorrow")).toEqual({ text: "Fix the sink", due: "2026-10-08", categoryId: "h" });
		expect(parse("Fix the sink fri #work")).toEqual({ text: "Fix the sink", due: "2026-10-09", categoryId: "w" });
	});

	test("words it does not recognize stay in the title", () => {
		expect(parse("Plan #garden")).toEqual({ text: "Plan #garden", due: null, categoryId: null });
		expect(parse("Ship today's release")).toEqual({ text: "Ship today's release", due: null, categoryId: null });
		expect(parse("Today review the PR")).toEqual({ text: "Today review the PR", due: null, categoryId: null });
		expect(parse("Plan 2026-02-30")).toEqual({ text: "Plan 2026-02-30", due: null, categoryId: null });
		expect(parse("Pick a day fri today")).toEqual({ text: "Pick a day fri", due: "2026-10-07", categoryId: null });
	});

	test("a lone token is the title, and blank input adds nothing", () => {
		expect(parse("tomorrow")).toEqual({ text: "tomorrow", due: null, categoryId: null });
		expect(parse("   ")).toBeNull();
	});
});

describe("quickAddTodo", () => {
	test("a parsed day and category override the place's, and the rest of the place stays", () => {
		expect(quickAddTodo("Pay rent fri #work", categories, day, { afterId: "x", categoryId: "h", due: day })).toMatchObject({
			op: "add",
			text: "Pay rent",
			afterId: "x",
			categoryId: "w",
			due: "2026-10-09",
		});
		expect(quickAddTodo("Pay rent", categories, day, { categoryId: "h", due: day })).toMatchObject({ categoryId: "h", due: day });
	});

	test("a todo under another keeps its title's #category", () => {
		expect(quickAddTodo("Pay rent #work", categories, day, { parentId: "p" })).toMatchObject({ text: "Pay rent #work", categoryId: null });
	});

	test("an empty title adds nothing", () => {
		expect(quickAddTodo("   ", categories, day)).toBeNull();
	});
});
