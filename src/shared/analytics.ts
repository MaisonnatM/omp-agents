/** The Analytics tab's ranges and token usage. */

/** The time ranges the Analytics tab reads, shortest first; `all` has no start. */
export const ANALYTICS_RANGES = ["24h", "7d", "30d", "90d", "all"] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const isAnalyticsRange = (value: string): value is AnalyticsRange => (ANALYTICS_RANGES as readonly string[]).includes(value);

export interface TokenCounts {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	/** The four above, summed. */
	total: number;
}

/** What a set of model requests used. */
export interface Usage {
	requests: number;
	/** Requests that ended in an error. */
	failed: number;
	tokens: TokenCounts;
	/** omp's API list price in dollars, not what a subscription bills. */
	cost: number;
	/** Cache reads over all input read, cache reads included: 0 to 1. */
	cacheRate: number;
}

export interface AnalyticsProviderUsage {
	provider: string;
	tokens: number;
	cost: number;
	requests: number;
}

/** omp's request stats over one time range, from its stats database. */
export interface Analytics {
	range: AnalyticsRange;
	/** How far omp-stats has indexed the session files; numbers grow while it syncs. */
	sync: { phase: "idle" | "syncing" | "error"; current: number; total: number; lastSyncedAt: number | null; error: string | null };
	totals: Usage;
	/** Recorded request providers, most tokens first, then lexical provider order. */
	providers: AnalyticsProviderUsage[];
	/** Oldest first: an hour each over 24h, else a UTC day. Provider entries are sparse, with no order guarantee. */
	series: { start: number; tokens: number; cost: number; requests: number; providers: AnalyticsProviderUsage[] }[];
	/** Most tokens first. `selector` is `provider/model`; `tokensPerSecond` is the mean output rate, null when unmeasured. */
	models: (Usage & { selector: string; tokensPerSecond: number | null })[];
	/** By working directory, most tokens first. */
	projects: (Usage & { cwd: string })[];
	/** Total tokens by who sent the request. */
	agents: Record<"main" | "subagent" | "advisor", number>;
	/** Most calls first. `tokenShare` is the tokens of the requests that called the tool, split among their calls. */
	tools: { name: string; calls: number; errors: number; tokenShare: number }[];
	/** The 20 sessions that used the most tokens, most first, each with its subagents folded in. */
	sessions: AnalyticsSession[];
}

export interface AnalyticsSession {
	sessionId: string;
	/** Its title, else its first prompt as one line; `null` when it has neither or is not listed. */
	title: string | null;
	/** Whether its transcript is still on disk, so the dashboard can open it; omp-stats keeps deleted sessions' usage. */
	listed: boolean;
	cwd: string;
	usage: Usage;
	/** The part of `usage.tokens.total` its subagents used. */
	subagentTokens: number;
	/** `provider/model` selectors, most tokens first. */
	models: string[];
	/** The last request's time in ms. */
	lastAt: number;
}
