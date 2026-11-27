import { describe, expect, test } from "bun:test";
import { pressureOf } from "./memory-reading";

const calm = { kernelLevel: 1, availablePercent: 60, swapOutBytesPerMin: 0 } as const;
const MB = 1024 ** 2;

describe("pressureOf", () => {
	test("plenty of memory, no swap-outs, and a normal kernel level read normal", () => {
		expect(pressureOf(calm, "normal", 0)).toBe("normal");
	});

	test("each signal alone raises pressure: the kernel level, available memory under 20% then 8%, and swap-outs", () => {
		expect(pressureOf({ ...calm, kernelLevel: 2 }, "normal", 0)).toBe("warn");
		expect(pressureOf({ ...calm, kernelLevel: 4 }, "normal", 0)).toBe("critical");
		expect(pressureOf({ ...calm, availablePercent: 19 }, "normal", 0)).toBe("warn");
		expect(pressureOf({ ...calm, availablePercent: 7 }, "normal", 0)).toBe("critical");
		expect(pressureOf({ ...calm, swapOutBytesPerMin: 128 * MB }, "normal", 0)).toBe("warn");
		expect(pressureOf({ ...calm, swapOutBytesPerMin: 512 * MB }, "normal", 0)).toBe("critical");
	});

	test("a rise counts at once, whatever the calm reads before it", () => {
		expect(pressureOf({ ...calm, kernelLevel: 4 }, "warn", 5)).toBe("critical");
	});

	test("leaving warn or critical needs 2 calm reads in a row", () => {
		expect(pressureOf(calm, "warn", 1)).toBe("warn");
		expect(pressureOf(calm, "warn", 2)).toBe("normal");
		expect(pressureOf({ ...calm, availablePercent: 15 }, "critical", 1)).toBe("critical");
		expect(pressureOf({ ...calm, availablePercent: 15 }, "critical", 2)).toBe("warn");
	});

	test("after an unknown read, pressure is what the new read says", () => {
		expect(pressureOf(calm, "unknown", 0)).toBe("normal");
		expect(pressureOf({ ...calm, availablePercent: 15 }, "unknown", 0)).toBe("warn");
	});
});
