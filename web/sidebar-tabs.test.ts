import { expect, test } from "bun:test";
import { type Page, routeFromHash } from "./routing";
import { bindingLabel, IS_MAC } from "./shortcuts";
import {
	DEFAULT_TAB_LAYOUT,
	decodeTabLayout,
	encodeTabLayout,
	hideTab,
	moveTab,
	navRowOf,
	pageSpace,
	positionKey,
	shortcutRows,
	shownTabs,
	tabSpace,
	tabsOutOfSpace,
	tabsSignedOut,
	tabShortcutLabels,
	type TabLayout,
} from "./sidebar-tabs";

const DEFAULT: TabLayout = [
	{ tab: "pull-requests", hidden: false },
	{ tab: "tickets", hidden: false },
	{ tab: "bots", hidden: false },
	{ tab: "sessions", hidden: false },
	{ tab: "notes", hidden: false },
	{ tab: "calendar", hidden: false },
	{ tab: "todo", hidden: false },
	{ tab: "sport", hidden: false },
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
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
		{ tab: "todo", hidden: false },
		{ tab: "sport", hidden: false },
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
		{ tab: "sport", hidden: false },
		{ tab: "calendar", hidden: false },
	]);
});

test("a layout stored before the Sport tab gets it at its default place, shown", () => {
	const before = DEFAULT.filter(({ tab }) => tab !== "sport");
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(DEFAULT);
	expect(shownTabs(DEFAULT_TAB_LAYOUT, new Set())).toContain("sport");
});

test("a stored layout decodes back to itself", () => {
	const layout = hideTab(moveTab(DEFAULT_TAB_LAYOUT, "email", -1), "todo", true);
	expect(decodeTabLayout(encodeTabLayout(layout))).toEqual(layout);
});

test("moveTab swaps a tab with its neighbor and leaves a tab at either end where it is", () => {
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", -1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "email", 1)).toBe(DEFAULT_TAB_LAYOUT);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "email", -1).map(({ tab }) => tab)).toEqual(["pull-requests", "tickets", "bots", "sessions", "notes", "calendar", "todo", "email", "sport"]);
	expect(moveTab(DEFAULT_TAB_LAYOUT, "pull-requests", 1).map(({ tab }) => tab)).toEqual(["tickets", "pull-requests", "bots", "sessions", "notes", "calendar", "todo", "sport", "email"]);
});

test("hideTab hides and shows any tab", () => {
	expect(hideTab(DEFAULT_TAB_LAYOUT, "todo", true)[6]).toEqual({ tab: "todo", hidden: true });
	expect(hideTab(DEFAULT_TAB_LAYOUT, "email", true)[8]).toEqual({ tab: "email", hidden: true });
	expect(hideTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "todo", false)).toEqual(DEFAULT);
});

test("shownTabs drops hidden and signed-out tabs and keeps the order", () => {
	const layout = moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1);
	expect(shownTabs(layout, new Set(["tickets"]))).toEqual(["pull-requests", "bots", "sessions", "notes", "calendar", "email", "sport"]);
});

test("a saved order that still has Todo immediately before Notes puts it between Calendar and Sport", () => {
	const saved = ["sessions", "bots", "pull-requests", "tickets", "todo", "notes", "calendar", "email"].map(tab => ({ tab, hidden: false }));
	expect(decodeTabLayout(JSON.stringify(saved)).map(({ tab }) => tab)).toEqual(["sessions", "bots", "pull-requests", "tickets", "notes", "calendar", "todo", "sport", "email"]);
});

test("a layout stored in the old order, Todo in the bar before Notes, puts Todo between Calendar and Sport and keeps what was hidden", () => {
	const before = [
		{ tab: "pull-requests", hidden: false },
		{ tab: "tickets", hidden: false },
		{ tab: "bots", hidden: false },
		{ tab: "sessions", hidden: false },
		{ tab: "todo", hidden: true },
		{ tab: "notes", hidden: false },
		{ tab: "calendar", hidden: false },
		{ tab: "email", hidden: false },
		{ tab: "sport", hidden: false },
	];
	expect(decodeTabLayout(JSON.stringify(before))).toEqual(hideTab(DEFAULT, "todo", true));
});

test("until the integrations answer, the tabs that wait on one are signed out", () => {
	expect(tabsSignedOut(undefined)).toEqual(["tickets", "email"]);
});

test("Tickets shows only in Work and Sport only in Personal; every other tab shows in both", () => {
	expect(tabsOutOfSpace("personal")).toEqual(["tickets"]);
	expect(tabsOutOfSpace("work")).toEqual(["sport"]);
	expect(DEFAULT_TAB_LAYOUT.map(({ tab }) => tabSpace(tab))).toEqual([null, "work", null, null, null, null, null, "personal", null]);
});

