import { describe, expect, test } from "bun:test";
import {
	CLOSED_TABS_KEPT,
	closeHeaderTab,
	closeOtherHeaderTabs,
	closeRightHeaderTabs,
	decodeHeaderTabs,
	duplicateHeaderTab,
	encodeHeaderTabs,
	type HeaderTabs,
	type HeaderTabVisit,
	NEW_TAB_HASH,
	pinHeaderTab,
	reopenHeaderTab,
	reorderHeaderTabs,
	stepHeaderTab,
	TAB_HISTORY_LIMIT,
	visitHeaderTab,
} from "./header-tabs";

const EMPTY: HeaderTabs = { tabs: [], active: 0, closed: [] };
const VISITS: Record<string, HeaderTabVisit> = { "+": "new-tab", "=": "replace" };
/** The row after going through `hashes` in turn, a `+` prefix asking for a new tab as the + button does, and a `=` replacing the entry on screen as a page that picks what it opens does. */
const browse = (hashes: string[], row: HeaderTabs = EMPTY): HeaderTabs =>
	hashes.reduce((current, hash, index) => {
		const visit = VISITS[hash[0] ?? ""];
		return visit ? visitHeaderTab(current, hash.slice(1), visit, `t${index}`) : visitHeaderTab(current, hash, "push", `t${index}`);
	}, row);
/** Each tab's hash, `*` before the one on screen and `^` before a pinned one. */
const shown = (row: HeaderTabs): string[] => row.tabs.map((tab, index) => `${index === row.active ? "*" : ""}${tab.pinned ? "^" : ""}${tab.hash}`);
/** The row after `steps` through the history of the tab on screen, `-1` for Back and `1` for Forward, each of which must move. */
const walk = (row: HeaderTabs, ...steps: (-1 | 1)[]): HeaderTabs =>
	steps.reduce((current, by) => {
		const step = stepHeaderTab(current, by);
		if (step === null) throw new Error(`could not step ${by} from ${shown(current).join(" ")}`);
		return step.row;
	}, row);
/** Selects tab `index`, as a click on it or ⌘1 to ⌘9 do. */
const select = (row: HeaderTabs, index: number): HeaderTabs => ({ ...row, active: index });
/** The row after closing tab `id`, as the × does. */
const close = (row: HeaderTabs, id: string): HeaderTabs => closeHeaderTab(row, id, "fresh").row;
/** The row after Reopen closed tab, which must have a tab to reopen. */
const reopen = (row: HeaderTabs): HeaderTabs => {
	const reopened = reopenHeaderTab(row);
	if (reopened === null) throw new Error("no closed tab to reopen");
	return reopened.row;
};

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
		expect(visitHeaderTab(row, "#session/abc", "push", "x")).toBe(row);
		expect(visitHeaderTab(row, "#todo", "push", "x")).toBe(row);
	});
});

