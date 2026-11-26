import { expect, test } from "bun:test";
import { type Page, routeFromHash } from "./routing";
import {
	DEFAULT_TAB_LAYOUT,
	decodeTabLayout,
	encodeTabLayout,
	hideTab,
	moveTab,
	navRowOf,
	shownTabs,
	type TabLayout,
} from "./sidebar-tabs";

const DEFAULT: TabLayout = [
	{ tab: "pull-requests", hidden: false },
	{ tab: "bots", hidden: false },
	{ tab: "sport", hidden: false },
	{ tab: "memory", hidden: false },
	{ tab: "projects", hidden: false },
	{ tab: "board", hidden: false },
];

test("the default layout is every tab in SIDEBAR_TABS order, none hidden", () => {
	expect(DEFAULT_TAB_LAYOUT).toEqual(DEFAULT);
});

test("nothing stored, or anything unreadable, decodes to the default", () => {
	for (const raw of [null, "", "not json", "{\"tab\":\"sport\"}", "42", "[1, \"sport\", null, {\"tab\":\"bogus\"}]"]) {
		expect(decodeTabLayout(raw)).toEqual(DEFAULT);
	}
});

test("decoding keeps each known tab once, drops a stored tab of a page that left, and puts a missing tab at its default place", () => {
	const raw = JSON.stringify([
		{ tab: "settings", hidden: false },
		{ tab: "sport", hidden: true },
		{ tab: "bogus", hidden: true },
		{ tab: "sport", hidden: false },
		{ tab: "calendar", hidden: false },
		{ tab: "memory", hidden: "yes" },
		{ tab: "sessions" },
		{ tab: "email", hidden: false },
		{ tab: "inbox", hidden: true },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "pull-requests", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sport", hidden: true },
		{ tab: "memory", hidden: false },
		{ tab: "projects", hidden: false },
		{ tab: "board", hidden: false },
	]);
});

test("a layout stored before the Bots tab gets it at its default place and loses the Routines and Sessions tabs", () => {
	const before = ["pull-requests", "sessions", "routines", "notes"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
});

test("a layout stored before the Sport tab gets it at its default place, shown", () => {
	const before = DEFAULT.filter(({ tab }) => tab !== "sport");
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
	expect(shownTabs(DEFAULT_TAB_LAYOUT, new Set())).toContain("sport");
});

test("a layout stored with the Notes tab drops it and keeps every other tab where it was", () => {
	const saved = ["pull-requests", "bots", "sessions", "notes", "sport"].map(tab => ({ tab, hidden: tab === "notes" }));
	expect(decodeTabLayout(JSON.stringify(saved))).toEqual(DEFAULT);
	const sportFirst = ["sport", "pull-requests", "notes", "bots", "sessions"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(sportFirst)).map(({ tab }) => tab)).toEqual(["sport", "pull-requests", "bots", "memory", "projects", "board"]);
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "sport", -1), "memory", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "board", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "sport", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "sport", "bots", "memory", "projects", "board"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["bots", "pull-requests", "sport", "memory", "projects", "board"]);
});

test("hideTab hides and shows any tab", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "sport", true)[2]).toEqual({ tab: "sport", hidden: true });
	expect(hideTab(DEFAULT_TAB_LAYOUT, "memory", true)[3]).toEqual({ tab: "memory", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "sport", true), "sport", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and absent tabs and Projects, and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "memory", true), "sport", -1);
	expect(shownTabs(layout, new Set(["bots"]))).toEqual(["pull-requests", "sport", "board"]);
});

const pageAt = (hash: string): Page => {
	const route = routeFromHash(hash);
	if (route.kind !== "page") throw new Error(`${hash} names no page`);
	return route.page;
};

test("the page list's current row is the page's tab, and none for the panes or a page without a row", () => {
	const none = new Set<never>();
	expect(navRowOf(null, none)).toBeNull();
	expect(navRowOf(pageAt("#sport"), none)).toBe("sport");
	expect(navRowOf(pageAt("#settings"), none)).toBe("settings");
	expect(navRowOf(pageAt("#new"), none)).toBe("new");
	expect(navRowOf(pageAt("#sport"), new Set(["sport"] as const))).toBeNull();
	expect(navRowOf(pageAt("#get-started"), none)).toBeNull();
});
