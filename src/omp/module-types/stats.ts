/** omp-stats' request usage, and omp's reading of a failed request (pi-ai src/error, pi-utils src/fetch-retry.ts). */
import type { Database } from "bun:sqlite";

/** Subset of omp-stats' `AggregatedStats` (src/shared-types.ts): one set of requests. */
export interface StatsUsage {
	totalRequests: number;
	failedRequests: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	cacheRate: number;
	totalCost: number;
	avgTokensPerSecond: number | null;
}
/** Subset of omp-stats' `DashboardStats`. `agentType` is `main`, `subagent`, or `advisor`. */
export interface StatsDashboard {
	overall: StatsUsage;
	byModel: (StatsUsage & { model: string; provider: string })[];
	byAgentType: { agentType: "main" | "subagent" | "advisor"; totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens: number; totalCacheWriteTokens: number }[];
}
/** Subset of omp-stats' `ToolDashboardStats`. */
export interface StatsToolDashboard {
	byTool: { tool: string; calls: number; errors: number; totalTokensShare: number }[];
}
/** omp-stats' aggregator (src/aggregator.ts). Ranges it does not know read as `24h`. */
export interface StatsAggregatorModule {
	/** `cutoff` is null for all time. */
	getTimeRangeConfig(range: string): { cutoff: number | null; bucketMs: number };
}
/** Subset of omp-stats' `ProviderTimeSeriesPoint` (src/shared-types.ts); `timestamp` starts a bucket. */
export interface StatsProviderPoint {
	timestamp: number;
	provider: string;
	totalTokens: number;
	cost: number;
	requests: number;
}
/** omp-stats' rollup-aware queries (src/rollup.ts), each over requests since `cutoff` (null for all time). */
export interface StatsRollupModule {
	getOverallStats(cutoff: number | null): StatsDashboard["overall"];
	getStatsByModel(cutoff: number | null): StatsDashboard["byModel"];
	getStatsByAgentType(cutoff: number | null): StatsDashboard["byAgentType"];
	getToolStats(cutoff: number | null): StatsToolDashboard["byTool"];
	getProviderTimeSeries(window: { cutoff: number | null; bucketMs: number }): StatsProviderPoint[];
}
/** omp-stats' `LiveSyncStatus` (src/shared-types.ts). */
export interface StatsSync {
	phase: "idle" | "syncing" | "error";
	current: number;
	total: number;
	lastSyncedAt: number | null;
	error: string | null;
}
/** omp-stats' live ingest (src/live.ts): `start` syncs every session file, then watches them; both are idempotent. */
export interface StatsLiveModule {
	statsLive(): { start(): void; stop(): void; status(): { sync: StatsSync } };
}
/** omp-stats' database (src/db.ts): `~/.omp/stats.db`, under omp's config root, opened once. */
export interface StatsDbModule {
	initDb(): Promise<Database>;
}
/** omp's request-error classifier (pi-ai src/error/rate-limit.ts): whether a 402's body names a billing cap, as its credential rotation decides. */
export interface RateLimitModule {
	is402BillingCapBody(message: string | undefined): boolean;
}
/** The fields of an assistant message that failed which omp's classifier reads (pi-ai src/types.ts `AssistantMessage`). */
export interface FailedMessage {
	api?: string;
	provider?: string;
	model?: string;
	errorId?: number;
	errorMessage?: string;
	errorClassificationMessage?: string;
	errorStatus?: number;
}
/** omp's error flags (pi-ai src/error/flags.ts): the kind of a failed request, as its retry and credential rotation decide. */
export interface ErrorFlagsModule {
	Flag: { UsageLimit: number; Transient: number };
	/** The message's flags, from its recorded `errorId` and its error text; it writes them back into `errorId`. */
	classifyMessage(message: FailedMessage): number;
	is(id: number | undefined, flag: number): boolean;
}
/** omp's retry hints (pi-utils src/fetch-retry.ts): the wait in milliseconds an error's text names, such as `retry-after-ms=…` or `resets in 2h`. */
export interface FetchRetryModule {
	extractRetryHint(source: null, body: string): number | undefined;
}
