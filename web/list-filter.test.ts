import { describe, expect, test } from "bun:test";
import { countBy, countedOptions, DAY, groupingDisplay, withinLast } from "./list-filter";

describe("day ranges", () => {
	const NOW = 100 * DAY;

	test("a range keeps what falls on or after its start, and no range keeps everything", () => {
		expect(withinLast(NOW - 3 * DAY, 3, NOW)).toBe(true);
		expect(withinLast(NOW - 3 * DAY - 1, 3, NOW)).toBe(false);
		expect(withinLast(0, null, NOW)).toBe(true);
	});
});

describe("counted options", () => {
	test("counts each key of each item", () => {
		expect(countBy([["Bug", "Web"], ["Bug"], []], keys => keys)).toEqual(
			new Map([
				["Bug", 2],
				["Web", 1],
			]),
		);
	});

	test("most first, then by name, then a checked key with none, so you can uncheck it", () => {
		const counts = new Map([
			["Web", 1],
			["Bug", 2],
			["API", 1],
		]);
		expect(countedOptions(counts, new Set(["Gone"]))).toEqual([
			{ key: "Bug", label: "Bug", count: 2 },
			{ key: "API", label: "API", count: 1 },
			{ key: "Web", label: "Web", count: 1 },
			{ key: "Gone", label: "Gone", count: 0 },
		]);
		expect(counts.has("Gone")).toBe(false);
	});
});

describe("grouping display", () => {
	const { DEFAULT_DISPLAY, decodeDisplay, encodeDisplay } = groupingDisplay(["status", "none"], "status");

	test("a stored grouping round-trips", () => {
		expect(decodeDisplay(encodeDisplay({ grouping: "none" }))).toEqual({ grouping: "none" });
	});

	test("a missing, unreadable, or unknown grouping falls back to the default", () => {
		expect(DEFAULT_DISPLAY).toEqual({ grouping: "status" });
		expect(decodeDisplay(null)).toEqual(DEFAULT_DISPLAY);
		expect(decodeDisplay("not json")).toEqual(DEFAULT_DISPLAY);
		expect(decodeDisplay(JSON.stringify({ grouping: "day" }))).toEqual(DEFAULT_DISPLAY);
	});
});
