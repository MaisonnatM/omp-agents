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
	{ tab: "todo", hidden: false },
	{ tab: "sport", hidden: false },
	{ tab: "board", hidden: false },
	{ tab: "memory", hidden: false },
	{ tab: "projects", hidden: false },
];

test("the default layout is every tab in SIDEBAR_TABS order, none hidden", () => {
	expect(DEFAULT_TAB_LAYOUT).toEqual(DEFAULT);
});

test("nothing stored, or anything unreadable, decodes to the default", () => {
	for (const raw of [null, "", "not json", "{\"tab\":\"todo\"}", "42", "[1, \"todo\", null, {\"tab\":\"bogus\"}]"]) {
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
		{ tab: "todo", hidden: "yes" },
		{ tab: "sessions" },
		{ tab: "email", hidden: false },
		{ tab: "inbox", hidden: true },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "pull-requests", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sport", hidden: true },
		{ tab: "todo", hidden: false },
		{ tab: "board", hidden: false },
		{ tab: "memory", hidden: false },
		{ tab: "projects", hidden: false },
	]);
});

test("a layout stored before the Bots tab gets it at its default place and loses the Routines and Sessions tabs", () => {
	const before = ["pull-requests", "sessions", "todo", "routines", "notes"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
});

test("a layout stored before the Sport tab gets it at its default place, shown", () => {
	const before = DEFAULT.filter(({ tab }) => tab !== "sport");
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
	expect(shownTabs(DEFAULT_TAB_LAYOUT, new Set())).toContain("sport");
});

test("a layout stored with the Notes tab drops it and keeps every other tab where it was", () => {
	const saved = ["pull-requests", "bots", "sessions", "notes", "todo", "sport"].map(tab => ({ tab, hidden: tab === "notes" }));
	expect(decodeTabLayout(JSON.stringify(saved))).toEqual(DEFAULT);
	const todoFirst = ["todo", "pull-requests", "notes", "bots", "sessions", "sport"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(todoFirst)).map(({ tab }) => tab)).toEqual(["todo", "pull-requests", "bots", "sport", "board", "memory", "projects"]);
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "sport", -1), "todo", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "projects", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "sport", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "bots", "sport", "todo", "board", "memory", "projects"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["bots", "pull-requests", "todo", "sport", "board", "memory", "projects"]);
});

test("hideTab hides and shows any tab", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[2]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(DEFAULT_TAB_LAYOUT, "sport", true)[3]).toEqual({ tab: "sport", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and absent tabs and Projects, and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "sport", -1);
	expect(shownTabs(layout, new Set(["bots"]))).toEqual(["pull-requests", "sport", "memory"]);
});

test("a saved order that still has Todo immediately before Notes puts it just before Sport", () => {
	const saved = ["sessions", "todo", "notes", "bots", "pull-requests", "sport"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(saved)).map(({ tab }) => tab)).toEqual(["bots", "pull-requests", "todo", "sport", "board", "memory", "projects"]);
});

test("a layout stored in the old order, Todo in the bar before Notes, puts Todo just before Sport and keeps what was hidden", () => {
	const before = [
		{ tab: "todo", hidden: true },
		{ tab: "notes", hidden: false },
		{ tab: "pull-requests", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sessions", hidden: false },
		{ tab: "sport", hidden: false },
	];
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(hideTab(DEFAULT, "todo", true));
});

const pageAt = (hash: string): Page => {
	const route = routeFromHash(hash);
	if (route.kind !== "page") throw new Error(`${hash} names no page`);
	return route.page;
};

test("the page list's current row is the page's tab, and none for the panes or a page without a row", () => {
	const none = new Set<never>();
	expect(navRowOf(null, none)).toBeNull();
	expect(navRowOf(pageAt("#todo"), none)).toBe("todo");
	expect(navRowOf(pageAt("#settings"), none)).toBe("settings");
	expect(navRowOf(pageAt("#new"), none)).toBe("new");
	expect(navRowOf(pageAt("#todo"), new Set(["todo"] as const))).toBeNull();
	expect(navRowOf(pageAt("#get-started"), none)).toBeNull();
});
