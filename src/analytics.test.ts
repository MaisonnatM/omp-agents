import { describe, expect, test } from "bun:test";
import { buildAnalytics, chartOf, foldSessions, sessionOfFile } from "./analytics";
import type { StatsRead, SessionModelRow } from "./omp/stats";

const root = "/home/me/.omp/agent/sessions";
const parent = `${root}/-work-app/2026-10-06T08-12-02-078Z_alpha`;
const other = `${root}/-work-app/2026-10-06T09-12-02-078Z_beta.jsonl`;

function row(sessionFile: string, selector: string, total: number, lastAt: number, subagentTokens = 0): SessionModelRow {
	return { sessionFile, selector, folder: sessionFile.slice(root.length + 1).split("/")[0]!, requests: 1, failed: 0, input: total / 2, output: total / 2, cacheRead: 0, cacheWrite: 0, subagentTokens, cost: total / 100, lastAt };
}

/** `beta`'s transcript was deleted, so only omp-stats remembers it. */
const facts = (id: string) => (id === "alpha" ? { title: "Fix billing", cwd: "/work/app" } : null);

describe("analytics session usage", () => {
	test("a nested subagent folds into its parent, and a deleted session takes its workspace from a listed neighbor", () => {
		const rows = [
			row(`${parent}.jsonl`, "openai/gpt-a", 100, 10),
			row(`${parent}/task/CasualAlbatross.jsonl`, "anthropic/claude-b", 250, 20, 250),
			row(`${parent}/__advisor.jsonl`, "anthropic/claude-b", 50, 30),
			row(other, "openai/gpt-a", 300, 40),
		];
		expect(sessionOfFile(rows[1]!.sessionFile, root)).toEqual({ sessionId: "alpha", subagent: true });
		const sessions = foldSessions(rows, root, facts);
		expect(sessions).toEqual([
			{
				sessionId: "alpha", title: "Fix billing", listed: true, cwd: "/work/app",
				usage: { requests: 3, failed: 0, tokens: { input: 200, output: 200, cacheRead: 0, cacheWrite: 0, total: 400 }, cost: 4, cacheRate: 0 },
				subagentTokens: 250, models: ["anthropic/claude-b", "openai/gpt-a"], lastAt: 30,
			},
			{
				sessionId: "beta", title: null, listed: false, cwd: "/work/app",
				usage: { requests: 1, failed: 0, tokens: { input: 150, output: 150, cacheRead: 0, cacheWrite: 0, total: 300 }, cost: 3, cacheRate: 0 },
				subagentTokens: 0, models: ["openai/gpt-a"], lastAt: 40,
			},
		]);
	});

	test("the payload sorts models and workspaces by tokens and keeps only the 20 heaviest sessions", () => {
		const model = (provider: string, model: string, tokens: number) => ({
			provider, model, totalRequests: 1, failedRequests: 0, totalInputTokens: tokens / 2, totalOutputTokens: tokens / 2,
			totalCacheReadTokens: 0, totalCacheWriteTokens: 0, cacheRate: 0, totalCost: 0.5, avgTokensPerSecond: 20,
		});
		const rows = Array.from({ length: 22 }, (_, index) =>
			row(`${root}/-work-other/2026-10-06T08-12-02-078Z_${index}.jsonl`, "openai/gpt-a", index + 1, index));
		rows.push(row(`${parent}.jsonl`, "anthropic/claude-b", 100, 100));
		const read: StatsRead = {
			window: { cutoff: 1_000, bucketMs: 1_000, now: 1_500 },
			dashboard: {
				overall: model("", "", 353),
				byModel: [model("openai", "gpt-a", 253), model("anthropic", "claude-b", 100)],
				byAgentType: [{ agentType: "main", totalInputTokens: 176.5, totalOutputTokens: 176.5, totalCacheReadTokens: 0, totalCacheWriteTokens: 0 }],
			},
			tools: { byTool: [{ tool: "read", calls: 7, errors: 1, totalTokensShare: 125 }] },
			sync: { phase: "idle", current: 23, total: 23, lastSyncedAt: 1_000, error: null },
			rows,
			providerSeries: [
				{ timestamp: 1_000, provider: "openai", totalTokens: 253, cost: 1.5, requests: 22 },
				{ timestamp: 1_000, provider: "anthropic", totalTokens: 100, cost: 0.5, requests: 1 },
			],
		};
		const analytics = buildAnalytics("7d", read, root, facts);
		expect(analytics.sessions.map(session => session.sessionId)).toEqual(["alpha", ...Array.from({ length: 19 }, (_, index) => String(21 - index))]);
		expect(analytics.workspaces.map(({ cwd, tokens }) => [cwd, tokens.total])).toEqual([["-work-other", 253], ["/work/app", 100]]);
		expect(analytics.models.map(({ selector, tokens }) => [selector, tokens.total])).toEqual([["openai/gpt-a", 253], ["anthropic/claude-b", 100]]);
		expect(analytics.tools).toEqual([{ name: "read", calls: 7, errors: 1, tokenShare: 125 }]);
		const providers = [
			{ provider: "openai", tokens: 253, cost: 1.5, requests: 22 },
			{ provider: "anthropic", tokens: 100, cost: 0.5, requests: 1 },
		];
		expect(analytics.providers).toEqual(providers);
		expect(analytics.series.map(({ providers: _, ...point }) => point)).toEqual([{ start: 1_000, tokens: 353, cost: 2, requests: 23 }]);
		expect(Object.fromEntries(analytics.series[0]!.providers.map(({ provider, ...usage }) => [provider, usage]))).toEqual({
			openai: { tokens: 253, cost: 1.5, requests: 22 },
			anthropic: { tokens: 100, cost: 0.5, requests: 1 },
		});
	});

	test("all time starts at the first request and fills gaps, but an empty history has no buckets", () => {
		const points = [
			{ timestamp: 2_000, provider: "openai", totalTokens: 5, cost: 1, requests: 2 },
			{ timestamp: 4_000, provider: "openai", totalTokens: 7, cost: 3, requests: 1 },
		];
		expect(chartOf(points, { cutoff: null, bucketMs: 1_000, now: 4_200 })).toEqual({
			providers: [{ provider: "openai", tokens: 12, cost: 4, requests: 3 }],
			series: [
				{ start: 2_000, tokens: 5, cost: 1, requests: 2, providers: [{ provider: "openai", tokens: 5, cost: 1, requests: 2 }] },
				{ start: 3_000, tokens: 0, cost: 0, requests: 0, providers: [] },
				{ start: 4_000, tokens: 7, cost: 3, requests: 1, providers: [{ provider: "openai", tokens: 7, cost: 3, requests: 1 }] },
			],
		});
		expect(chartOf([], { cutoff: null, bucketMs: 1_000, now: 4_200 })).toEqual({ providers: [], series: [] });
		expect(chartOf([], { cutoff: 1_500, bucketMs: 1_000, now: 3_200 })).toEqual({
			providers: [],
			series: [
				{ start: 1_000, tokens: 0, cost: 0, requests: 0, providers: [] },
				{ start: 2_000, tokens: 0, cost: 0, requests: 0, providers: [] },
				{ start: 3_000, tokens: 0, cost: 0, requests: 0, providers: [] },
			],
		});
	});

	test("an ancient request cannot extend the chart beyond the most recent 1500 buckets", () => {
		const result = chartOf([
			{ timestamp: 0, provider: "old", totalTokens: 10, cost: 1, requests: 1 },
			{ timestamp: 2_000_000, provider: "recent", totalTokens: 20, cost: 2, requests: 1 },
		], { cutoff: null, bucketMs: 1_000, now: 2_000_100 });
		expect(result.providers).toEqual([
			{ provider: "recent", tokens: 20, cost: 2, requests: 1 },
			{ provider: "old", tokens: 10, cost: 1, requests: 1 },
		]);
		expect(result.series).toHaveLength(1500);
		expect(result.series[0]).toEqual({ start: 501_000, tokens: 0, cost: 0, requests: 0, providers: [] });
		expect(result.series.at(-1)).toEqual({
			start: 2_000_000, tokens: 20, cost: 2, requests: 1,
			providers: [{ provider: "recent", tokens: 20, cost: 2, requests: 1 }],
		});
		expect(result.series.reduce((total, point) => total + point.tokens, 0)).toBe(20);
	});
});

