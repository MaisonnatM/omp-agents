import { describe, expect, test } from "bun:test";
import { isBoolean, optional } from "./json";

describe("optional", () => {
	const isMaybeBoolean = optional(isBoolean);

	test("takes a missing value or one the guard takes", () => {
		expect([undefined, true, false].map(isMaybeBoolean)).toEqual([true, true, true]);
	});

	test("refuses null and values of another type", () => {
		expect([null, "true", 0].map(value => isMaybeBoolean(value))).toEqual([false, false, false]);
	});
});
