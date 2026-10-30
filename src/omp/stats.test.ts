import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { creditRuns, listPrice, type ProviderRequest, sessionRows } from "./stats";

const INSUFFICIENT = "402 Insufficient credits. Add more using https://openrouter.ai/settings/credits";

const request = (provider: string, timestamp: number, error: string | null, model = "openai/gpt-5.5"): ProviderRequest => ({
	provider,
	model,
	timestamp,
	failed: error === null ? 0 : 1,
	error,
});

describe("creditRuns", () => {
	test("a run starts at the first billing 402 after the last request that worked, and another failure neither starts nor ends it", () => {
		const runs = creditRuns([
			request("openrouter", 1, null),
			request("openrouter", 2, "getaddrinfo ENOTFOUND openrouter.ai"),
			request("openrouter", 3, INSUFFICIENT),
			request("openrouter", 4, "getaddrinfo ENOTFOUND openrouter.ai"),
			request("openrouter", 5, `openrouter/~typesafe/jev-latest API error (402): {"error":{"message":"Insufficient credits"}}`, "~typesafe/jev-latest"),
		]);
		expect(runs).toEqual([
			{ provider: "openrouter", model: "~typesafe/jev-latest", failures: 2, since: 3, error: `openrouter/~typesafe/jev-latest API error (402): {"error":{"message":"Insufficient credits"}}` },
		]);
	});

	test("a request that works ends the run, and a 402 that asks for a smaller request is no billing cap", () => {
		const runs = creditRuns([
			request("openrouter", 1, INSUFFICIENT),
			request("openrouter", 2, null),
			request("deepseek", 3, "402 This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford 1200."),
		]);
		expect(runs).toEqual([]);
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
