/**
 * omp's request stats, from the database omp-stats keeps in `~/.omp/stats.db`. The first read starts omp-stats' live
 * ingest, which syncs every session file and then watches them.
 */
import type { Database } from "bun:sqlite";
import type { AnalyticsRange } from "../shared/analytics";
import type { CreditsSubject } from "../shared/notices";
import type { StatsDashboard, StatsProviderPoint, StatsSync, StatsToolDashboard } from "./modules";
import { rateLimit, statsAggregator, statsDb, statsLive, statsRollup } from "./modules";

/** What one model used in one session file over the range. */
export interface SessionModelRow {
	sessionFile: string;
	/** The working directory omp recorded for the file. */
	folder: string;
	selector: string;
	requests: number;
	failed: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** Tokens from requests by task subagents, not passive advisors. */
	subagentTokens: number;
	cost: number;
	lastAt: number;
}

/** omp-stats' series window: buckets of `bucketMs` from `cutoff` (null for all time) to `now`. */
export interface StatsWindow {
	cutoff: number | null;
	bucketMs: number;
	now: number;
}

export interface StatsRead {
	window: StatsWindow;
	dashboard: StatsDashboard;
	tools: StatsToolDashboard;
	sync: StatsSync;
	rows: SessionModelRow[];
	providerSeries: StatsProviderPoint[];
}

const SESSION_MODEL_ROWS = `
	SELECT session_file AS sessionFile, MAX(folder) AS folder, provider || '/' || model AS selector,
		COUNT(*) AS requests, SUM(stop_reason = 'error') AS failed,
		SUM(input_tokens) AS input, SUM(output_tokens) AS output,
		SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,
		SUM(CASE WHEN agent_type = 'subagent' THEN total_tokens ELSE 0 END) AS subagentTokens,
		TOTAL(cost_total) AS cost, MAX(timestamp) AS lastAt
	FROM messages WHERE timestamp >= ?
	GROUP BY session_file, provider, model`;

const CREDITS_WINDOW_MS = 24 * 60 * 60_000;

const ERROR_CHARS = 300;

const SETTLED_PROVIDER_REQUESTS = `
	SELECT provider, model, timestamp, stop_reason = 'error' AS failed, error_message AS error FROM messages
	WHERE timestamp >= ?1 AND stop_reason != 'aborted' AND provider IN (
		SELECT provider FROM messages WHERE stop_reason = 'error' AND timestamp >= ?1 AND error_message LIKE '%402%')
	ORDER BY timestamp`;

export interface ProviderRequest {
	provider: string;
	model: string;
	timestamp: number;
	failed: number;
	error: string | null;
}

export type CreditRun = Omit<CreditsSubject, "kind">;

let started = false;

async function openLiveStats(): Promise<Database> {
	const db = await statsDb.initDb();
	if (!started) {
		started = true;
		statsLive.statsLive().start();
	}
	return db;
}

const HOUR_MS = 60 * 60_000;

/** The range's cutoff and series bucket; `today` starts at local midnight with hourly buckets. */
export function windowOf(range: AnalyticsRange, now: number): { cutoff: number | null; bucketMs: number } {
	if (range !== "today") return statsAggregator.getTimeRangeConfig(range);
	const midnight = new Date(now);
	midnight.setHours(0, 0, 0, 0);
	return { cutoff: midnight.getTime(), bucketMs: HOUR_MS };
}

/** omp-stats' dashboard and tool stats over `range`, its sync state, and each session file's usage by model. */
export async function readStats(range: AnalyticsRange): Promise<StatsRead> {
	const db = await openLiveStats();
	const now = Date.now();
	const { cutoff, bucketMs } = windowOf(range, now);
	const dashboard = { overall: statsRollup.getOverallStats(cutoff), byModel: statsRollup.getStatsByModel(cutoff), byAgentType: statsRollup.getStatsByAgentType(cutoff) };
	const tools = { byTool: statsRollup.getToolStats(cutoff) };
	const rows = db.query<SessionModelRow, [number]>(SESSION_MODEL_ROWS).all(cutoff ?? 0);
	const window = { cutoff, bucketMs, now };
	return { window, dashboard, tools, sync: statsLive.statsLive().status().sync, rows, providerSeries: statsRollup.getProviderTimeSeries(window) };
}

const isBillingCap = (error: string | null): boolean => error !== null && /\b402\b/.test(error) && rateLimit.is402BillingCapBody(error);

/**
 * The credit runs in `requests`, which must be in time order: a request that worked ends its provider's run, and any
 * failure other than a billing 402 neither starts, ends, nor counts toward one.
 */
export function creditRuns(requests: ProviderRequest[]): CreditRun[] {
	const runs = new Map<string, CreditRun | null>();
	for (const { provider, model, timestamp, failed, error } of requests) {
		if (!failed) {
			runs.set(provider, null);
			continue;
		}
		if (!isBillingCap(error)) continue;
		const run = runs.get(provider);
		const text = (error ?? "").slice(0, ERROR_CHARS);
		runs.set(provider, run ? { ...run, model, failures: run.failures + 1, error: text } : { provider, model, failures: 1, since: timestamp, error: text });
	}
	return [...runs.values()].filter(run => run !== null);
}

/** The runs of credit failures over the day before `now`. */
export async function readCreditRuns(now: number): Promise<CreditRun[]> {
	const db = await openLiveStats();
	return creditRuns(db.query<ProviderRequest, [number]>(SETTLED_PROVIDER_REQUESTS).all(now - CREDITS_WINDOW_MS));
}

/** Stops the live ingest, if a read started it. */
export function stopStats(): void {
	if (started) statsLive.statsLive().stop();
}