const pageAt = (hash: string): Page => {
	const route = routeFromHash(hash);
	if (route.kind !== "page") throw new Error(`${hash} names no page`);
	return route.page;
};

test("a link to Sport takes the window to Personal and a link to Tickets to Work, whichever of their pages it opens", () => {
	expect(pageSpace(pageAt("#sport"))).toBe("personal");
	expect(pageSpace(pageAt("#sport/journal"))).toBe("personal");
	expect(pageSpace(pageAt("#tickets"))).toBe("work");
	expect(pageSpace(pageAt("#tickets/ENG-12"))).toBe("work");
});

test("every other page shows in both spaces and leaves the window's space as it is", () => {
	for (const hash of ["#todo", "#notes", "#calendar", "#pull-requests", "#bots", "#settings/models", "#get-started", "#scheduled"]) expect(pageSpace(pageAt(hash))).toBeNull();
});

test("in Personal the page list closes up over the absent Tickets tab, so Cmd+1 onward still go to the rows it shows in order", () => {
	const personal = shownTabs(DEFAULT_TAB_LAYOUT, new Set(tabsOutOfSpace("personal")));
	expect(personal).toEqual(["pull-requests", "bots", "sessions", "notes", "calendar", "todo", "sport", "email"]);
	expect(personal.map(tab => positionKey(tab, personal))).toEqual(["tab1", "tab2", "tab3", "tab4", "tab5", undefined, undefined, undefined]);
	expect(positionKey("tickets", personal)).toBeUndefined();
	expect(shownTabs(DEFAULT_TAB_LAYOUT, new Set(tabsOutOfSpace("work")))).not.toContain("sport");
});

test("the first five shown tabs take the position keys", () => {
	const shown = shownTabs(DEFAULT_TAB_LAYOUT, new Set());
	expect(shown.map(tab => positionKey(tab, shown))).toEqual(["tab1", "tab2", "tab3", "tab4", "tab5", undefined, undefined, undefined, undefined]);
});

test("positionKey takes the position among the shown tabs, or none", () => {
	const shown = shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1), new Set(["tickets"]));
	expect(shown).toEqual(["pull-requests", "bots", "sessions", "notes", "calendar", "email", "sport"]);
	expect(positionKey("pull-requests", shown)).toBe("tab1");
	expect(positionKey("bots", shown)).toBe("tab2");
	expect(positionKey("sessions", shown)).toBe("tab3");
	expect(positionKey("notes", shown)).toBe("tab4");
	expect(positionKey("calendar", shown)).toBe("tab5");
	expect(positionKey("email", shown)).toBeUndefined();
	expect(positionKey("todo", shown)).toBeUndefined();
	expect(positionKey("tickets", shown)).toBeUndefined();
	expect(positionKey("settings", shown)).toBeUndefined();
});

test("shortcutRows folds each shown tab's position key into its row, drops the position rows and a tab with no key, and keeps every other shortcut", () => {
	const shown = shownTabs(moveTab(hideTab(DEFAULT_TAB_LAYOUT, "todo", true), "email", -1), new Set(["tickets"]));
	const rows = shortcutRows(shown);
	const keysOf = (id: string) => rows.find(row => row.id === id)?.keys.map(bindingLabel);
	const mod = IS_MAC ? "⌘" : "Ctrl+";
	expect(keysOf("settings")).toEqual(["G then ,"]);
	expect(keysOf("pull-requests")).toEqual([`${mod}1`]);
	expect(keysOf("bots")).toEqual([`${mod}2`]);
	expect(keysOf("sessions")).toEqual([`${mod}3`]);
	expect(keysOf("notes")).toEqual([`${mod}4`, "G then N"]);
	expect(keysOf("email")).toEqual(["G then M"]);
	expect(keysOf("calendar")).toEqual([`${mod}5`]);
	expect(keysOf("todo")).toBeUndefined();
	expect(keysOf("tab1")).toBeUndefined();
	expect(keysOf("switcher")).toEqual([IS_MAC ? "⌘K" : "Ctrl+K"]);
	expect(tabShortcutLabels("sessions", shown)).toEqual([`${mod}3`]);
	expect(tabShortcutLabels("email", shown)).toEqual(["G then M"]);
});

test("the page list's current row is the page's tab, Sessions for the panes, and none for a page without a row", () => {
	const none = new Set<never>();
	expect(navRowOf(null, [], none)).toBeNull();
	expect(navRowOf(null, [{ kind: "past", sessionId: "a" }], none)).toBe("sessions");
	expect(navRowOf(pageAt("#todo"), [], none)).toBe("todo");
	expect(navRowOf(pageAt("#settings"), [], none)).toBe("settings");
	expect(navRowOf(pageAt("#new"), [], none)).toBe("new");
	expect(navRowOf(pageAt("#todo"), [], new Set(["todo"] as const))).toBeNull();
	expect(navRowOf(pageAt("#get-started"), [], none)).toBeNull();
});
