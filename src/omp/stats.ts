/**
 * omp's request stats, from the database omp-stats keeps in `~/.omp/stats.db`. The first read starts omp-stats' live
 * ingest, which syncs every session file and then watches them.
 */
import type { Database } from "bun:sqlite";
import type { Pricer } from "../foreign/usage";
import type { AnalyticsRange } from "../shared/analytics";
import type { CreditsSubject } from "../shared/notices";
import { artifactsDir } from "../subagents";
import type { StatsDashboard, StatsProviderPoint, StatsSync, StatsToolDashboard } from "./module-types/stats";
import { catalog, rateLimit, statsAggregator, statsDb, statsLive, statsRollup } from "./modules";

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
	/** The session the row counts toward when its file's path does not say, as for another agent's transcript. */
	session?: { sessionId: string; subagent: boolean };
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

const SESSION_MODEL_COLUMNS = `
	SELECT session_file AS sessionFile, MAX(folder) AS folder, provider || '/' || model AS selector,
		COUNT(*) AS requests, SUM(stop_reason = 'error') AS failed,
		SUM(input_tokens) AS input, SUM(output_tokens) AS output,
		SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,
		SUM(CASE WHEN agent_type = 'subagent' THEN total_tokens ELSE 0 END) AS subagentTokens,
		TOTAL(cost_total) AS cost, MAX(timestamp) AS lastAt
	FROM messages`;

const SESSION_MODEL_ROWS = `${SESSION_MODEL_COLUMNS} WHERE timestamp >= ? GROUP BY session_file, provider, model`;

// `'0'` is the character after `/`, so the range holds every file under the session's subagent directory.
const ONE_SESSION_MODEL_ROWS = `${SESSION_MODEL_COLUMNS}
	WHERE session_file = ?1 OR (session_file > ?2 AND session_file < ?3)
	GROUP BY session_file, provider, model`;

const CREDITS_WINDOW_MS = 24 * 60 * 60_000;

const ERROR_CHARS = 300;

// Each provider's failures since its last request that worked in the range, an aborted request counting as neither;
// omp's billing-cap test is a set of regexes SQL cannot run, so `creditRuns` picks the billing caps out of these.
const FAILURES_SINCE_LAST_SUCCESS = `
	WITH worked AS (
		SELECT provider, max(timestamp) AS at FROM messages
		WHERE timestamp >= ?1 AND stop_reason NOT IN ('error', 'aborted')
		GROUP BY provider)
	SELECT provider, model, timestamp, error_message AS error FROM messages LEFT JOIN worked USING (provider)
	WHERE stop_reason = 'error' AND error_message IS NOT NULL AND timestamp >= ?1 AND timestamp > coalesce(worked.at, 0)
	ORDER BY timestamp`;

interface Failure {
	provider: string;
	model: string;
	timestamp: number;
	error: string;
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

/** What one session file and its subagents' files used by model in `db`, over all time. */
export function sessionRows(db: Database, file: string): SessionModelRow[] {
	const subagents = artifactsDir(file);
	return db.query<SessionModelRow, [string, string, string]>(ONE_SESSION_MODEL_ROWS).all(file, `${subagents}/`, `${subagents}0`);
}

export async function readSessionRows(file: string): Promise<SessionModelRow[]> {
	return sessionRows(await openLiveStats(), file);
}

/** omp's list price from its bundled model catalog, as omp prices its own requests; 0 for a model the catalog does not list. */
export const listPrice: Pricer = (provider, model, { input, output, cacheRead, cacheWrite, cttl }, timestamp) => {
	const known = catalog.getBundledModel(provider, model);
	if (!known) return 0;
	const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
	return catalog.calculateCost(known, { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cttl, cost }, timestamp).total;
};

// Anthropic refuses a spent API key with a 400 (or an in-stream error) that says so, which stock omp misses;
// patches/omp-18.18.1-credit-balance-fallback.patch adds the phrase to omp, so this goes once omp ships it.
const CREDIT_BALANCE_TOO_LOW = /\bcredit balance is too low\b/i;

// A billing cap is one waiting never clears, so Cursor's plan window, whose usage limits reset with the monthly cycle,
// is out even though omp's spend-limit test matches its "set a Spend Limit to continue"; the plan notice covers it.
const PLAN_WINDOW_RESETS = /\busage limits? will reset\b/i;

// The stats database keeps only the error text, so a 402 there stands for the response status.
function isBillingCap(error: string): boolean {
	if (CREDIT_BALANCE_TOO_LOW.test(error)) return true;
	if (PLAN_WINDOW_RESETS.test(error)) return false;
	return rateLimit.isBillingCapUsageLimit(/\b402\b/.test(error) ? 402 : undefined, error);
}

/**
 * The runs of credit failures in `db` over the day before `now`: a request that worked ends its provider's run, and
 * any failure other than a billing cap omp names or Anthropic's spent-balance refusal neither starts, ends, nor counts
 * toward one.
 */
export function creditRuns(db: Database, now: number): CreditRun[] {
	const runs = new Map<string, CreditRun>();
	for (const { provider, model, timestamp, error } of db.query<Failure, [number]>(FAILURES_SINCE_LAST_SUCCESS).all(now - CREDITS_WINDOW_MS)) {
		if (!isBillingCap(error)) continue;
		const run = runs.get(provider);
		const text = error.slice(0, ERROR_CHARS);
		runs.set(provider, run ? { ...run, model, failures: run.failures + 1, error: text } : { provider, model, failures: 1, since: timestamp, error: text });
	}
	return [...runs.values()];
}

export async function readCreditRuns(now: number): Promise<CreditRun[]> {
	return creditRuns(await openLiveStats(), now);
}

/** Stops the live ingest, if a read started it. */
export function stopStats(): void {
	if (started) statsLive.statsLive().stop();
}
