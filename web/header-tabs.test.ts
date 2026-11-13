import { describe, expect, test } from "bun:test";
import { closeHeaderTab, decodeHeaderTabs, encodeHeaderTabs, type HeaderTabs, NEW_TAB_HASH, reorderHeaderTabs, visitHeaderTab } from "./header-tabs";

const EMPTY: HeaderTabs = { tabs: [], active: 0 };
/** The row after going through `hashes` in turn, a `+` prefix asking for a new tab as the + button does. */
const browse = (hashes: string[], row: HeaderTabs = EMPTY): HeaderTabs =>
	hashes.reduce((current, hash, index) => (hash.startsWith("+") ? visitHeaderTab(current, hash.slice(1), true, `t${index}`) : visitHeaderTab(current, hash, false, `t${index}`)), row);
const shown = (row: HeaderTabs): string[] => row.tabs.map((tab, index) => (index === row.active ? `*${tab.hash}` : tab.hash));

describe("visitHeaderTab", () => {
	test("going to another page or session shows it in the tab on screen", () => {
		expect(shown(browse(["#pull-requests", "#past/a", "#todo"]))).toEqual(["*#todo"]);
	});

	test("only a new-tab request adds a tab", () => {
		expect(shown(browse(["#pull-requests", "+#new", "#past/a"]))).toEqual(["#pull-requests", "*#past/a"]);
	});

	test("a session another tab shows focuses that tab instead of opening it twice", () => {
		expect(shown(browse(["#past/a", "+#new", "#todo", "#past/a"]))).toEqual(["*#past/a", "#todo"]);
		expect(shown(browse(["#past/a", "+#past/a"]))).toEqual(["*#past/a"]);
	});

	test("a page can show in two tabs, since only sessions are kept to one", () => {
		expect(shown(browse(["#todo", "+#new", "#todo"]))).toEqual(["#todo", "*#todo"]);
	});

	test("a session link, which the dashboard replaces with its panes, and a visit already on screen leave the row as it is", () => {
		const row = browse(["#todo"]);
		expect(visitHeaderTab(row, "#session/abc", false, "x")).toBe(row);
		expect(visitHeaderTab(row, "#todo", false, "x")).toBe(row);
	});
});

describe("closeHeaderTab", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a"]);

	test("closing the tab on screen shows the one now in its place, else the one before", () => {
		expect(closeHeaderTab({ ...row, active: 1 }, "t1", "x")).toEqual({ row: { tabs: [row.tabs[0]!, row.tabs[2]!], active: 1 }, go: "#past/a" });
		expect(closeHeaderTab(row, "t2", "x").go).toBe("#todo");
	});

	test("closing another tab keeps the one on screen", () => {
		expect(closeHeaderTab(row, "t0", "x")).toEqual({ row: { tabs: row.tabs.slice(1), active: 1 }, go: null });
	});

	test("closing the last tab leaves a new one on New session", () => {
		expect(closeHeaderTab(browse(["#todo"]), "t0", "fresh")).toEqual({ row: { tabs: [{ id: "fresh", hash: NEW_TAB_HASH }], active: 0 }, go: NEW_TAB_HASH });
	});
});

describe("storing", () => {
	test("a reordered row keeps the tab on screen and survives being stored and read back", () => {
		const row = browse(["#pull-requests", "+#past/a", "+#todo"]);
		const moved = reorderHeaderTabs(row, [row.tabs[2]!, row.tabs[0]!, row.tabs[1]!]);
		expect(shown(moved)).toEqual(["*#todo", "#pull-requests", "#past/a"]);
		expect(decodeHeaderTabs(encodeHeaderTabs(moved))).toEqual(moved);
	});

	test("reads an empty row from a stored value it cannot parse, such as the old list", () => {
		expect(decodeHeaderTabs("not json")).toEqual(EMPTY);
		expect(decodeHeaderTabs(JSON.stringify([{ id: "a", hash: "#todo" }]))).toEqual(EMPTY);
	});
});
