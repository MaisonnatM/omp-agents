import { expect, test } from "bun:test";
import { COLUMN_MAX, listPageOf, listPlacement } from "./page-list";
import type { Page } from "./routing";

const SPORT = { kind: "sport", tab: "week", day: null } as Page;

test("only a tab's or Settings' own page has a list; the panes, New session, Notifications, the Pull requests page, and a page its row does not match have none", () => {
	expect(listPageOf(SPORT, "sport")).not.toBeNull();
	expect(listPageOf(null, null)).toBeNull();
	expect(listPageOf({ kind: "new" } as Page, "new")).toBeNull();
	expect(listPageOf({ kind: "notifications" }, "notifications")).toBeNull();
	expect(listPageOf({ kind: "pull-requests", target: null }, "pull-requests")).toBeNull();
	expect(listPageOf(SPORT, null)).toBeNull();
});

test("a floating sidebar keeps the list under its row however wide the page area is", () => {
	expect(listPlacement(listPageOf(SPORT, "sport")!, true, 3000)).toEqual({ at: "sidebar" });
});

test("a wide page area holds the column, capped at its widest", () => {
	expect(listPlacement(listPageOf(SPORT, "sport")!, false, 1600)).toEqual({ at: "column", max: COLUMN_MAX });
});

test("a page area too narrow for the page beside the narrowest column nests the list instead of crushing the page", () => {
	expect(listPlacement(listPageOf(SPORT, "sport")!, false, 600)).toEqual({ at: "sidebar" });
	expect(listPlacement(listPageOf(SPORT, "sport")!, false, 800)).toEqual({ at: "column", max: 320 });
});
