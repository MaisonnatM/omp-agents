import { describe, expect, test } from "bun:test";
import { buildAnalytics, foldSessions, seriesOf, sessionOfFile } from "./analytics";
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
	test("a nested subagent folds into its parent, and a deleted session takes its project from a listed neighbor", () => {
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

	test("the payload sorts models and projects by tokens and keeps only the 20 heaviest sessions", () => {
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
				timeSeries: [{ timestamp: 1_000, tokens: 353, cost: 2, requests: 23 }],
			},
			tools: { byTool: [{ tool: "read", calls: 7, errors: 1, totalTokensShare: 125 }] },
			sync: { phase: "idle", current: 23, total: 23, lastSyncedAt: 1_000, error: null },
			rows,
		};
		const analytics = buildAnalytics("7d", read, root, facts);
		expect(analytics.sessions.map(session => session.sessionId)).toEqual(["alpha", ...Array.from({ length: 19 }, (_, index) => String(21 - index))]);
		expect(analytics.projects.map(({ cwd, tokens }) => [cwd, tokens.total])).toEqual([["-work-other", 253], ["/work/app", 100]]);
		expect(analytics.models.map(({ selector, tokens }) => [selector, tokens.total])).toEqual([["openai/gpt-a", 253], ["anthropic/claude-b", 100]]);
		expect(analytics.tools).toEqual([{ name: "read", calls: 7, errors: 1, tokenShare: 125 }]);
		expect(analytics.series).toEqual([{ start: 1_000, tokens: 353, cost: 2, requests: 23 }]);
	});

	test("the series has a bucket for every step of the window, and all time starts at the earliest point", () => {
		const points = [{ timestamp: 2_000, tokens: 5, cost: 1, requests: 2 }, { timestamp: 4_000, tokens: 7, cost: 3, requests: 1 }];
		const empty = (start: number) => ({ start, tokens: 0, cost: 0, requests: 0 });
		expect(seriesOf(points, { cutoff: 1_500, bucketMs: 1_000, now: 5_200 })).toEqual([
			empty(1_000), { start: 2_000, tokens: 5, cost: 1, requests: 2 }, empty(3_000), { start: 4_000, tokens: 7, cost: 3, requests: 1 }, empty(5_000),
		]);
		expect(seriesOf(points, { cutoff: null, bucketMs: 1_000, now: 4_200 }).map(point => point.start)).toEqual([2_000, 3_000, 4_000]);
		expect(seriesOf([], { cutoff: null, bucketMs: 1_000, now: 4_200 })).toEqual([]);
	});
});
