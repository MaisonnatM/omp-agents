import { describe, expect, test } from "bun:test";
import type { PlanUsage, PlanWindow } from "../src/shared/models";
import { RESET_MARGIN_MS } from "../src/shared/scheduled";
import { resetChoices, tomorrowMorning } from "./scheduled-model";

const NOW = new Date(2026, 9, 5, 14, 30).getTime();
const HOUR = 3_600_000;

const window = (label: string, resetsAt: number | null, exhausted = false): PlanWindow => ({ id: label, label, title: label, remaining: exhausted ? 0 : 0.5, resetsAt, exhausted });
const plan = (name: string, account: string | null, windows: PlanWindow[]): PlanUsage => ({ provider: name.toLowerCase(), name, account, windows, extra: null, resetCredits: null });

describe("resetChoices", () => {
	test("offers used-up windows first, then the soonest reset, each a margin after it resets", () => {
		const plans = [plan("Anthropic", "me", [window("5h", NOW + 2 * HOUR), window("7d", NOW + 48 * HOUR, true)]), plan("OpenAI", null, [window("5h", NOW + HOUR)])];
		expect(resetChoices(plans, NOW)).toEqual([
			{ at: NOW + 48 * HOUR + RESET_MARGIN_MS, reset: "Anthropic 7d" },
			{ at: NOW + HOUR + RESET_MARGIN_MS, reset: "OpenAI 5h" },
			{ at: NOW + 2 * HOUR + RESET_MARGIN_MS, reset: "Anthropic 5h" },
		]);
	});

	test("names the account only when two plans share a name", () => {
		const plans = [plan("Anthropic", "work", [window("5h", NOW + HOUR)]), plan("Anthropic", "home", [window("5h", NOW + 2 * HOUR)])];
		expect(resetChoices(plans, NOW).map(choice => choice.reset)).toEqual(["Anthropic · work 5h", "Anthropic · home 5h"]);
	});

	test("leaves out windows with no reset time or one already past", () => {
		expect(resetChoices([plan("Anthropic", null, [window("5h", null, true), window("7d", NOW), window("monthly", NOW - HOUR)])], NOW)).toEqual([]);
	});
});

test("tomorrowMorning is 9:00 the next day, across a month's end", () => {
	expect(tomorrowMorning(NOW)).toBe(new Date(2026, 9, 6, 9).getTime());
	expect(tomorrowMorning(new Date(2026, 9, 31, 23, 50).getTime())).toBe(new Date(2026, 10, 1, 9).getTime());
});
