import { expect, test } from "bun:test";
import { COLUMN_MAX, listPageOf, listPlacement } from "./page-list";
import type { Page } from "./routing";

const BOTS: Page = { kind: "bots", target: null, adding: false };
const TODO: Page = { kind: "todo", list: { kind: "all" }, open: null };

test("only a tab's or Settings' own page has a list; Sessions, New session, and a page its row does not match have none", () => {
	expect(listPageOf(BOTS, "bots")).toBe(BOTS);
	expect(listPageOf(null, "sessions")).toBeNull();
	expect(listPageOf({ kind: "new" } as Page, "new")).toBeNull();
	expect(listPageOf(BOTS, null)).toBeNull();
});

test("a floating sidebar keeps the list under its row however wide the page area is", () => {
	expect(listPlacement(listPageOf(BOTS, "bots")!, true, 3000)).toEqual({ at: "sidebar" });
});

test("a wide page area holds the column, capped at its widest", () => {
	expect(listPlacement(listPageOf(BOTS, "bots")!, false, 1600)).toEqual({ at: "column", max: COLUMN_MAX });
});

test("a page area too narrow for the page beside the narrowest column nests the list instead of crushing the page", () => {
	expect(listPlacement(listPageOf(BOTS, "bots")!, false, 600)).toEqual({ at: "sidebar" });
	expect(listPlacement(listPageOf(BOTS, "bots")!, false, 800)).toEqual({ at: "column", max: 320 });
});

test("a page that splits its list from the open item keeps room for both before it takes a column", () => {
	const todo = listPageOf(TODO, "todo")!;
	expect(listPlacement(todo, false, 950)).toEqual({ at: "sidebar" });
	expect(listPlacement(todo, false, 1100)).toEqual({ at: "column", max: 332 });
});
