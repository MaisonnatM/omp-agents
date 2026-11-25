import { describe, expect, test } from "bun:test";
import { sleepSpans, sleptWithin } from "./sleep-log";

const LOG = [
	"2026-11-24 23:00:00 +0100 Sleep               \tEntering Sleep state due to 'Clamshell Sleep'",
	"2026-11-24 23:00:05 +0100 Wake Requests       \t[process=dasd request=SleepService]",
	"2026-11-25 03:00:00 +0100 DarkWake            \tDarkWake from Deep Idle [CDN] : due to SMC",
	"2026-11-25 03:00:20 +0100 Sleep               \tEntering Sleep state due to 'Maintenance Sleep'",
	"2026-11-25 08:30:46 +0100 Wake                \tWake from Deep Idle [CDNVA] : due to lid",
].join("\n");

describe("sleepSpans", () => {
	test("a span runs from the first Sleep to the next full Wake, through dark wakes and wake requests", () => {
		expect(sleepSpans(LOG)).toEqual([{ from: Date.parse("2026-11-24T23:00:00+01:00"), to: Date.parse("2026-11-25T08:30:46+01:00") }]);
	});

	test("sleptWithin counts only the part of each span inside the window", () => {
		const spans = [{ from: 100, to: 200 }, { from: 300, to: 400 }];
		expect(sleptWithin(spans, 150, 350)).toBe(100);
		expect(sleptWithin(spans, 200, 300)).toBe(0);
	});
});
