import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { creditRuns, listPrice, sessionRows } from "./stats";

const INSUFFICIENT = "402 Insufficient credits. Add more using https://openrouter.ai/settings/credits";

const DAY_MS = 24 * 60 * 60_000;

const NOW = 10 * DAY_MS;

type Outcome = "worked" | "aborted" | { error: string };

/** A stats database holding `requests`, each `[provider, timestamp, outcome, model]`. */
const statsWith = (requests: [string, number, Outcome, string?][]) => {
	const db = new Database(":memory:");
	db.run("CREATE TABLE messages (provider TEXT, model TEXT, timestamp INT, stop_reason TEXT, error_message TEXT)");
	for (const [provider, timestamp, outcome, model = "openai/gpt-5.5"] of requests) {
		const [stopReason, error] = outcome === "worked" ? ["stop", null] : outcome === "aborted" ? ["aborted", null] : ["error", outcome.error];
		db.run("INSERT INTO messages VALUES (?, ?, ?, ?, ?)", [provider, model, NOW - DAY_MS + timestamp, stopReason, error]);
	}
	return db;
};

const providersWithRuns = (db: Database) => creditRuns(db, NOW).map(run => run.provider);

describe("creditRuns", () => {
	test("a run starts at the first billing 402 after the last request that worked, and another failure, an abort, or another provider's request that works neither starts nor ends it", () => {
		const db = statsWith([
			["openrouter", 1, "worked"],
			["openrouter", 2, { error: "getaddrinfo ENOTFOUND openrouter.ai" }],
			["openrouter", 3, { error: INSUFFICIENT }],
			["openrouter", 4, { error: "getaddrinfo ENOTFOUND openrouter.ai" }],
			["deepseek", 4, "worked"],
			["openrouter", 5, "aborted"],
			["openrouter", 6, { error: `openrouter/~typesafe/jev-latest API error (402): {"error":{"message":"Insufficient credits"}}` }, "~typesafe/jev-latest"],
		]);
		expect(creditRuns(db, NOW)).toEqual([
			{
				provider: "openrouter",
				model: "~typesafe/jev-latest",
				failures: 2,
				since: NOW - DAY_MS + 3,
				error: `openrouter/~typesafe/jev-latest API error (402): {"error":{"message":"Insufficient credits"}}`,
			},
		]);
	});

	test("a request that works ends the run, a 402 that asks for a smaller request is no billing cap, and a refusal over a day old is out", () => {
		const db = statsWith([
			["openrouter", 1, { error: INSUFFICIENT }],
			["openrouter", 2, "worked"],
			["deepseek", 3, { error: "402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 1200." }],
			["moonshot", -1, { error: "402 Insufficient balance" }],
		]);
		expect(providersWithRuns(db)).toEqual([]);
	});

	test("Anthropic's spent-balance 400 and its in-stream twin start an API credits run", () => {
		const refusal =
			'400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_1"}';
		const db = statsWith([
			["anthropic-api", 1, "worked", "claude-opus-5-5"],
			["anthropic-api", 2, { error: "Anthropic stream error (invalid_request_error): Your credit balance is too low to access the Anthropic API." }, "claude-opus-5-5"],
			["anthropic-api", 3, { error: refusal }, "claude-opus-5-5"],
			["anthropic", 4, { error: '400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}' }, "claude-opus-5-5"],
		]);
		expect(creditRuns(db, NOW)).toEqual([{ provider: "anthropic-api", model: "claude-opus-5-5", failures: 2, since: NOW - DAY_MS + 2, error: refusal.slice(0, 300) }]);
	});

	test("a spent balance, credits, or spend ceiling without a 402 starts a run, even one that says when it resets, and a per-minute throttle or rate limit does not", () => {
		const db = statsWith([
			["deepseek", 1, { error: 'deepseek API error: {"error":{"message":"Insufficient Balance","type":"unknown_error"}}' }],
			["openrouter", 2, { error: '{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits"}}' }],
			["anthropic-api", 3, { error: '400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your monthly spend limit."}}' }],
			["zai", 4, { error: "400 You have reached your monthly spend limit. Your limit will reset on the 1st." }],
			[
				"dashscope",
				5,
				{
					error: "429 You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://help.aliyun.com/zh/model-studio/error-code#token-limit (type=insufficient_quota param=insufficient_quota)",
				},
			],
			["anthropic", 6, { error: `429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account's rate limit. Please try again later."}}` }],
		]);
		expect(providersWithRuns(db)).toEqual(["deepseek", "openrouter", "anthropic-api", "zai"]);
	});

	test("Cursor's plan window, whose usage limits reset with the monthly cycle, starts no run, even though it names a spend limit", () => {
		const db = statsWith([
			[
				"cursor",
				1,
				{
					error: "Cursor RATE_LIMITED_CHANGEABLE: You've hit your usage limit for Opus: You've saved $266 on API model usage this month with Pro. Switch to a different model or set a Spend Limit to continue with Opus. Your usage limits will reset when your monthly cycle ends on 11/12/2026.",
				},
				"claude-opus-5-5",
			],
			[
				"cursor",
				2,
				{
					error: 'Connect error resource_exhausted: Error [details: aiserver.v1.ErrorDetails: {"error":"ERROR_RATE_LIMITED_CHANGEABLE","details":{"title":"You\'ve hit your usage limit","detail":"You\'ve saved $1256 on API model usage this month with Pro+. Switch to a different model or set a Spend Limit to continue with this model. Your usage limits will reset when your monthly cycle ends on 10/12/2026.","isRetryable":false}}]',
				},
				"claude-opus-5-5",
			],
		]);
		expect(providersWithRuns(db)).toEqual([]);
	});
});

test("listPrice uses omp's bundled API rates with Claude's cache lifetimes, and an unknown model costs zero", () => {
	const timestamp = Date.parse("2026-10-01T12:00:00Z");
	const tokens = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 };
	expect(listPrice("anthropic", "claude-haiku-4-5-20251001", tokens, timestamp)).toBeCloseTo(7.35, 10);
	expect(listPrice("anthropic", "claude-haiku-4-5-20251001", { ...tokens, cttl: { ephemeral5m: 500_000, ephemeral1h: 500_000 } }, timestamp)).toBeCloseTo(7.725, 10);
	expect(listPrice("anthropic", "not-a-catalog-model", tokens, timestamp)).toBe(0);
});

test("sessionRows counts a session file and its subagents' files, and no neighbor whose name extends it", () => {
	const db = new Database(":memory:");
	db.run(`CREATE TABLE messages (session_file TEXT, folder TEXT, provider TEXT, model TEXT, stop_reason TEXT, input_tokens INT, output_tokens INT,
		cache_read_tokens INT, cache_write_tokens INT, total_tokens INT, agent_type TEXT, cost_total REAL, timestamp INT)`);
	const add = (file: string, input: number) => db.run("INSERT INTO messages VALUES (?, '/w', 'anthropic', 'opus', 'stop', ?, 0, 0, 0, ?, 'main', 0, 1)", [file, input, input]);
	add("/s/p/1_abc.jsonl", 1);
	add("/s/p/1_abc/0-task.jsonl", 10);
	add("/s/p/1_abc/0-task/1-nested.jsonl", 100);
	add("/s/p/1_abcd.jsonl", 1000);
	add("/s/p/1_abc0/x.jsonl", 10000);
	const rows = sessionRows(db, "/s/p/1_abc.jsonl");
	expect(rows.reduce((sum, row) => sum + row.input, 0)).toBe(111);
});
