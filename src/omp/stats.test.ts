import { describe, expect, test } from "bun:test";
import { creditRuns, type ProviderRequest } from "./stats";

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
