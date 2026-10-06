/** The Analytics page's numbers: omp-stats' reads, with each session's subagents folded into it. */
import { basename, isAbsolute, relative, sep } from "node:path";
import type { StatsDashboard, StatsUsage } from "./omp/modules";
import type { SessionModelRow, StatsRead, StatsWindow } from "./omp/stats";
import type { Analytics, AnalyticsRange, AnalyticsSession, TokenCounts, Usage } from "./shared/analytics";

/** How many sessions the page lists. */
export const TOP_SESSIONS = 20;

/** What the dashboard knows of a session from its file. */
export interface SessionFacts {
	title: string | null;
	cwd: string;
}

function tokenCounts(input: number, output: number, cacheRead: number, cacheWrite: number): TokenCounts {
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** omp-stats' cache rate: cache reads over all input read. */
const cacheRate = ({ input, cacheRead }: TokenCounts): number => (input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0);

function usageOf(stats: StatsUsage): Usage {
	return {
		requests: stats.totalRequests,
		failed: stats.failedRequests,
		tokens: tokenCounts(stats.totalInputTokens, stats.totalOutputTokens, stats.totalCacheReadTokens, stats.totalCacheWriteTokens),
		cost: stats.totalCost,
		cacheRate: stats.cacheRate,
	};
}

function addUsage(into: Usage, requests: number, failed: number, tokens: TokenCounts, cost: number): void {
	into.requests += requests;
	into.failed += failed;
	into.tokens = tokenCounts(into.tokens.input + tokens.input, into.tokens.output + tokens.output, into.tokens.cacheRead + tokens.cacheRead, into.tokens.cacheWrite + tokens.cacheWrite);
	into.cost += cost;
	into.cacheRate = cacheRate(into.tokens);
}

const emptyUsage = (): Usage => ({ requests: 0, failed: 0, tokens: tokenCounts(0, 0, 0, 0), cost: 0, cacheRate: 0 });

/**
 * The session a transcript belongs to. Under `sessionsDir`, `<project>/<time>_<id>.jsonl` is the session itself and
 * any file under `<project>/<time>_<id>/` one of its subagents; a file elsewhere stands for itself.
 */
export function sessionOfFile(file: string, root: string): { sessionId: string; subagent: boolean } {
	const path = relative(root, file);
	const parts = path.split(sep);
	const inside = parts.length >= 2 && parts[0] !== ".." && !isAbsolute(path);
	const owner = inside ? parts[1] : basename(file);
	const name = owner.endsWith(".jsonl") ? owner.slice(0, -".jsonl".length) : owner;
	return { sessionId: name.slice(name.indexOf("_") + 1), subagent: inside && parts.length > 2 };
}

/** The sessions in `rows`, subagents folded in, every one of them, most tokens first. */
export function foldSessions(rows: readonly SessionModelRow[], root: string, factsOf: (sessionId: string) => SessionFacts | null): AnalyticsSession[] {
	interface Fold {
		facts: SessionFacts | null;
		folder: string;
		usage: Usage;
		subagentTokens: number;
		lastAt: number;
		modelTokens: Map<string, number>;
	}
	const folds = new Map<string, Fold>();
	for (const row of rows) {
		const { sessionId, subagent } = sessionOfFile(row.sessionFile, root);
		let fold = folds.get(sessionId);
		if (!fold) {
			fold = { facts: factsOf(sessionId), folder: row.folder, usage: emptyUsage(), subagentTokens: 0, lastAt: 0, modelTokens: new Map() };
			folds.set(sessionId, fold);
		}
		const tokens = tokenCounts(row.input, row.output, row.cacheRead, row.cacheWrite);
		addUsage(fold.usage, row.requests, row.failed, tokens, row.cost);
		if (subagent) fold.subagentTokens += row.subagentTokens;
		fold.lastAt = Math.max(fold.lastAt, row.lastAt);
		fold.modelTokens.set(row.selector, (fold.modelTokens.get(row.selector) ?? 0) + tokens.total);
	}
	// omp keeps one folder per working directory, so a session the dashboard does not list takes a listed neighbor's
	// directory, else the folder's own name.
	const cwdOfFolder = new Map<string, string>();
	for (const { facts, folder } of folds.values()) if (facts) cwdOfFolder.set(folder, facts.cwd);
	return [...folds]
		.map(([sessionId, { facts, folder, usage, subagentTokens, lastAt, modelTokens }]) => ({
			sessionId,
			title: facts?.title ?? null,
			listed: facts !== null,
			cwd: facts?.cwd ?? cwdOfFolder.get(folder) ?? folder,
			usage,
			subagentTokens,
			models: [...modelTokens].sort((a, b) => b[1] - a[1]).map(([selector]) => selector),
			lastAt,
		}))
		.sort((a, b) => b.usage.tokens.total - a.usage.tokens.total || b.lastAt - a.lastAt);
}

/** Usage by working directory, most tokens first. */
export function projectsOf(sessions: readonly AnalyticsSession[]): Analytics["projects"] {
	const projects = new Map<string, Usage & { cwd: string }>();
	for (const { cwd, usage } of sessions) {
		const project = projects.get(cwd) ?? { cwd, ...emptyUsage() };
		addUsage(project, usage.requests, usage.failed, usage.tokens, usage.cost);
		projects.set(cwd, project);
	}
	return [...projects.values()].sort((a, b) => b.tokens.total - a.tokens.total);
}

/** Most buckets the series carries, so a stray ancient timestamp cannot stretch all time into decades of empty days. */
const MAX_BUCKETS = 1500;

/**
 * Every bucket of the window, empty ones as zeros, aligned like omp-stats' `floor(timestamp / bucketMs) * bucketMs`.
 * All time starts at the earliest point.
 */
export function seriesOf(points: StatsDashboard["timeSeries"], { cutoff, bucketMs, now }: StatsWindow): Analytics["series"] {
	if (cutoff === null && points.length === 0) return [];
	const byStart = new Map(points.map(point => [point.timestamp, point]));
	const last = Math.floor(now / bucketMs) * bucketMs;
	const from = cutoff ?? Math.min(...points.map(point => point.timestamp));
	const first = Math.max(Math.floor(from / bucketMs) * bucketMs, last - (MAX_BUCKETS - 1) * bucketMs);
	const series: Analytics["series"] = [];
	for (let start = first; start <= last; start += bucketMs) {
		const point = byStart.get(start);
		series.push({ start, tokens: point?.tokens ?? 0, cost: point?.cost ?? 0, requests: point?.requests ?? 0 });
	}
	return series;
}

/** The page's payload from one omp-stats read over `range`. */
export function buildAnalytics(range: AnalyticsRange, read: StatsRead, root: string, factsOf: (sessionId: string) => SessionFacts | null): Analytics {
	const { dashboard, tools, sync } = read;
	const sessions = foldSessions(read.rows, root, factsOf);
	const agents: Analytics["agents"] = { main: 0, subagent: 0, advisor: 0 };
	for (const agent of dashboard.byAgentType) {
		agents[agent.agentType] += agent.totalInputTokens + agent.totalOutputTokens + agent.totalCacheReadTokens + agent.totalCacheWriteTokens;
	}
	return {
		range,
		sync: { phase: sync.phase, current: sync.current, total: sync.total, lastSyncedAt: sync.lastSyncedAt, error: sync.error },
		totals: usageOf(dashboard.overall),
		series: seriesOf(dashboard.timeSeries, read.window),
		models: dashboard.byModel
			.map(model => ({ selector: `${model.provider}/${model.model}`, tokensPerSecond: model.avgTokensPerSecond, ...usageOf(model) }))
			.sort((a, b) => b.tokens.total - a.tokens.total),
		projects: projectsOf(sessions),
		agents,
		tools: tools.byTool.map(({ tool, calls, errors, totalTokensShare }) => ({ name: tool, calls, errors, tokenShare: totalTokensShare })),
		sessions: sessions.slice(0, TOP_SESSIONS),
	};
}

