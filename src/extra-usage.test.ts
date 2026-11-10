import { describe, expect, test } from "bun:test";
import { extraUsageChange, extraUsageOn, type FallbackChains } from "./extra-usage";

const cursor: FallbackChains = { default: ["openai-codex/gpt-6.1-sol", "cursor/grok-4.7"], smol: ["cursor/grok-4.7-fast"] };

describe("extra usage switch", () => {
	test("on parks the live lists and clears them", () => {
		expect(extraUsageChange(cursor, null, true)).toEqual({ chains: {}, parked: cursor });
		expect(extraUsageOn({}, cursor)).toBe(true);
	});

	test("on again keeps the parked lists", () => {
		expect(extraUsageChange({}, cursor, true)).toEqual({ chains: {}, parked: cursor });
	});

	test("off writes the parked lists back", () => {
		expect(extraUsageChange({}, cursor, false)).toEqual({ chains: cursor, parked: null });
		expect(extraUsageOn(cursor, null)).toBe(false);
	});

	test("lists put back by a later edit count as off, and the next on parks those", () => {
		expect(extraUsageOn(cursor, { default: ["cursor/grok-4.7"] })).toBe(false);
		expect(extraUsageChange(cursor, { default: ["cursor/grok-4.7"] }, true).parked).toEqual(cursor);
	});

	test("off with nothing parked leaves the live lists", () => {
		expect(extraUsageChange(cursor, null, false)).toEqual({ chains: cursor, parked: null });
	});
});
