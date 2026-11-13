import { describe, expect, test } from "bun:test";
import { decodeHeaderTabs, encodeHeaderTabs, type HeaderTab, headerTabKey, MAX_HEADER_TABS, moveHeaderTab, visitHeaderTab } from "./header-tabs";

const visit = (hashes: string[]): readonly HeaderTab[] => hashes.reduce<readonly HeaderTab[]>((tabs, hash, at) => visitHeaderTab(tabs, hash, at), []);
const hashes = (tabs: readonly HeaderTab[]): string[] => tabs.map(tab => tab.hash);

describe("visitHeaderTab", () => {
	test("opens a tab for each page and session you navigate to, in the order you opened them", () => {
		expect(hashes(visit(["#pull-requests", "#past/a", "#todo"]))).toEqual(["#pull-requests", "#past/a", "#todo"]);
	});

	test("focuses the page's tab where it stands when you come back, keeping where on the page you were", () => {
		const tabs = visit(["#pull-requests", "#past/a", "#todo", "#past/a", "#settings/models", "#settings/models/github"]);
		expect(hashes(tabs)).toEqual(["#pull-requests", "#past/a", "#todo", "#settings/models/github"]);
		expect(headerTabKey("#settings/models")).toBe(headerTabKey("#settings/models/github"));
	});

	test("drops the tab seen longest ago once more than the most it keeps are open", () => {
		const opened = Array.from({ length: MAX_HEADER_TABS }, (_, index) => `#past/s${index}`);
		const tabs = visit([...opened, "#past/s0", "#todo"]);
		expect(tabs).toHaveLength(MAX_HEADER_TABS);
		expect(hashes(tabs)).toEqual(["#past/s0", ...opened.slice(2), "#todo"]);
	});

	test("opens no tab for a session link, which the dashboard replaces with its panes", () => {
		expect(visit(["#session/abc"])).toEqual([]);
	});
});

describe("moveHeaderTab", () => {
	test("a reordered row survives being stored and read back, and a later visit keeps it", () => {
		const tabs = visit(["#pull-requests", "#past/a", "#todo"]);
		const moved = moveHeaderTab(tabs, headerTabKey("#todo")!, headerTabKey("#pull-requests")!, "before");
		expect(hashes(moved)).toEqual(["#todo", "#pull-requests", "#past/a"]);
		const stored = decodeHeaderTabs(encodeHeaderTabs(moved));
		expect(stored).toEqual(moved);
		expect(hashes(visitHeaderTab(stored, "#pull-requests", 10))).toEqual(["#todo", "#pull-requests", "#past/a"]);
	});

	test("reads nothing from a stored value it cannot parse", () => {
		expect(decodeHeaderTabs("not json")).toEqual([]);
		expect(decodeHeaderTabs(JSON.stringify([{ key: 1 }]))).toEqual([]);
	});
});