describe("each tab's own Back and Forward", () => {
	test("Back and Forward move through what the tab on screen showed and leave the other tabs as they are", () => {
		const row = browse(["#todo", "#bots", "+#new", "#sport"]);
		const back = walk(select(row, 0), -1);
		expect(stepHeaderTab(select(row, 0), -1)?.go).toBe("#todo");
		expect(shown(back)).toEqual(["*#todo", "#sport"]);
		expect(back.tabs[1]).toBe(row.tabs[1]);
		expect(shown(walk(back, 1))).toEqual(["*#bots", "#sport"]);
		expect(shown(walk(select(row, 1), -1))).toEqual(["#bots", "*#new"]);
	});

	test("Back stops at the first entry of a tab, and Forward at the last", () => {
		const row = browse(["#todo", "#bots"]);
		expect(stepHeaderTab(row, 1)).toBeNull();
		expect(stepHeaderTab(walk(row, -1), -1)).toBeNull();
		expect(stepHeaderTab(browse(["#todo", "+#new"]), -1)).toBeNull();
	});

	test("going somewhere after Back drops what Forward would show, as a browser does", () => {
		const row = browse(["#sport"], walk(browse(["#todo", "#bots"]), -1));
		expect(stepHeaderTab(row, 1)).toBeNull();
		expect(shown(walk(row, -1))).toEqual(["*#todo"]);
	});

	test("Back to a session that another tab now shows stays in the tab on screen", () => {
		const row = browse(["#past/a", "#todo", "+#new", "#past/a"]);
		expect(shown(row)).toEqual(["#todo", "*#past/a"]);
		const back = walk(select(row, 0), -1);
		expect(shown(back)).toEqual(["*#past/a", "#past/a"]);
		expect(visitHeaderTab(back, "#past/a", "push", "x")).toBe(back);
	});

	test("a session another tab shows focuses that tab without adding to either tab's history", () => {
		const row = browse(["#past/a", "+#new", "#todo", "#past/a"]);
		expect(stepHeaderTab(row, -1)).toBeNull();
		expect(shown(walk(select(row, 1), -1))).toEqual(["#past/a", "*#new"]);
	});

	test("a replace changes the entry on screen and keeps the tab's Back and Forward, as a page that picks what it opens does", () => {
		const row = browse(["#todo", "#bots", "#sport"]);
		const replaced = browse(["=#bots/a"], walk(row, -1));
		expect(shown(replaced)).toEqual(["*#bots/a"]);
		expect(shown(walk(replaced, -1))).toEqual(["*#todo"]);
		expect(shown(walk(replaced, 1))).toEqual(["*#sport"]);
	});

	test("a tab's Back keeps its latest entries only", () => {
		const sessions = Array.from({ length: TAB_HISTORY_LIMIT + 10 }, (_, index) => `#past/s${index}`);
		const row = browse(sessions);
		expect(row.tabs[0]?.back).toHaveLength(TAB_HISTORY_LIMIT);
		expect(row.tabs[0]?.back[0]).toBe(sessions[9]);
	});

	test("a pinned tab follows where you go in it and stays pinned", () => {
		const row = pinHeaderTab(browse(["#todo"]), "t0", true);
		expect(shown(browse(["#sport"], row))).toEqual(["*^#sport"]);
	});
});

describe("closeHeaderTab", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a"]);

	test("closing the tab on screen shows the one now in its place, else the one before", () => {
		const closed = closeHeaderTab({ ...row, active: 1 }, "t1", "x");
		expect(shown(closed.row)).toEqual(["#pull-requests", "*#past/a"]);
		expect(closed.go).toBe("#past/a");
		expect(closeHeaderTab(row, "t2", "x").go).toBe("#todo");
	});

	test("closing another tab keeps the one on screen", () => {
		const closed = closeHeaderTab(row, "t0", "x");
		expect(shown(closed.row)).toEqual(["#todo", "*#past/a"]);
		expect(closed.go).toBeNull();
	});

	test("closing the last tab leaves a new one on New session, with no history", () => {
		const closed = closeHeaderTab(browse(["#todo", "#bots"]), "t0", "fresh");
		expect(closed.row.tabs).toEqual([{ id: "fresh", hash: NEW_TAB_HASH, back: [], forward: [] }]);
		expect(closed.go).toBe(NEW_TAB_HASH);
	});

	test("a pinned tab stays open until it is unpinned", () => {
		const pinned = pinHeaderTab(row, "t1", true);
		expect(closeHeaderTab(pinned, "t1", "x")).toEqual({ row: pinned, go: null });
		expect(shown(close(pinHeaderTab(pinned, "t1", false), "t1"))).toEqual(["#pull-requests", "*#past/a"]);
	});
});

