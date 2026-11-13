import { describe, expect, test } from "bun:test";
import { closeHeaderTab, decodeHeaderTabs, encodeHeaderTabs, type HeaderTab, headerTabKeyOf, visitHeaderTab } from "./header-tabs";
import { moveBy } from "./order";

/** The row after going through `hashes` in turn from a first tab, a `null` asking for a new tab as + does. */
const browse = (hashes: (string | null)[]): readonly HeaderTab[] => {
	let tabs: readonly HeaderTab[] = [];
	let from: string | null = null;
	for (const [index, hash] of hashes.entries()) {
		if (hash === null) {
			from = null;
			continue;
		}
		tabs = visitHeaderTab(tabs, from, hash, `t${index}`);
		from = hash;
	}
	return tabs;
};
const hashes = (tabs: readonly HeaderTab[]): string[] => tabs.map(tab => tab.hash);

describe("visitHeaderTab", () => {
	test("going to another page or session shows it in the same tab", () => {
		const tabs = browse(["#pull-requests", "#past/a", "#todo"]);
		expect(hashes(tabs)).toEqual(["#todo"]);
		expect(tabs[0]?.id).toBe("t0");
	});

	test("only a new tab, as + asks, adds one to the row", () => {
		expect(hashes(browse(["#pull-requests", null, "#new", "#past/a"]))).toEqual(["#pull-requests", "#past/a"]);
	});

	test("going to what another tab shows focuses that tab rather than opening it twice", () => {
		const tabs = browse(["#pull-requests", null, "#todo", "#settings/models/github"]);
		expect(hashes(visitHeaderTab(tabs, "#settings/models/github", "#pull-requests", "x"))).toEqual(["#pull-requests", "#settings/models/github"]);
		expect(visitHeaderTab(tabs, "#pull-requests", "#settings/models", "x").map(tab => tab.id)).toEqual(tabs.map(tab => tab.id));
	});

	test("a session link, which the dashboard replaces with its panes, leaves the row as it is", () => {
		const tabs = browse(["#todo"]);
		expect(visitHeaderTab(tabs, "#todo", "#session/abc", "x")).toBe(tabs);
		expect(headerTabKeyOf("#session/abc")).toBeNull();
	});

	test("a visit the row already shows gives back the same row, so a render stores nothing", () => {
		const tabs = browse(["#pull-requests", null, "#todo"]);
		expect(visitHeaderTab(tabs, "#pull-requests", "#todo", "x")).toBe(tabs);
	});
});

describe("closeHeaderTab", () => {
	test("closing the tab on screen shows the one now in its place, else the one before, else the home", () => {
		const tabs = browse(["#pull-requests", null, "#todo", null, "#past/a"]);
		expect(closeHeaderTab(tabs, "t2", "t2").go).toBe("#past/a");
		expect(closeHeaderTab(tabs, "t4", "t4").go).toBe("#todo");
		expect(closeHeaderTab(browse(["#todo"]), "t0", "t0").go).toBe("");
		expect(closeHeaderTab(tabs, "t0", "t2")).toEqual({ tabs: tabs.slice(1), go: null });
	});
});

describe("reordering", () => {
	test("a reordered row survives being stored and read back, and a later visit keeps it", () => {
		const tabs = browse(["#pull-requests", null, "#past/a", null, "#todo"]);
		const moved = moveBy(tabs, tab => tab.id, "t4", "t0", "before");
		expect(hashes(moved)).toEqual(["#todo", "#pull-requests", "#past/a"]);
		const stored = decodeHeaderTabs(encodeHeaderTabs(moved));
		expect(stored).toEqual(moved);
		expect(hashes(visitHeaderTab(stored, "#todo", "#pull-requests", "x"))).toEqual(["#todo", "#pull-requests", "#past/a"]);
	});

	test("reads nothing from a stored value it cannot parse", () => {
		expect(decodeHeaderTabs("not json")).toEqual([]);
		expect(decodeHeaderTabs(JSON.stringify([{ hash: "#todo" }]))).toEqual([]);
	});
});
