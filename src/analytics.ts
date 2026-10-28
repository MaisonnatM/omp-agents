import { basename, isAbsolute, relative, sep } from "node:path";
import type { FileUsage, ForeignRequest } from "./foreign/usage";
import type { StatsDashboard, StatsProviderPoint, StatsUsage } from "./omp/modules";
import type { SessionModelRow, StatsRead, StatsWindow } from "./omp/stats";
import type { Analytics, AnalyticsProviderUsage, AnalyticsRange, AnalyticsSession, TokenCounts, Usage } from "./shared/analytics";
import { selectorOf } from "./shared/models";

/** How many sessions the page lists. */
export const TOP_SESSIONS = 20;

/** What the dashboard knows of a session from its file for Analytics: its title and the workspace it counts in. */
export interface SessionSummary {
	title: string | null;
	workspace: string;
}

function tokenCounts(input: number, output: number, cacheRead: number, cacheWrite: number): TokenCounts {
	return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

/** omp-stats' cache rate: cache reads over all input read. */
const cacheRate = (input: number, cacheRead: number): number => (input + cacheRead > 0 ? cacheRead / (input + cacheRead) : 0);

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
	into.cacheRate = cacheRate(into.tokens.input, into.tokens.cacheRead);
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
export function foldSessions(rows: readonly SessionModelRow[], root: string, factsOf: (sessionId: string) => SessionSummary | null): AnalyticsSession[] {
	interface Fold {
		facts: SessionSummary | null;
		folder: string;
		usage: Usage;
		subagentTokens: number;
		lastAt: number;
		modelTokens: Map<string, number>;
	}
	const folds = new Map<string, Fold>();
	for (const row of rows) {
		const { sessionId, subagent } = row.session ?? sessionOfFile(row.sessionFile, root);
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
	// workspace, else the folder's own name.
	const workspaceOfFolder = new Map<string, string>();
	for (const { facts, folder } of folds.values()) if (facts) workspaceOfFolder.set(folder, facts.workspace);
	return [...folds]
		.map(([sessionId, { facts, folder, usage, subagentTokens, lastAt, modelTokens }]) => ({
			sessionId,
			title: facts?.title ?? null,
			listed: facts !== null,
			workspace: facts?.workspace ?? workspaceOfFolder.get(folder) ?? folder,
			usage,
			subagentTokens,
			models: [...modelTokens].sort((a, b) => b[1] - a[1]).map(([selector]) => selector),
			lastAt,
		}))
		.sort((a, b) => b.usage.tokens.total - a.usage.tokens.total || b.lastAt - a.lastAt);
}

/** Usage by workspace, most tokens first; a workspace that used no tokens is left out. */
export function workspacesOf(sessions: readonly AnalyticsSession[]): Analytics["workspaces"] {
	const workspaces = new Map<string, Usage & { cwd: string }>();
	for (const { workspace: cwd, usage } of sessions) {
		const workspace = workspaces.get(cwd) ?? { cwd, ...emptyUsage() };
		addUsage(workspace, usage.requests, usage.failed, usage.tokens, usage.cost);
		workspaces.set(cwd, workspace);
	}
	return [...workspaces.values()].filter(workspace => workspace.tokens.total > 0).sort((a, b) => b.tokens.total - a.tokens.total);
}

/** Most buckets the series carries, so a stray ancient timestamp cannot stretch all time into decades of empty days. */
const MAX_BUCKETS = 1500;

/**
 * Every bucket of the window, empty ones as zeros, aligned like omp-stats' `floor(timestamp / bucketMs) * bucketMs`.
 * All time starts at the earliest point.
 */
export function chartOf(points: readonly StatsProviderPoint[], { cutoff, bucketMs, now }: StatsWindow): Pick<Analytics, "providers" | "series"> {
	const byProvider = new Map<string, AnalyticsProviderUsage>();
	const byStart = new Map<number, AnalyticsProviderUsage[]>();
	let earliest = Infinity;
	for (const { timestamp: start, provider, totalTokens: tokens, cost, requests } of points) {
		const total = byProvider.get(provider) ?? { provider, tokens: 0, cost: 0, requests: 0 };
		total.tokens += tokens;
		total.cost += cost;
		total.requests += requests;
		byProvider.set(provider, total);
		const bucket = byStart.get(start) ?? [];
		bucket.push({ provider, tokens, cost, requests });
		byStart.set(start, bucket);
		earliest = Math.min(earliest, start);
	}
	const providers = [...byProvider.values()].sort((a, b) => b.tokens - a.tokens || (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
	const series: Analytics["series"] = [];
	if (cutoff === null && points.length === 0) return { providers, series };
	const last = Math.floor(now / bucketMs) * bucketMs;
	const from = cutoff ?? earliest;
	const first = Math.max(Math.floor(from / bucketMs) * bucketMs, last - (MAX_BUCKETS - 1) * bucketMs);
	for (let start = first; start <= last; start += bucketMs) {
		const bucket = byStart.get(start) ?? [];
		const point = { start, tokens: 0, cost: 0, requests: 0, providers: bucket };
		for (const provider of bucket) {
			point.tokens += provider.tokens;
			point.cost += provider.cost;
			point.requests += provider.requests;
		}
		series.push(point);
	}
	return { providers, series };
}

function addRequest(stats: StatsUsage, { input, output, cacheRead, cacheWrite, failed, cost }: ForeignRequest): void {
	stats.totalRequests += 1;
	stats.failedRequests += failed ? 1 : 0;
	stats.totalInputTokens += input;
	stats.totalOutputTokens += output;
	stats.totalCacheReadTokens += cacheRead;
	stats.totalCacheWriteTokens += cacheWrite;
	stats.totalCost += cost;
	stats.cacheRate = cacheRate(stats.totalInputTokens, stats.totalCacheReadTokens);
}

/**
 * `read` with the requests other agents' transcripts in `files` record since its cutoff, counted as omp-stats counts
 * omp's: a row per transcript and model, the provider series' buckets, and the dashboard's totals, models, and agents.
 */
export function withForeignUsage(read: StatsRead, files: Iterable<FileUsage>): StatsRead {
	const { cutoff, bucketMs } = read.window;
	const overall = { ...read.dashboard.overall };
	const byModel = new Map(read.dashboard.byModel.map(model => [`${model.provider}/${model.model}`, { ...model }]));
	const byAgentType = new Map(read.dashboard.byAgentType.map(agent => [agent.agentType, { ...agent }]));
	const points = new Map(read.providerSeries.map(point => [`${point.timestamp}/${point.provider}`, { ...point }]));
	const rows = [...read.rows];
	for (const { path, sessionId, subagent, cwd, requests } of files) {
		const fileRows = new Map<string, SessionModelRow>();
		for (const request of requests) {
			const { provider, model, timestamp, failed, input, output, cacheRead, cacheWrite, cost } = request;
			if (cutoff !== null && timestamp < cutoff) continue;
			const tokens = input + output + cacheRead + cacheWrite;
			const selector = selectorOf({ provider, id: model });
			const row = fileRows.get(selector) ?? {
				sessionFile: path, session: { sessionId, subagent }, folder: cwd, selector,
				requests: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, subagentTokens: 0, cost: 0, lastAt: 0,
			};
			row.requests += 1;
			row.failed += failed ? 1 : 0;
			row.input += input;
			row.output += output;
			row.cacheRead += cacheRead;
			row.cacheWrite += cacheWrite;
			row.subagentTokens += subagent ? tokens : 0;
			row.cost += cost;
			row.lastAt = Math.max(row.lastAt, timestamp);
			fileRows.set(selector, row);
			addRequest(overall, request);
			const byThisModel = byModel.get(selector) ?? {
				provider, model, totalRequests: 0, failedRequests: 0, totalInputTokens: 0, totalOutputTokens: 0,
				totalCacheReadTokens: 0, totalCacheWriteTokens: 0, cacheRate: 0, totalCost: 0, avgTokensPerSecond: null,
			};
			addRequest(byThisModel, request);
			byModel.set(selector, byThisModel);
			const agentType = subagent ? "subagent" : "main";
			const agent: StatsDashboard["byAgentType"][number] = byAgentType.get(agentType) ?? { agentType, totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0 };
			agent.totalInputTokens += input;
			agent.totalOutputTokens += output;
			agent.totalCacheReadTokens += cacheRead;
			agent.totalCacheWriteTokens += cacheWrite;
			byAgentType.set(agentType, agent);
			const start = Math.floor(timestamp / bucketMs) * bucketMs;
			const point = points.get(`${start}/${provider}`) ?? { timestamp: start, provider, totalTokens: 0, cost: 0, requests: 0 };
			point.totalTokens += tokens;
			point.cost += cost;
			point.requests += 1;
			points.set(`${start}/${provider}`, point);
		}
		rows.push(...fileRows.values());
	}
	return { ...read, dashboard: { overall, byModel: [...byModel.values()], byAgentType: [...byAgentType.values()] }, rows, providerSeries: [...points.values()] };
}

/** The page's payload from one omp-stats read over `range`. */
export function buildAnalytics(range: AnalyticsRange, read: StatsRead, root: string, factsOf: (sessionId: string) => SessionSummary | null): Analytics {
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
		...chartOf(read.providerSeries, read.window),
		models: dashboard.byModel
			.map(model => ({ selector: selectorOf({ provider: model.provider, id: model.model }), tokensPerSecond: model.avgTokensPerSecond, ...usageOf(model) }))
			.filter(model => model.tokens.total > 0)
			.sort((a, b) => b.tokens.total - a.tokens.total),
		workspaces: workspacesOf(sessions),
		agents,
		tools: tools.byTool.map(({ tool, calls, errors, totalTokensShare }) => ({ name: tool, calls, errors, tokenShare: totalTokensShare })),
		sessions: sessions.slice(0, TOP_SESSIONS),
	};
}