describe("analytics provider buckets", () => {
	test("provider totals combine buckets, ties sort lexically, and zero-token requests retain cost", () => {
		const window = { cutoff: Date.parse("2026-10-06T08:20:00Z"), bucketMs: 3_600_000, now: Date.parse("2026-10-06T11:10:00Z") };
		const result = chartOf([
			{ timestamp: Date.parse("2026-10-06T08:00:00Z"), provider: "anthropic", totalTokens: 200, cost: 0.5, requests: 1 },
			{ timestamp: Date.parse("2026-10-06T08:00:00Z"), provider: "openai", totalTokens: 115, cost: 0.375, requests: 2 },
			{ timestamp: Date.parse("2026-10-06T10:00:00Z"), provider: "zero-token", totalTokens: 0, cost: 0.5, requests: 1 },
			{ timestamp: Date.parse("2026-10-06T10:00:00Z"), provider: "z-provider", totalTokens: 200, cost: 1, requests: 1 },
			{ timestamp: Date.parse("2026-10-06T10:00:00Z"), provider: "openai", totalTokens: 100, cost: 0.25, requests: 1 },
		], window);
		expect(result.providers).toEqual([
			{ provider: "openai", tokens: 215, cost: 0.625, requests: 3 },
			{ provider: "anthropic", tokens: 200, cost: 0.5, requests: 1 },
			{ provider: "z-provider", tokens: 200, cost: 1, requests: 1 },
			{ provider: "zero-token", tokens: 0, cost: 0.5, requests: 1 },
		]);
		expect(result.series.map(({ providers: _, ...point }) => point)).toEqual([
			{ start: Date.parse("2026-10-06T08:00:00Z"), tokens: 315, cost: 0.875, requests: 3 },
			{ start: Date.parse("2026-10-06T09:00:00Z"), tokens: 0, cost: 0, requests: 0 },
			{ start: Date.parse("2026-10-06T10:00:00Z"), tokens: 300, cost: 1.75, requests: 3 },
			{ start: Date.parse("2026-10-06T11:00:00Z"), tokens: 0, cost: 0, requests: 0 },
		]);
		expect(result.series.map(point => Object.fromEntries(point.providers.map(({ provider, ...usage }) => [provider, usage])))).toEqual([
			{
				openai: { tokens: 115, cost: 0.375, requests: 2 },
				anthropic: { tokens: 200, cost: 0.5, requests: 1 },
			},
			{},
			{
				openai: { tokens: 100, cost: 0.25, requests: 1 },
				"z-provider": { tokens: 200, cost: 1, requests: 1 },
				"zero-token": { tokens: 0, cost: 0.5, requests: 1 },
			},
			{},
		]);
	});

	test("daily buckets start at UTC midnight even when the cutoff and current time are inside a day", () => {
		const window = { cutoff: Date.parse("2026-10-06T10:30:00Z"), bucketMs: 86_400_000, now: Date.parse("2026-10-08T09:00:00Z") };
		expect(chartOf([
			{ timestamp: Date.parse("2026-10-06T00:00:00Z"), provider: "a", totalTokens: 10, cost: 1, requests: 1 },
			{ timestamp: Date.parse("2026-10-07T00:00:00Z"), provider: "b", totalTokens: 20, cost: 2, requests: 1 },
			{ timestamp: Date.parse("2026-10-08T00:00:00Z"), provider: "a", totalTokens: 30, cost: 3, requests: 1 },
		], window)).toEqual({
			providers: [
				{ provider: "a", tokens: 40, cost: 4, requests: 2 },
				{ provider: "b", tokens: 20, cost: 2, requests: 1 },
			],
			series: [
				{
					start: Date.parse("2026-10-06T00:00:00Z"), tokens: 10, cost: 1, requests: 1,
					providers: [{ provider: "a", tokens: 10, cost: 1, requests: 1 }],
				},
				{
					start: Date.parse("2026-10-07T00:00:00Z"), tokens: 20, cost: 2, requests: 1,
					providers: [{ provider: "b", tokens: 20, cost: 2, requests: 1 }],
				},
				{
					start: Date.parse("2026-10-08T00:00:00Z"), tokens: 30, cost: 3, requests: 1,
					providers: [{ provider: "a", tokens: 30, cost: 3, requests: 1 }],
				},
			],
		});
	});
});
