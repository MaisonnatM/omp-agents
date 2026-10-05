import { describe, expect, test } from "bun:test";
import type { ModelEntry, PlanUsage } from "../src/shared";
import { contextVariants, modelMatch, providerUsed } from "./model-menu";

const entry = (provider: string, id: string, contextWindow: number | null): ModelEntry => ({ provider, id, name: id, contextWindow, curated: false });

describe("contextVariants", () => {
	const models = [
		entry("cursor", "claude-opus-5-5-1m", 1_000_000),
		entry("cursor", "claude-opus-5-5", 300_000),
		entry("cursor", "claude-opus-5", 300_000),
		entry("anthropic", "claude-opus-5-5", 1_000_000),
		entry("cursor", "gpt-5.5", 272_000),
		entry("cursor", "gpt-5.5-fast", 272_000),
	];
	const ids = (selector: string) => contextVariants(models, selector).map(model => model.id);

	test("a model and its context-size sibling on the same provider, smallest window first, from either one", () => {
		expect(ids("cursor/claude-opus-5-5")).toEqual(["claude-opus-5-5", "claude-opus-5-5-1m"]);
		expect(ids("cursor/claude-opus-5-5-1m")).toEqual(["claude-opus-5-5", "claude-opus-5-5-1m"]);
	});

	test("nothing to choose without a sibling of another window size", () => {
		expect(ids("anthropic/claude-opus-5-5")).toEqual([]);
		expect(ids("cursor/claude-opus-5")).toEqual([]);
		expect(ids("cursor/gpt-5.5")).toEqual([]);
		expect(ids("cursor/missing")).toEqual([]);
	});
});

describe("providerUsed", () => {
	const plan = (provider: string, remaining: number[]): PlanUsage => ({
		provider,
		name: provider,
		account: null,
		windows: remaining.map((left, index) => ({ label: `w${index}`, title: `w${index}`, remaining: left, resetsAt: null })),
	});

	test("the tightest window of the account with the most left", () => {
		expect(providerUsed([plan("anthropic", [0.8, 0.25]), plan("anthropic", [0.5, 0.6]), plan("cursor", [0])], "anthropic")).toBe(0.5);
	});

	test("null for a provider without a plan or windows", () => {
		expect(providerUsed([plan("anthropic", [0.5]), plan("cursor", [])], "openrouter")).toBeNull();
		expect(providerUsed([plan("cursor", [])], "cursor")).toBeNull();
	});
});

describe("modelMatch", () => {
	test("every word typed must appear, in any order, in the selector or a name", () => {
		expect(modelMatch("openrouter/z-ai/glm-5.3-flash", "glm 5.3 flash", ["GLM 5.3 Flash"])).toBe(1);
		expect(modelMatch("openrouter/z-ai/glm-5.3-flash", "FLASH glm", [])).toBe(1);
		expect(modelMatch("anthropic/claude-opus-5-5", "opus 5.5", ["Opus 5.5", "Claude Opus 5.5"])).toBe(1);
	});

	test("letters scattered across another model's name do not match", () => {
		expect(modelMatch("cursor/gemini-3.5-flash", "glm 5.3 flash", ["Gemini 3.5 Flash"])).toBe(0);
	});
});
