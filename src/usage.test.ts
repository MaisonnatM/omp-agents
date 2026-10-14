import { describe, expect, test } from "bun:test";
import { parsePlanUsage } from "./usage";

const limit = (label: string, window: string, amount: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
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
						limit("Claude 5 Hour", "5h", { remainingFraction: 0.69 }, { id: "anthropic:5h" }),
						limit("Claude 7 Day (Fable)", "7d", { remainingFraction: 1 }, { id: "anthropic:7d:fable", scope: { tier: "fable" } }),
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
					{ id: "anthropic:5h", label: "5h", title: "Claude 5 Hour", remaining: 0.69, resetsAt: 1790870400000, exhausted: false },
					{ id: "anthropic:7d:fable", label: "7d fable", title: "Claude 7 Day (Fable)", remaining: 1, resetsAt: 1790870400000, exhausted: false },
				],
				extra: null,
				resetCredits: null,
			},
			{
				provider: "cursor",
				name: "Cursor",
				account: null,
				windows: [
					{ id: "monthly", label: "Cursor Models", title: "Cursor Models", remaining: 0.6, resetsAt: 1790870400000, exhausted: false },
					{ id: "monthly", label: "Other Models", title: "Other Models", remaining: 0, resetsAt: 1790870400000, exhausted: true },
				],
				extra: null,
				resetCredits: null,
			},
		]);
	});

	test("takes omp's status over the amount left, so an allowed overdraft is not used up", () => {
		const stdout = JSON.stringify({
			reports: [
				{
					provider: "openai-codex",
					limits: [
						limit("5 Hour", "5h", { remainingFraction: 0 }, { id: "openai-codex:primary", status: "warning" }),
						limit("7 Day", "7d", { remainingFraction: 0.01 }, { id: "openai-codex:secondary", status: "exhausted" }),
					],
				},
			],
		});
		expect(parsePlanUsage(stdout)[0]?.windows.map(({ id, exhausted }) => [id, exhausted])).toEqual([
			["openai-codex:primary", false],
			["openai-codex:secondary", true],
		]);
	});

	test("counts the banked reset credits and dates the soonest one omp counts, usable now or not", () => {
		const report = (resetCredits: unknown) => ({ provider: "openai-codex", limits: [limit("5 Hour", "5h", { remainingFraction: 1 })], resetCredits });
		const stdout = JSON.stringify({
			reports: [
				report({
					availableCount: 3,
					credits: [
						{ expiresAt: "2026-10-01T00:00:00Z", status: "redeemed" },
						{ expiresAt: "2026-10-05T00:00:00Z", status: "expired" },
						{ expiresAt: "2026-10-08T00:00:00Z", status: "unavailable", remainingCount: 0 },
						{ expiresAt: "2026-10-29T00:00:00Z", status: "available" },
						{ expiresAt: "2026-10-15T00:00:00Z", status: "paused" },
						{ expiresAt: "2026-10-22T00:00:00Z" },
					],
				}),
				report({ availableCount: 0, credits: [{ expiresAt: "2026-10-22T00:00:00Z", status: "redeemed" }] }),
				report({ availableCount: 1 }),
				report(null),
			],
		});
		expect(parsePlanUsage(stdout).map(plan => plan.resetCredits)).toEqual([
			{ count: 3, nextExpiresAt: Date.parse("2026-10-15T00:00:00Z") },
			null,
			{ count: 1, nextExpiresAt: null },
			null,
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
				windows: [{ id: "7d", label: "7d", title: "Weekly", remaining: 0, resetsAt: 1790870400000, exhausted: true }],
				extra: null,
				resetCredits: null,
			},
		]);
	});

	test("reads a windowless USD limit as extra usage, and keeps the dollars of a USD window", () => {
		const extra = (amount: Record<string, unknown>, status?: string) => ({ id: "anthropic:extra", label: "Claude Extra Usage", amount: { unit: "usd", ...amount }, ...(status && { status }) });
		const stdout = JSON.stringify({
			reports: [
				{ provider: "anthropic", limits: [limit("Claude 5 Hour", "5h", { remainingFraction: 0.5 }), extra({ used: 12.4, limit: 50 })] },
				{ provider: "anthropic", limits: [extra({ used: 3 })] },
				{ provider: "anthropic", limits: [extra({ used: 50, limit: 50 }, "exhausted")] },
				{ provider: "cursor", limits: [limit("Other Models", "monthly", { used: 5, limit: 20, remaining: 15, unit: "usd" })] },
			],
		});
		const plans = parsePlanUsage(stdout);
		expect(plans.map(plan => [plan.windows.length, plan.extra])).toEqual([
			[1, { used: 12.4, limit: 50, title: "Claude Extra Usage", exhausted: false }],
			[0, { used: 3, limit: null, title: "Claude Extra Usage", exhausted: false }],
			[0, { used: 50, limit: 50, title: "Claude Extra Usage", exhausted: true }],
			[1, null],
		]);
		expect(plans[3]?.windows[0]).toMatchObject({ remaining: 0.75, usd: { used: 5, limit: 20 } });
		expect(plans[0]?.windows[0]?.usd).toBeUndefined();
	});

	test("rejects output that is not a usage report", () => {
		expect(() => parsePlanUsage("Error: not logged in")).toThrow();
		expect(() => parsePlanUsage(JSON.stringify({ generatedAt: 1 }))).toThrow("omp usage --json printed no reports");
	});
});
