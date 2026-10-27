import { expect, test } from "bun:test";
import { TAB_GROUPS } from "./routing";
import { bindingLabel, IS_MAC } from "./shortcuts";
import {
	DEFAULT_TAB_LAYOUT,
	decodeTabLayout,
	encodeTabLayout,
	groupEntry,
	groupTabs,
	hideTab,
	moveTab,
	positionKey,
	shortcutRows,
	shownTabs,
	tabsSignedOut,
	tabShortcutLabels,
	type TabLayout,
} from "./sidebar-tabs";

const DEFAULT: TabLayout = [
	{ tab: "pull-requests", hidden: false },
	{ tab: "tickets", hidden: false },
	{ tab: "sessions", hidden: false },
	{ tab: "todo", hidden: false },
	{ tab: "routines", hidden: false },
	{ tab: "notes", hidden: false },
	{ tab: "calendar", hidden: false },
	{ tab: "inbox", hidden: false },
];

test("the default layout is every tab in SIDEBAR_TABS order, none hidden", () => {
	expect(DEFAULT_TAB_LAYOUT).toEqual(DEFAULT);
});

test("nothing stored, or anything unreadable, decodes to the default", () => {
	for (const raw of [null, "", "not json", "{\"tab\":\"todo\"}", "42", "[1, \"todo\", null, {\"tab\":\"bogus\"}]"]) {
		expect(decodeTabLayout(raw)).toEqual(DEFAULT);
	}
});

test("decoding keeps each known tab once, drops a stored Settings tab, and puts a missing tab at its default place", () => {
	const raw = JSON.stringify([
		{ tab: "settings", hidden: false },
		{ tab: "inbox", hidden: true },
		{ tab: "bogus", hidden: true },
		{ tab: "inbox", hidden: false },
		{ tab: "todo", hidden: "yes" },
		{ tab: "sessions" },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "inbox", hidden: true },
		{ tab: "todo", hidden: false },
		{ tab: "routines", hidden: false },
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
		{ tab: "sessions", hidden: false },
	]);
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "inbox", -1), "todo", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "inbox", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "inbox", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "tickets", "sessions", "todo", "routines", "notes", "inbox", "calendar"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["tickets", "pull-requests", "sessions", "todo", "routines", "notes", "calendar", "inbox"]);
});

test("hideTab hides and shows any tab", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[3]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(DEFAULT_TAB_LAYOUT, "inbox", true)[7]).toEqual({ tab: "inbox", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and signed-out tabs and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "inbox", -1);
	expect(shownTabs(layout, new Set(["tickets"]))).toEqual(["pull-requests", "sessions", "routines", "notes", "inbox", "calendar"]);
});

test("groupTabs keeps the shown tabs of one group, in their order: Notes, Calendar, and Inbox are Ops, the rest Dev", () => {
	const shown = shownTabs(moveTab(DEFAULT_TAB_LAYOUT, "inbox", -1), new Set());
	expect(groupTabs(shown, "dev")).toEqual(["pull-requests", "tickets", "sessions", "todo", "routines"]);
	expect(groupTabs(shown, "ops")).toEqual(["notes", "inbox", "calendar"]);
	expect(groupTabs(["sessions", "todo"], "ops")).toEqual([]);
});

test("groupEntry reopens the tab a group was left on while it shows, else the group's first shown tab, else none", () => {
	const shown = shownTabs(DEFAULT_TAB_LAYOUT, new Set(["inbox"]));
	expect(groupEntry(shown, "ops", "calendar")).toBe("calendar");
	expect(groupEntry(shown, "ops", "inbox")).toBe("notes");
	expect(groupEntry(shown, "dev", "todo")).toBe("todo");
	expect(groupEntry(["pull-requests", "sessions"], "ops", "notes")).toBeUndefined();
});

test("until the integrations answer, the tabs that wait on one are signed out", () => {
	expect(tabsSignedOut(undefined)).toEqual(["tickets", "inbox"]);
});

test("every tab of a group takes a position key while every tab shows", () => {
	const shown = shownTabs(DEFAULT_TAB_LAYOUT, new Set());
	for (const { value } of TAB_GROUPS) {
		const drawn = groupTabs(shown, value);
		for (const tab of drawn) expect(positionKey(tab, drawn)).toBeDefined();
	}
});

test("positionKey takes the position among the tabs the bar draws, or none", () => {
	const shown = shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "inbox", -1), new Set(["tickets"]));
	const dev = groupTabs(shown, "dev");
	const ops = groupTabs(shown, "ops");
	expect(positionKey("pull-requests", dev)).toBe("tab1");
	expect(positionKey("sessions", dev)).toBe("tab2");
	expect(positionKey("notes", ops)).toBe("tab1");
	expect(positionKey("inbox", ops)).toBe("tab2");
	expect(positionKey("calendar", ops)).toBe("tab3");
	expect(positionKey("notes", dev)).toBeUndefined();
	expect(positionKey("todo", dev)).toBeUndefined();
	expect(positionKey("tickets", dev)).toBeUndefined();
	expect(positionKey("settings", dev)).toBeUndefined();
});

test("shortcutRows folds each drawn tab's position key into its row, drops the position rows and a tab with no key, and keeps every other shortcut", () => {
	const ops = groupTabs(shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "inbox", -1), new Set(["tickets"])), "ops");
	const rows = shortcutRows(ops);
	const keysOf = (id: string) => rows.find(row => row.id === id)?.keys.map(bindingLabel);
	const mod = IS_MAC ? "⌘" : "Ctrl+";
	expect(keysOf("settings")).toEqual(["G then ,"]);
	expect(keysOf("notes")).toEqual([`${mod}1`, "G then N"]);
	expect(keysOf("inbox")).toEqual([`${mod}2`, "G then I"]);
	expect(keysOf("calendar")).toEqual([`${mod}3`]);
	expect(keysOf("pull-requests")).toBeUndefined();
	expect(keysOf("todo")).toBeUndefined();
	expect(keysOf("tab1")).toBeUndefined();
	expect(keysOf("switcher")).toEqual([IS_MAC ? "⌘K" : "Ctrl+K"]);
	expect(tabShortcutLabels("inbox", ops)).toEqual([`${mod}2`, "G then I"]);
});
