import { describe, expect, test } from "bun:test";
import { jobProgress, jobTimeLeft } from "./jobs";

describe("jobProgress", () => {
	test("reads N/M", () => expect(jobProgress(["loading", "[23/60] building"])).toEqual({ done: 23, total: 60, passed: null, failed: null }));
	test("reads N/M before punctuation", () => expect(jobProgress(["task 16/90: pass (16 pass · 0 fail)"])).toEqual({ done: 16, total: 90, passed: 16, failed: 0 }));
	test("reads N of M", () => expect(jobProgress(["task 23 of 60 done"])).toEqual({ done: 23, total: 60, passed: null, failed: null }));
	test("takes the newest count", () => expect(jobProgress(["1/60", "2/60", "noise"])?.done).toBe(2));
	test("reads pass and fail counts from the count's line or newer", () =>
		expect(jobProgress(["9 pass", "23/60", "21 pass · 2 failed"])).toEqual({ done: 23, total: 60, passed: 21, failed: 2 }));
	test("skips paths, dates, versions, and counts over their total", () => {
		expect(jobProgress(["src/a/1/2.ts", "2026/11/24", "v1.2/3", "1/2.5", "61/60"])).toBeNull();
	});
	test("reads only the latest lines", () => expect(jobProgress(["3/10", "a", "b", "c", "d", "e"])).toBeNull());
	test("answers null without a count", () => expect(jobProgress(["compiling", "12 passed"])).toBeNull());
});

describe("jobTimeLeft", () => {
	test("extrapolates the pace", () => expect(jobTimeLeft({ done: 20, total: 60, passed: null, failed: null }, 60_000)).toBe(120_000));
	test("needs some done and some left", () => {
		expect(jobTimeLeft({ done: 0, total: 60, passed: null, failed: null }, 60_000)).toBeNull();
		expect(jobTimeLeft({ done: 60, total: 60, passed: null, failed: null }, 60_000)).toBeNull();
	});
});
