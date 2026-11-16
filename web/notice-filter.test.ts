import { describe, expect, test } from "bun:test";
import type { Notice } from "../src/shared/notices";
import { DAY } from "./list-filter";
import { decodeDisplay, decodeFilter, encodeDisplay, encodeFilter, filters, groupedNotices, keepsNotice, listNotice, NO_FILTER, sourceOptions, withoutFilters } from "./notice-filter";

const NOW = 100 * DAY;
const base = { seen: false, read: false };
const slack = (id: string, text: string, overrides: Partial<Notice> = {}): Notice =>
	({ ...base, id, at: NOW, kind: "slack", from: "Ana", avatarUrl: null, text, permalink: "https://slack.test", type: "dm", count: 1, ...overrides }) as Notice;
const omp = (id: string, overrides: Partial<Notice> = {}): Notice =>
	({ ...base, id, at: NOW, kind: "omp", current: "1.0.0", latest: "1.1.0", status: { state: "available" }, ...overrides }) as Notice;

const listed = (notices: Notice[]) => notices.map(notice => listNotice(notice, NOW));
const kept = (notices: Notice[], filter = NO_FILTER, query = "") =>
	listed(notices)
		.filter(item => keepsNotice(item, filter, query, NOW))
		.map(({ notice }) => notice.id);

describe("filtering notices", () => {
	test("the Unread tab keeps unread notices only", () => {
		expect(kept([slack("a", "hi"), slack("b", "yo", { read: true })], { ...NO_FILTER, view: "unread" })).toEqual(["a"]);
	});

	test("Source keeps the checked sources, none checked keeps all", () => {
		const notices = [slack("a", "hi"), omp("b")];
		expect(kept(notices)).toEqual(["a", "b"]);
		expect(kept(notices, { ...NO_FILTER, sources: new Set(["updates"]) })).toEqual(["b"]);
	});

	test("Received keeps notices within the range, the boundary included", () => {
		const notices = [slack("edge", "hi", { at: NOW - 3 * DAY }), slack("old", "hi", { at: NOW - 3 * DAY - 1 })];
		expect(kept(notices, { ...NO_FILTER, received: 3 })).toEqual(["edge"]);
	});

	test("the search needs every word, in the text or the source name, whatever the case", () => {
		const notices = [slack("a", "Deploy is green"), omp("b")];
		expect(kept(notices, NO_FILTER, "deploy GREEN")).toEqual(["a"]);
		expect(kept(notices, NO_FILTER, "deploy red")).toEqual([]);
		expect(kept(notices, NO_FILTER, "slack")).toEqual(["a"]);
		expect(kept(notices, NO_FILTER, "  ")).toEqual(["a", "b"]);
	});

	test("Source options count unread notices", () => {
		const options = sourceOptions(listed([slack("a", "hi"), slack("b", "yo", { read: true }), omp("c", { read: true })]));
		expect(options.find(({ key }) => key === "slack")?.count).toBe(1);
		expect(options.find(({ key }) => key === "updates")?.count).toBe(0);
	});

	test("the tab is not a filter, and clearing the filters keeps it", () => {
		const filter = { ...NO_FILTER, view: "unread" as const, received: 7 as const };
		expect(filters({ ...NO_FILTER, view: "unread" })).toBe(false);
		expect(filters(filter)).toBe(true);
		expect(withoutFilters(filter)).toEqual({ ...NO_FILTER, view: "unread" });
	});
});

describe("stored filter and display", () => {
	test("a stored filter round-trips", () => {
		const filter = { view: "unread" as const, sources: new Set(["slack", "github"] as const), received: 14 as const };
		expect(decodeFilter(encodeFilter(filter))).toEqual(filter);
	});

	test("unreadable parts fall back to no filter", () => {
		expect(decodeFilter(null)).toEqual(NO_FILTER);
		expect(decodeFilter("not json")).toEqual(NO_FILTER);
		expect(decodeFilter(JSON.stringify({ view: "starred", sources: ["slack", "fax"], received: 5 }))).toEqual({ ...NO_FILTER, sources: new Set(["slack"]) });
	});

	test("an unknown grouping falls back to New and earlier", () => {
		expect(decodeDisplay(encodeDisplay({ grouping: "source" }))).toEqual({ grouping: "source" });
		expect(decodeDisplay(JSON.stringify({ grouping: "day" }))).toEqual({ grouping: "new" });
		expect(decodeDisplay(null)).toEqual({ grouping: "new" });
	});
});

describe("grouping", () => {
	const notices = listed([omp("u-read", { read: true }), slack("s-read", "a", { read: true }), slack("s-unread", "b"), omp("u-unread")]);
	const shape = (grouping: "new" | "source" | "none") => groupedNotices(grouping, notices).map(({ key, title, items }) => [key, title, items.map(({ notice }) => notice.id)]);

	test("New and earlier splits unread from read", () => {
		expect(shape("new")).toEqual([
			["new", "New", ["s-unread", "u-unread"]],
			["earlier", "Earlier", ["u-read", "s-read"]],
		]);
	});

	test("Source groups in source order, unread first, under keys apart from the default's", () => {
		expect(shape("source")).toEqual([
			["source:slack", "Slack", ["s-unread", "s-read"]],
			["source:updates", "Updates", ["u-unread", "u-read"]],
		]);
	});

	test("No grouping lists them all unread first, untitled", () => {
		expect(shape("none")).toEqual([["none", null, ["s-unread", "u-unread", "u-read", "s-read"]]]);
	});

	test("empty groups are left out", () => {
		expect(groupedNotices("new", [])).toEqual([]);
	});
});
