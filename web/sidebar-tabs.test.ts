import { expect, test } from "bun:test";
import { bindingLabel, IS_MAC } from "./shortcuts";
import type { SidebarPanel } from "./routing";
import {
	DEFAULT_TAB_LAYOUT,
	decodeTabLayout,
	encodeTabLayout,
	hideTab,
	moveTab,
	panelOnBar,
	placedTabs,
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
	{ tab: "bots", hidden: false },
	{ tab: "sessions", hidden: false },
	{ tab: "todo", hidden: false },
	{ tab: "notes", hidden: false },
	{ tab: "calendar", hidden: false },
	{ tab: "email", hidden: false },
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
		{ tab: "email", hidden: true },
		{ tab: "bogus", hidden: true },
		{ tab: "email", hidden: false },
		{ tab: "todo", hidden: "yes" },
		{ tab: "sessions" },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "email", hidden: true },
		{ tab: "todo", hidden: false },
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
		{ tab: "sessions", hidden: false },
	]);
});

test("a layout stored before the Bots tab gets it at its default place, before Sessions, and loses the Routines tab", () => {
	const before = ["pull-requests", "tickets", "sessions", "todo", "routines", "notes", "calendar", "email"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
});

test("a layout stored before the Email tab's rename reads its inbox entry as the Email tab, in its place and hidden as it was", () => {
	const raw = JSON.stringify([
		{ tab: "inbox", hidden: true },
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sessions", hidden: false },
		{ tab: "todo", hidden: false },
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
	]);
	expect(decodeTabLayout(raw)).toEqual([
		{ tab: "email", hidden: true },
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sessions", hidden: false },
		{ tab: "todo", hidden: false },
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
	]);
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "email", -1), "todo", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "email", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "email", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "tickets", "bots", "sessions", "todo", "notes", "email", "calendar"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["tickets", "pull-requests", "bots", "sessions", "todo", "notes", "calendar", "email"]);
});

test("hideTab hides and shows any tab", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[4]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(DEFAULT_TAB_LAYOUT, "email", true)[7]).toEqual({ tab: "email", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and signed-out tabs and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1);
	expect(shownTabs(layout, new Set(["tickets"]))).toEqual(["pull-requests", "bots", "sessions", "notes", "email", "calendar"]);
});

test("placedTabs keeps the shown tabs at one place, in their order: Notes, Calendar, and Email sit in the header, the rest in the bar", () => {
	const shown = shownTabs(moveTab(DEFAULT_TAB_LAYOUT, "email", -1), new Set());
	expect(placedTabs(shown, "bar")).toEqual(["pull-requests", "tickets", "bots", "sessions", "todo"]);
	expect(placedTabs(shown, "header")).toEqual(["notes", "email", "calendar"]);
	expect(placedTabs(["sessions", "todo"], "header")).toEqual([]);
});

test("panelOnBar holds for the bar's tabs and not for Settings or the header's tabs", () => {
	const panels: SidebarPanel[] = ["pull-requests", "tickets", "bots", "sessions", "todo", "notes", "calendar", "email", "settings"];
	expect(panels.filter(panelOnBar)).toEqual(["pull-requests", "tickets", "bots", "sessions", "todo"]);
});

test("until the integrations answer, the tabs that wait on one are signed out", () => {
	expect(tabsSignedOut(undefined)).toEqual(["tickets", "email"]);
});

test("every tab of the bar takes a position key while every tab shows", () => {
	const bar = placedTabs(shownTabs(DEFAULT_TAB_LAYOUT, new Set()), "bar");
	expect(bar.map(tab => positionKey(tab, bar))).toEqual(["tab1", "tab2", "tab3", "tab4", "tab5"]);
});

test("positionKey takes the position among the tabs the bar draws, or none", () => {
	const bar = placedTabs(shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1), new Set(["tickets"])), "bar");
	expect(positionKey("pull-requests", bar)).toBe("tab1");
	expect(positionKey("bots", bar)).toBe("tab2");
	expect(positionKey("sessions", bar)).toBe("tab3");
	expect(positionKey("notes", bar)).toBeUndefined();
	expect(positionKey("email", bar)).toBeUndefined();
	expect(positionKey("todo", bar)).toBeUndefined();
	expect(positionKey("tickets", bar)).toBeUndefined();
	expect(positionKey("settings", bar)).toBeUndefined();
});

test("shortcutRows folds each drawn tab's position key into its row, drops the position rows and a tab with no key, and keeps every other shortcut", () => {
	const bar = placedTabs(shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1), new Set(["tickets"])), "bar");
	const rows = shortcutRows(bar);
	const keysOf = (id: string) => rows.find(row => row.id === id)?.keys.map(bindingLabel);
	const mod = IS_MAC ? "⌘" : "Ctrl+";
	expect(keysOf("settings")).toEqual(["G then ,"]);
	expect(keysOf("pull-requests")).toEqual([`${mod}1`]);
	expect(keysOf("bots")).toEqual([`${mod}2`]);
	expect(keysOf("sessions")).toEqual([`${mod}3`]);
	expect(keysOf("notes")).toEqual(["G then N"]);
	expect(keysOf("email")).toEqual(["G then M"]);
	expect(keysOf("calendar")).toBeUndefined();
	expect(keysOf("todo")).toBeUndefined();
	expect(keysOf("tab1")).toBeUndefined();
	expect(keysOf("switcher")).toEqual([IS_MAC ? "⌘K" : "Ctrl+K"]);
	expect(tabShortcutLabels("sessions", bar)).toEqual([`${mod}3`]);
	expect(tabShortcutLabels("email", bar)).toEqual(["G then M"]);
});
