import { describe, expect, test } from "bun:test";
import { type TurnFailure, turnFailureOf } from "./turn-failure";

/** Assistant messages that ended turns in real omp session files, as omp recorded them. */
const recorded = {
	minimaxTokenPlan: {
		api: "openai-completions",
		provider: "minimax-code",
		model: "MiniMax-M3",
		errorStatus: 429,
		errorId: 659456,
		errorMessage:
			"429 Token Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056)\nToken Plan usage limit reached: Upgrade your Token Plan or purchase Credits for more usage. (2056) (type=rate_limit_error)",
	},
	minimaxRateLimit: {
		api: "anthropic-messages",
		provider: "minimax-code",
		model: "MiniMax-M3",
		errorStatus: 429,
		errorId: 659456,
		errorMessage:
			'429 {"type":"error","error":{"type":"rate_limit_error","message":"Token Plan rate limit reached: Upgrade your Token Plan or switch to pay-as-you-go API usage. (2062)"},"request_id":"071c8549767daae7bbf618647cc562a6"}',
	},
	anthropic: {
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-5-5",
		errorStatus: 429,
		errorId: 659456,
		errorMessage:
			'429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CfdhtkRmUauMWRcVE3ggY"} retry-after-ms=5215000',
	},
	opencodeGo: {
		api: "openai-completions",
		provider: "opencode-go",
		model: "deepseek-v4.1-flash",
		errorStatus: 429,
		errorId: 659456,
		errorMessage: "429 Go usage limit exceeded retry-after-ms=200813000\nGo usage limit exceeded (type=GoUsageLimitError)",
	},
	cursorOutOfUsage: {
		api: "cursor-agent",
		provider: "cursor",
		model: "grok-4.7",
		errorStatus: 429,
		errorId: 659456,
		errorMessage: "Cursor RATE_LIMITED: Increase limits for faster responses: You're out of usage. Switch to Auto, or ask your admin to increase your limit to continue.",
	},
	cursorResourceExhausted: {
		api: "cursor-agent",
		provider: "cursor",
		model: "gpt-5.6-sol",
		errorId: 528384,
		errorMessage:
			'Connect error resource_exhausted: Error [details: aiserver.v1.ErrorDetails: {"error":"ERROR_RATE_LIMITED_CHANGEABLE","details":{"title":"You\'ve hit your usage limit","detail":"You\'ve saved $1256 on API model usage this month with Pro+. Switch to a different model or set a Spend Limit to continue with this model."}}]',
		errorClassificationMessage: "Connect error resource_exhausted: Error",
	},
	vercelBudget: {
		api: "anthropic-messages",
		provider: "vercel-ai-gateway",
		model: "openai/gpt-6-luna",
		errorStatus: 402,
		errorId: 528384,
		errorMessage:
			'402 {"error":{"message":"Team budget exceeded. Current spend: $40.04, limit: $40.00. Team owners can edit this budget in AI Gateway Budgets & Spend (https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fbudgets&title=AI+Gateway+Budgets+%26+Spend).","type":"quota_for_entity_exceeded"}}',
	},
	openrouterMaxTokens: {
		api: "openrouter",
		provider: "openrouter",
		model: "openai/gpt-6-luna",
		errorStatus: 402,
		errorId: 402,
		errorMessage:
			"402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 59774. To increase, visit https://openrouter.ai/settings/credits and add more credits",
	},
	streamTimeout: { api: "openai-completions", provider: "minimax-code", model: "MiniMax-M3", errorId: 397312, errorMessage: "OpenAI completions stream timed out while waiting for the first event" },
	anthropicNotFound: {
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-opus-5-5",
		errorId: 135168,
		errorMessage: "Couldn't reach api.anthropic.com (getaddrinfo ENOTFOUND). Check the URL, your network, or proxy.",
	},
	codexRetryBudget: {
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-6.1-sol",
		errorId: 135168,
		errorMessage: "Retry budget exhausted after 10 retries: Couldn't reach chatgpt.com (getaddrinfo ENOTFOUND). Check the URL, your network, or proxy.",
	},
	codexStalled: { api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6.1-sol", errorId: 397312, errorMessage: "OpenAI Codex SSE stream stalled while waiting for the next event" },
	socketClosed: { api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", errorId: 135168, errorMessage: "The socket connection was closed unexpectedly before the response completed" },
	connectionError: { api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", errorId: 135168, errorMessage: "Connection error." },
	usagePreflight: {
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-6.1-sol",
		errorId: 0,
		errorMessage: "Usage preflight blocked: All eligible configured included-plan routes are depleted or unavailable, and no usable paid fallback is available.",
	},
};

const failed = (fields: object) => ({ role: "assistant", content: [], stopReason: "error", ...fields });
const endedOn = (...messages: object[]) => turnFailureOf([{ role: "user", content: "go on" }, ...messages]);
const limit = (provider: string, retryAfterMs: number | null): TurnFailure => ({ kind: "usage-limit", provider, retryAfterMs });

describe("turnFailureOf", () => {
	test("a provider's usage limit, plan cap, or spend budget ends the turn on a limit, with the wait its error names", () => {
		expect(
			[recorded.minimaxTokenPlan, recorded.minimaxRateLimit, recorded.anthropic, recorded.opencodeGo, recorded.cursorOutOfUsage, recorded.cursorResourceExhausted, recorded.vercelBudget].map(
				message => endedOn(failed(message)),
			),
		).toEqual([
			limit("minimax-code", null),
			limit("minimax-code", null),
			limit("anthropic", 5_215_000),
			limit("opencode-go", 200_813_000),
			limit("cursor", null),
			limit("cursor", null),
			limit("vercel-ai-gateway", null),
		]);
	});

	test("a lookup that failed, a stream that stalled or timed out, or a dropped connection ends the turn on a transient fault", () => {
		expect(
			[recorded.anthropicNotFound, recorded.codexRetryBudget, recorded.codexStalled, recorded.streamTimeout, recorded.socketClosed, recorded.connectionError].map(message => endedOn(failed(message))),
		).toEqual([
			{ kind: "transient", provider: "anthropic" },
			{ kind: "transient", provider: "openai-codex" },
			{ kind: "transient", provider: "openai-codex" },
			{ kind: "transient", provider: "minimax-code" },
			{ kind: "transient", provider: "anthropic" },
			{ kind: "transient", provider: "anthropic" },
		]);
	});

	test("a 429 that omp also counts as transient stays a usage limit", () => {
		expect(endedOn(failed(recorded.minimaxRateLimit))).toEqual(limit("minimax-code", null));
	});

	test("a live event's message, which may not carry omp's flags yet, still reads from its error's text", () => {
		const { errorId: _, ...live } = recorded.minimaxTokenPlan;
		const { errorId: __, ...offline } = recorded.anthropicNotFound;
		expect([endedOn(failed(live)), endedOn(failed(offline))]).toEqual([limit("minimax-code", null), { kind: "transient", provider: "anthropic" }]);
	});

	test("omp's retry budget prefix keeps the limit it ended on", () => {
		expect(endedOn(failed({ ...recorded.opencodeGo, errorMessage: `Retry budget exhausted after 3 retries: ${recorded.opencodeGo.errorMessage}` }))).toEqual(limit("opencode-go", 200_813_000));
	});

	test("an error that is neither a usage limit nor transient, an abort, or a reply ends the turn on none", () => {
		expect(endedOn(failed(recorded.openrouterMaxTokens))).toBeNull();
		expect(endedOn(failed(recorded.usagePreflight))).toBeNull();
		expect(endedOn({ ...failed(recorded.minimaxTokenPlan), stopReason: "aborted" })).toBeNull();
		expect(endedOn({ ...failed(recorded.anthropicNotFound), stopReason: "aborted" })).toBeNull();
		expect(endedOn({ role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" })).toBeNull();
	});

	test("only the last assistant message counts: a failure omp recovered from earlier in the turn ends it on none", () => {
		expect(endedOn(failed(recorded.minimaxTokenPlan), { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }, { role: "toolResult", content: [] })).toBeNull();
		expect(endedOn(failed(recorded.codexStalled), { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" })).toBeNull();
		expect(endedOn({ role: "assistant", content: [{ type: "text", text: "starting" }], stopReason: "toolUse" }, { role: "toolResult", content: [] }, failed(recorded.anthropic))).toEqual(limit("anthropic", 5_215_000));
	});
});
