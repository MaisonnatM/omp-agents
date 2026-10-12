import { expect, test } from "bun:test";
import { IS_MAC, tabShortcutLabels } from "./shortcuts";
import { DEFAULT_TAB_LAYOUT, decodeTabLayout, encodeTabLayout, hideTab, moveTab, shownTabs, signedOutTabs, type TabLayout } from "./sidebar-tabs";

const DEFAULT: TabLayout = [
	{ tab: "pull-requests", hidden: false },
	{ tab: "tickets", hidden: false },
	{ tab: "sessions", hidden: false },
	{ tab: "todo", hidden: false },
	{ tab: "calendar", hidden: false },
	{ tab: "inbox", hidden: false },
	{ tab: "settings", hidden: false },
];

test("the default layout is every tab in SIDEBAR_TABS order, none hidden", () => {
	expect(DEFAULT_TAB_LAYOUT).toEqual(DEFAULT);
});

test("nothing stored, or anything unreadable, decodes to the default", () => {
	for (const raw of [null, "", "not json", "{\"tab\":\"todo\"}", "42", "[1, \"todo\", null, {\"tab\":\"bogus\"}]"]) {
		expect(decodeTabLayout(raw)).toEqual(DEFAULT);
	}
});

test("decoding keeps each known tab once, never hides Settings, and puts a missing tab at its default place", () => {
	const raw = JSON.stringify([
		{ tab: "settings", hidden: true },
		{ tab: "inbox", hidden: true },
		{ tab: "bogus", hidden: true },
		{ tab: "inbox", hidden: false },
		{ tab: "todo", hidden: "yes" },
		{ tab: "sessions" },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "settings", hidden: false },
		{ tab: "inbox", hidden: true },
		{ tab: "calendar", hidden: false },
		{ tab: "todo", hidden: false },
		{ tab: "sessions", hidden: false },
	]);
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "settings", -1), "todo", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "settings", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "settings", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "tickets", "sessions", "todo", "calendar", "settings", "inbox"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["tickets", "pull-requests", "sessions", "todo", "calendar", "inbox", "settings"]);
});

test("hideTab hides and shows a tab, but never Settings", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "settings", true)).toBe(DEFAULT_TAB_LAYOUT);
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[3]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and signed-out tabs and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "settings", -1);
	expect(shownTabs(layout, new Set(["tickets"]))).toEqual(["pull-requests", "sessions", "calendar", "settings", "inbox"]);
});

test("until the integrations answer, the tabs that wait on one are signed out", () => {
	expect(signedOutTabs(undefined)).toEqual(["tickets", "inbox"]);
});

test("the Nth tab shown takes Cmd+N, a hidden one none, and Inbox keeps G then I after its own", () => {
	const tabs = shownTabs(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), new Set(["tickets"]));
	expect(tabShortcutLabels("pull-requests", tabs)).toEqual([IS_MAC ? "⌘1" : "Ctrl+1"]);
	expect(tabShortcutLabels("sessions", tabs)).toEqual([IS_MAC ? "⌘2" : "Ctrl+2"]);
	expect(tabShortcutLabels("inbox", tabs)).toEqual([IS_MAC ? "⌘4" : "Ctrl+4", "G then I"]);
	expect(tabShortcutLabels("settings", tabs)).toEqual([IS_MAC ? "⌘5" : "Ctrl+5"]);
	expect(tabShortcutLabels("todo", tabs)).toEqual([]);
	expect(tabShortcutLabels("tickets", tabs)).toEqual([]);
	expect(tabShortcutLabels("inbox", [])).toEqual(["G then I"]);
	expect(tabShortcutLabels("help", tabs)).toEqual(["?"]);
});