describe("reopenHeaderTab", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a"]);

	test("brings the last closed tab back at its place, on screen, with its page and id", () => {
		const closed = close(row, "t1");
		const reopened = reopenHeaderTab(closed);
		expect(reopened?.go).toBe("#todo");
		expect(reopened?.row.tabs[1]).toEqual(row.tabs[1]!);
		expect(shown(reopened!.row)).toEqual(["#pull-requests", "*#todo", "#past/a"]);
	});

	test("a reopened tab keeps its own Back and Forward", () => {
		const walked = walk(browse(["#sport", "#bots"], row), -1);
		expect(shown(walk(reopen(close(walked, "t2")), -1, 1, 1))).toEqual(["#pull-requests", "#todo", "*#bots"]);
	});

	test("reopens the closed tabs latest first, each where it was", () => {
		expect(shown(reopen(reopen(close(close(row, "t0"), "t2"))))).toEqual(["*#pull-requests", "#todo", "#past/a"]);
	});

	test("reopens nothing once every closed tab is back", () => {
		expect(reopenHeaderTab(row)).toBeNull();
		expect(reopenHeaderTab(reopen(close(row, "t1")))).toBeNull();
	});

	test("a closed session another tab shows by now focuses that tab", () => {
		const elsewhere = browse(["#past/a"], close(row, "t2"));
		const reopened = reopenHeaderTab(elsewhere);
		expect(shown(reopened!.row)).toEqual(["#pull-requests", "*#past/a"]);
		expect(reopened?.row.closed).toEqual([]);
	});

	test("an unpinned tab comes back after the pinned ones, a pinned one among them", () => {
		const pinned = pinHeaderTab(pinHeaderTab(row, "t1", true), "t2", true);
		expect(shown(reopen(close(pinHeaderTab(pinned, "t2", false), "t2")))).toEqual(["^#todo", "*#past/a", "#pull-requests"]);
		const closedPinned = { ...pinned, closed: [{ tab: { id: "z", hash: "#sport", back: [], forward: [], pinned: true as const }, index: 5 }] };
		expect(shown(reopen(closedPinned))).toEqual(["^#todo", "^#past/a", "*^#sport", "#pull-requests"]);
	});

	test("keeps the latest closed tabs only", () => {
		const many = Array.from({ length: CLOSED_TABS_KEPT + 5 }, (_, index) => `+#past/s${index}`);
		const closedAll = browse(many).tabs.reduce((current, tab) => close(current, tab.id), browse(many));
		expect(closedAll.closed).toHaveLength(CLOSED_TABS_KEPT);
		expect(closedAll.closed.at(-1)?.tab.hash).toBe(`#past/s${CLOSED_TABS_KEPT + 4}`);
	});
});

describe("closeOtherHeaderTabs", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a", "+#sport"]);

	test("keeps the pinned tabs and the one asked for, which goes on screen, and Reopen closed tab brings the others back from the left", () => {
		const pinned = pinHeaderTab({ ...row, active: 2 }, "t3", true);
		const closed = closeOtherHeaderTabs(pinned, "t1");
		expect(closed?.go).toBe("#todo");
		expect(shown(closed!.row)).toEqual(["^#sport", "*#todo"]);
		expect(shown(reopen(closed!.row))).toEqual(["^#sport", "*#pull-requests", "#todo"]);
		expect(shown(reopen(reopen(closed!.row)))).toEqual(["^#sport", "#pull-requests", "#todo", "*#past/a"]);
	});

	test("closes nothing when only pinned tabs are left beside it", () => {
		expect(closeOtherHeaderTabs(browse(["#todo"]), "t0")).toBeNull();
	});
});

describe("closeRightHeaderTabs", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a", "+#sport"]);

	test("closes the unpinned tabs after the one asked for, keeping the one on screen, and Reopen closed tab brings them back from the left", () => {
		const pinned = pinHeaderTab(row, "t3", true);
		const closed = closeRightHeaderTabs(pinned, "t0");
		expect(closed?.go).toBeNull();
		expect(shown(closed!.row)).toEqual(["*^#sport", "#pull-requests"]);
		expect(shown(reopen(closed!.row))).toEqual(["^#sport", "#pull-requests", "*#todo"]);
		expect(shown(closeRightHeaderTabs(pinned, "t3")!.row)).toEqual(["*^#sport"]);
	});

	test("puts the tab asked for on screen when the one on screen closes", () => {
		const closed = closeRightHeaderTabs(row, "t1");
		expect(closed?.go).toBe("#todo");
		expect(shown(closed!.row)).toEqual(["#pull-requests", "*#todo"]);
	});

	test("closes nothing from the last tab", () => {
		expect(closeRightHeaderTabs(row, "t3")).toBeNull();
	});
});

describe("duplicateHeaderTab", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a"]);

	test("opens a copy right after the tab, on screen, on its page", () => {
		const duplicated = duplicateHeaderTab(row, "t0", "copy");
		expect(duplicated?.go).toBe("#pull-requests");
		expect(duplicated?.row.tabs[1]).toEqual({ id: "copy", hash: "#pull-requests", back: [], forward: [] });
		expect(shown(duplicated!.row)).toEqual(["#pull-requests", "*#pull-requests", "#todo", "#past/a"]);
	});

	test("the copy starts with the tab's Back and Forward, then keeps its own", () => {
		const walked = walk(browse(["#sport", "#bots"], row), -1);
		const copy = browse(["#todo"], duplicateHeaderTab(walked, "t2", "copy")!.row);
		expect(shown(walk(copy, -1, -1))).toEqual(["#pull-requests", "#todo", "#sport", "*#past/a"]);
		expect(shown(walk(select(copy, 2), 1))).toEqual(["#pull-requests", "#todo", "*#bots", "#todo"]);
	});

	test("puts the unpinned copy of a pinned tab first of the others", () => {
		expect(shown(duplicateHeaderTab(pinHeaderTab(row, "t2", true), "t2", "copy")!.row)).toEqual(["^#past/a", "*#past/a", "#pull-requests", "#todo"]);
	});

	test("a duplicated session shows in both tabs: going to it stays in the copy on screen, and from another tab focuses the first", () => {
		const duplicated = duplicateHeaderTab(row, "t2", "copy")!.row;
		expect(visitHeaderTab(duplicated, "#past/a", "push", "x")).toBe(duplicated);
		expect(shown(browse(["#past/a"], { ...duplicated, active: 0 }))).toEqual(["#pull-requests", "#todo", "*#past/a", "#past/a"]);
	});
});

