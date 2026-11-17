import { expect, test } from "bun:test";
import { COLUMN_MAX, listPageOf, listPlacement } from "./page-list";
import type { Page } from "./routing";

const BOTS: Page = { kind: "bots", target: null, adding: false };

test("only a tab's or Settings' own page has a list; the panes, New session, Notifications, the Pull requests and Todo pages, and a page its row does not match have none", () => {
	expect(listPageOf(BOTS, "bots")).toBe(BOTS);
	expect(listPageOf(null, null)).toBeNull();
	expect(listPageOf({ kind: "new" } as Page, "new")).toBeNull();
	expect(listPageOf({ kind: "notifications" }, "notifications")).toBeNull();
	expect(listPageOf({ kind: "pull-requests", target: null }, "pull-requests")).toBeNull();
	expect(listPageOf({ kind: "todo", list: "all", open: null }, "todo")).toBeNull();
	expect(listPageOf({ kind: "sport", tab: "week", day: null } as Page, "sport")).not.toBeNull();
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
