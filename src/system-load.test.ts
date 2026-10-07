import { describe, expect, test } from "bun:test";
import { busyPercent } from "./system-load";

describe("busyPercent", () => {
	test("is the busy share of the CPU time that passed between two samples, not since boot", () => {
		expect(busyPercent({ busy: 9000, total: 10000 }, { busy: 9250, total: 11000 })).toBe(25);
	});

	test("is null when no CPU time passed", () => {
		expect(busyPercent({ busy: 5, total: 10 }, { busy: 5, total: 10 })).toBeNull();
	});
});
