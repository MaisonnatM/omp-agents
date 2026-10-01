import { describe, expect, test } from "bun:test";
import { parsePlanUsage } from "./usage";

const limit = (label: string, window: string, amount: Record<string, number>, extra: Record<string, unknown> = {}) => ({
	label,
	window: { id: window, resetsAt: 1790870400000 },
	amount,
	...extra,
});

describe("parsePlanUsage", () => {
	test("names windows by id and tier, and falls back to omp's label when two would match", () => {
		const stdout = JSON.stringify({
			reports: [
				{
					provider: "anthropic",
					limits: [
						limit("Claude 5 Hour", "5h", { remainingFraction: 0.69 }),
						limit("Claude 7 Day (Fable)", "7d", { remainingFraction: 1 }, { scope: { tier: "fable" } }),
					],
					metadata: { email: "me@example.com" },
				},
				{
					provider: "cursor",
					limits: [
						limit("Cursor Models", "monthly", { usedFraction: 0.4 }),
						limit("Other Models", "monthly", { remaining: 0, limit: 20 }),
					],
				},
			],
		});
		expect(parsePlanUsage(stdout)).toEqual([
			{
				provider: "anthropic",
				name: "Anthropic",
				account: "me@example.com",
				windows: [
					{ label: "5h", title: "Claude 5 Hour", remaining: 0.69, resetsAt: 1790870400000 },
					{ label: "7d fable", title: "Claude 7 Day (Fable)", remaining: 1, resetsAt: 1790870400000 },
				],
			},
			{
				provider: "cursor",
				name: "Cursor",
				account: null,
				windows: [
					{ label: "Cursor Models", title: "Cursor Models", remaining: 0.6, resetsAt: 1790870400000 },
					{ label: "Other Models", title: "Other Models", remaining: 0, resetsAt: 1790870400000 },
				],
			},
		]);
	});

	test("skips providers without a measurable limit and clamps overdrawn windows", () => {
		const stdout = JSON.stringify({
			reports: [
				{ provider: "github-copilot", limits: [] },
				{ provider: "zai", limits: [limit("Tokens", "5h", { used: 3 })] },
				{ provider: "kimi-code", limits: [limit("Weekly", "7d", { usedFraction: 1.25 })] },
			],
		});
		expect(parsePlanUsage(stdout)).toEqual([
			{
				provider: "kimi-code",
				name: "Kimi Code",
				account: null,
				windows: [{ label: "7d", title: "Weekly", remaining: 0, resetsAt: 1790870400000 }],
			},
		]);
	});

	test("rejects output that is not a usage report", () => {
		expect(() => parsePlanUsage("Error: not logged in")).toThrow();
		expect(() => parsePlanUsage(JSON.stringify({ generatedAt: 1 }))).toThrow("omp usage --json printed no reports");
	});
});