describe("pinHeaderTab", () => {
	const row = browse(["#pull-requests", "+#todo", "+#past/a"]);

	test("moves a pinned tab after the other pinned ones, and an unpinned one first of the rest, the same tab on screen", () => {
		const one = pinHeaderTab(row, "t2", true);
		expect(shown(one)).toEqual(["*^#past/a", "#pull-requests", "#todo"]);
		const two = pinHeaderTab(one, "t1", true);
		expect(shown(two)).toEqual(["*^#past/a", "^#todo", "#pull-requests"]);
		expect(shown(pinHeaderTab(two, "t2", false))).toEqual(["^#todo", "*#past/a", "#pull-requests"]);
	});

	test("pinning a tab keeps its Back and Forward", () => {
		const pinned = pinHeaderTab(walk(browse(["#sport", "#bots"], row), -1), "t2", true);
		expect(shown(walk(pinned, -1))).toEqual(["*^#past/a", "#pull-requests", "#todo"]);
		expect(shown(walk(pinned, 1))).toEqual(["*^#bots", "#pull-requests", "#todo"]);
	});

	test("a reorder keeps the pinned tabs first", () => {
		const pinned = pinHeaderTab(row, "t0", true);
		expect(shown(reorderHeaderTabs(pinned, [pinned.tabs[1]!, pinned.tabs[2]!, pinned.tabs[0]!]))).toEqual(["^#pull-requests", "#todo", "*#past/a"]);
	});
});

describe("storing", () => {
	test("a reordered row with pinned and closed tabs keeps the tab on screen and survives being stored and read back", () => {
		const row = browse(["#pull-requests", "+#past/a", "+#todo", "+#sport"]);
		const moved = close(pinHeaderTab(reorderHeaderTabs(row, [row.tabs[2]!, row.tabs[0]!, row.tabs[1]!, row.tabs[3]!]), "t1", true), "t3");
		expect(shown(moved)).toEqual(["^#past/a", "#todo", "*#pull-requests"]);
		expect(decodeHeaderTabs(encodeHeaderTabs(moved))).toEqual(moved);
	});

	test("keeps each tab's history, also a closed tab's, so a reopened tab has it", () => {
		const row = close(visitHeaderTab(walk(browse(["#todo", "#bots", "#sport"]), -1), NEW_TAB_HASH, "new-tab", "n"), "t0");
		expect(row.closed[0]?.tab).toMatchObject({ hash: "#bots", back: ["#todo"], forward: ["#sport"] });
		expect(decodeHeaderTabs(encodeHeaderTabs(row))).toEqual(row);
	});

	test("reads an empty row from a stored value it cannot parse, such as the old list", () => {
		expect(decodeHeaderTabs("not json")).toEqual(EMPTY);
		expect(decodeHeaderTabs(JSON.stringify([{ id: "a", hash: "#todo" }]))).toEqual(EMPTY);
	});

	test("reads a row stored before pinned and closed tabs and tab histories, and puts stored pinned tabs first", () => {
		expect(decodeHeaderTabs(JSON.stringify({ tabs: [{ id: "a", hash: "#todo" }], active: 0 }))).toEqual({ tabs: [{ id: "a", hash: "#todo", back: [], forward: [] }], active: 0, closed: [] });
		const stored = { tabs: [{ id: "a", hash: "#todo" }, { id: "b", hash: "#sport", pinned: true }], active: 0, closed: [{ tab: { id: "c" }, index: 0 }] };
		expect(shown(decodeHeaderTabs(JSON.stringify(stored)))).toEqual(["^#sport", "*#todo"]);
		expect(decodeHeaderTabs(JSON.stringify(stored)).closed).toEqual([]);
	});
});
