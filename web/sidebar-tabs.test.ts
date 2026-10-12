import { expect, test } from "bun:test";
import { bindingLabel, IS_MAC } from "./shortcuts";
import {
	DEFAULT_TAB_LAYOUT,
	decodeTabLayout,
	encodeTabLayout,
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

test("decoding keeps each known tab once, never hides a pinned tab, and puts a missing tab at its default place", () => {
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

test("hideTab hides and shows a tab, but never a pinned one", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "settings", true)).toBe(DEFAULT_TAB_LAYOUT);
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[3]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and signed-out tabs and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "settings", -1);
	expect(shownTabs(layout, new Set(["tickets"]))).toEqual(["pull-requests", "sessions", "calendar", "settings", "inbox"]);
});

test("until the integrations answer, the tabs that wait on one are signed out", () => {
	expect(tabsSignedOut(undefined)).toEqual(["tickets", "inbox"]);
});

test("positionKey takes the position among the shown tabs, or none", () => {
	const tabs = shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "settings", -1), new Set(["tickets"]));
	expect(positionKey("pull-requests", tabs)).toBe("tab1");
	expect(positionKey("sessions", tabs)).toBe("tab2");
	expect(positionKey("calendar", tabs)).toBe("tab3");
	expect(positionKey("settings", tabs)).toBe("tab4");
	expect(positionKey("inbox", tabs)).toBe("tab5");
	expect(positionKey("todo", tabs)).toBeUndefined();
	expect(positionKey("tickets", tabs)).toBeUndefined();
});

test("shortcutRows folds each shown tab's position key into its row, drops the position rows and a hidden tab with no key, and keeps every other shortcut", () => {
	const tabs = shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "settings", -1), new Set(["tickets"]));
	const rows = shortcutRows(tabs);
	const keysOf = (id: string) => rows.find(row => row.id === id)?.keys.map(bindingLabel);
	const mod = IS_MAC ? "⌘" : "Ctrl+";
	expect(keysOf("settings")).toEqual([`${mod}4`]);
	expect(keysOf("pull-requests")).toEqual([`${mod}1`]);
	expect(keysOf("sessions")).toEqual([`${mod}2`]);
	expect(keysOf("calendar")).toEqual([`${mod}3`]);
	expect(keysOf("inbox")).toEqual([`${mod}5`, "G then I"]);
	expect(keysOf("todo")).toBeUndefined();
	expect(keysOf("tickets")).toBeUndefined();
	expect(keysOf("tab1")).toBeUndefined();
	expect(keysOf("switcher")).toEqual([IS_MAC ? "⌘K" : "Ctrl+K"]);
	expect(tabShortcutLabels("inbox", tabs)).toEqual([`${mod}5`, "G then I"]);
});
