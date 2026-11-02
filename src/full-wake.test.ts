import { expect, test } from "bun:test";
import { isFullWake } from "./full-wake";

/** What `pmset -g systemstate` prints with `capabilities`, as `pmset.m` in Apple's PowerManagement sources writes it. */
const systemstate = (capabilities: string): string => `Current System Capabilities are: ${capabilities}\nCurrent Power State: 4\n`;

test.each([
	["a full wake", systemstate("CPU Graphics Audio Network "), true],
	["a dark wake", systemstate("CPU Network "), false],
	["a dark wake without the network", systemstate("CPU "), false],
	["no capabilities", systemstate("None"), false],
	["output without the capabilities", "Current Power State: 4\n", true],
])("isFullWake reads %s", (_, output, awake) => {
	expect(isFullWake(output)).toBe(awake);
});
