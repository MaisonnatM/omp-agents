/**
 * omp's request stats, from the database omp-stats keeps in `~/.omp/stats.db`. The first read starts omp-stats' live
 * ingest, which syncs every session file and then watches them, so a server whose Analytics page never opens never
 * touches the database.
 */
import type { AnalyticsRange } from "../shared";
import { type StatsDashboard, type StatsSync, type StatsToolDashboard, statsAggregator, statsDb, statsLive } from "./modules";

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

let started = false;

/** omp-stats' dashboard and tool stats over `range`, its sync state, and each session file's usage by model. */
export async function readStats(range: AnalyticsRange): Promise<StatsRead> {
	const db = await statsDb.initDb();
	const live = statsLive.statsLive();
	if (!started) {
		started = true;
		live.start();
	}
	const now = Date.now();
	const { cutoff, bucketMs } = statsAggregator.getTimeRangeConfig(range);
	const [dashboard, tools] = await Promise.all([statsAggregator.getDashboardStats(range), statsAggregator.getToolDashboardStats(range)]);
	const rows = db.query<SessionModelRow, [number]>(SESSION_MODEL_ROWS).all(cutoff ?? 0);
	return { window: { cutoff, bucketMs, now }, dashboard, tools, sync: live.status().sync, rows };
}

/** Stops the live ingest, if a read started it. */
export function stopStats(): void {
	if (started) statsLive.statsLive().stop();
}
