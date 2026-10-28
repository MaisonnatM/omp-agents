/** The Analytics tab's ranges and token usage. */
import { arrayOf, decoder, fields, isBoolean, isNumber, isString, isTexts, nullable, oneOf, type Shape } from "../json";

/** The time ranges the Analytics tab reads, shortest first; `today` starts at local midnight and `all` has no start. */
export const ANALYTICS_RANGES = ["today", "24h", "7d", "30d", "90d", "all"] as const;

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

/** Request usage over one time range, from omp-stats and Claude Code's and Codex's transcripts. */
export interface Analytics {
	range: AnalyticsRange;
	/** How far omp-stats has indexed the session files; numbers grow while it syncs. */
	sync: { phase: "idle" | "syncing" | "error"; current: number; total: number; lastSyncedAt: number | null; error: string | null };
	totals: Usage;
	/** Recorded request providers, most tokens first, then lexical provider order. */
	providers: AnalyticsProviderUsage[];
	/** Oldest first: an hour each over today or 24h, else a UTC day. Provider entries are sparse, with no order guarantee. */
	series: { start: number; tokens: number; cost: number; requests: number; providers: AnalyticsProviderUsage[] }[];
	/** Models that used tokens, most first. `selector` is `provider/model`; `tokensPerSecond` is the mean output rate, null when unmeasured. */
	models: (Usage & { selector: string; tokensPerSecond: number | null })[];
	/** By working directory, those that used tokens, most first. */
	workspaces: (Usage & { cwd: string })[];
	/** Total tokens by who sent the request. */
	agents: Record<"main" | "subagent" | "advisor", number>;
	/** omp-only tool calls, most calls first. `tokenShare` is the tokens of the requests that called the tool, split among their calls. */
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
	/** The directory of the workspace it counts in. */
	workspace: string;
	usage: Usage;
	/** The part of `usage.tokens.total` its subagents used. */
	subagentTokens: number;
	/** `provider/model` selectors, most tokens first. */
	models: string[];
	/** The last request's time in ms. */
	lastAt: number;
}

const USAGE: Shape<Usage> = {
	requests: isNumber,
	failed: isNumber,
	tokens: fields<TokenCounts>({ input: isNumber, output: isNumber, cacheRead: isNumber, cacheWrite: isNumber, total: isNumber }),
	cost: isNumber,
	cacheRate: isNumber,
};
const isUsage = fields(USAGE);

const isProviderUsage = fields<AnalyticsProviderUsage>({ provider: isString, tokens: isNumber, cost: isNumber, requests: isNumber });

/** A kept {@link Analytics} with every part whole, or `null`: a read an older version kept, such as a chart without provider buckets, reads omp-stats again. */
export const decodeAnalytics = decoder(
	fields<Analytics>({
		range: oneOf(ANALYTICS_RANGES),
		sync: fields<Analytics["sync"]>({
			phase: oneOf(["idle", "syncing", "error"]),
			current: isNumber,
			total: isNumber,
			lastSyncedAt: nullable(isNumber),
			error: nullable(isString),
		}),
		totals: isUsage,
		providers: arrayOf(isProviderUsage),
		series: arrayOf(fields<Analytics["series"][number]>({ start: isNumber, tokens: isNumber, cost: isNumber, requests: isNumber, providers: arrayOf(isProviderUsage) })),
		models: arrayOf(fields<Analytics["models"][number]>({ ...USAGE, selector: isString, tokensPerSecond: nullable(isNumber) })),
		workspaces: arrayOf(fields<Analytics["workspaces"][number]>({ ...USAGE, cwd: isString })),
		agents: fields<Analytics["agents"]>({ main: isNumber, subagent: isNumber, advisor: isNumber }),
		tools: arrayOf(fields<Analytics["tools"][number]>({ name: isString, calls: isNumber, errors: isNumber, tokenShare: isNumber })),
		sessions: arrayOf(
			fields<AnalyticsSession>({
				sessionId: isString,
				title: nullable(isString),
				listed: isBoolean,
				workspace: isString,
				usage: isUsage,
				subagentTokens: isNumber,
				models: isTexts,
				lastAt: isNumber,
			}),
		),
	}),
);

/**
 * What a context source is: an instruction file, a skill (its line in the skill list and its body once invoked), an MCP server
 * (its tool routes, devices, and instructions), a rule, a system prompt section, an injected message, a tool's results, the
 * conversation itself, a side request outside the conversation, or the part of a request no transcript records.
 */
export const CONTEXT_SOURCE_KINDS = ["file", "skill", "mcp", "rule", "prompt", "injection", "tool", "conversation", "side", "unrecorded"] as const;

export type ContextSourceKind = (typeof CONTEXT_SOURCE_KINDS)[number];

/** One source's share of the input over the report's requests. */
export interface ContextSource {
	kind: ContextSourceKind;
	name: string;
	/** The requests whose input held it. */
	turns: number;
	/** Its input tokens over those requests, cached or not. */
	tokens: number;
	/** Its part of those requests' input cost: each request's input, cache read, and cache write cost split by token share. */
	cost: number;
}

/** The context sources over one range, optionally one workspace's or one session's, from the dashboard's index of the session files. */
export interface ContextReport {
	range: AnalyticsRange;
	cwd: string | null;
	sessionId: string | null;
	/** How far the index has read the session files, `null` once it caught up; numbers grow while it reads. */
	indexing: { current: number; total: number } | null;
	/** The requests counted, their input tokens with cache reads and writes, and its cost; `sources` add up to `input`. */
	turns: number;
	input: number;
	cost: number;
	/** Most tokens first. */
	sources: ContextSource[];
	/** Every workspace over the range, most input first, for the workspace filter. */
	workspaces: { cwd: string; input: number }[];
	/** The 20 sessions with the most input in the chosen workspace, else over the range, for the session filter. */
	sessions: { sessionId: string; title: string | null; input: number }[];
}
