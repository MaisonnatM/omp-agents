import { describe, expect, test } from "bun:test";
import { age, dayLabel, modelLabel, modelOrg, providerLabel, skillLabel } from "./labels";

describe("model labels", () => {
	test("a direct provider's model reads as its family and dotted version", () => {
		expect(modelLabel("anthropic/claude-opus-5-5")).toBe("Opus 5.5");
		expect(modelOrg("anthropic/claude-opus-5-5")).toBe("anthropic");
		expect(modelLabel("openai-codex/gpt-5.5")).toBe("GPT-5.5");
		expect(modelOrg("openai-codex/gpt-5.5")).toBe("openai");
	});

	test("dated and version-first Anthropic ids read like the current ones", () => {
		expect(modelLabel("anthropic/claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
		expect(modelLabel("anthropic/claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
		expect(modelLabel("openrouter/openai/gpt-4o-mini-2024-07-18")).toBe("GPT-4o Mini");
	});

	test("only one- and two-digit parts join into a version, and a zero minor version drops", () => {
		expect(modelLabel("openai/gpt-4-1106-preview")).toBe("GPT-4 1106 Preview");
		expect(modelLabel("cursor/claude-opus-5-5-1m-fast")).toBe("Opus 5.5 1M Fast");
		expect(modelLabel("anthropic/claude-sonnet-4-0")).toBe("Sonnet 4");
	});

	test("a colon suffix reads in parentheses, whether a router's tier or a thinking level", () => {
		expect(modelLabel("openrouter/openai/o3-mini:batch")).toBe("o3 Mini (batch)");
		expect(modelLabel("anthropic/claude-sonnet-5-5:high")).toBe("Sonnet 5.5 (high)");
	});

	test("a reseller's model belongs to the family's org", () => {
		expect(modelOrg("cursor/claude-opus-4-7")).toBe("anthropic");
		expect(modelOrg("cursor/composer-2")).toBe("cursor");
	});

	test("a router's org/model id names the org", () => {
		expect(modelLabel("openrouter/~anthropic/claude-opus-latest")).toBe("Opus Latest");
		expect(modelOrg("openrouter/~anthropic/claude-opus-latest")).toBe("anthropic");
		expect(modelLabel("openrouter/moonshotai/kimi-k3")).toBe("Kimi K3");
		expect(modelOrg("openrouter/z-ai/glm-5.3")).toBe("z-ai");
	});

	test("provider ids and skill names read as titles, keeping brand casing", () => {
		expect(providerLabel("openai-codex")).toBe("OpenAI Codex");
		expect(providerLabel("openrouter")).toBe("OpenRouter");
		expect(skillLabel("poteto-mode")).toBe("Poteto Mode");
		expect(skillLabel("Poteto Mode")).toBe("Poteto Mode");
	});
});

describe("day labels", () => {
	test("a time in the current year reads as its day, and one a day earlier across new year as its month and year", () => {
		const now = new Date(2026, 0, 2, 9);
		expect(dayLabel(new Date(2026, 0, 1, 23).toISOString(), now)).not.toContain("2026");
		expect(dayLabel(new Date(2025, 11, 31, 23).toISOString(), now)).toContain("2025");
	});
});

describe("ages", () => {
	const now = Date.parse("2026-10-02T12:00:00Z");
	const ago = (minutes: number, compact: boolean): string => age(now - minutes * 60_000, { compact, now });
	const minutes = [0, 0.9, 1, 59, 60, 23 * 60 + 59, 24 * 60, -5];

	test("a compact age shows its largest whole unit, rounding down at each boundary", () => {
		expect(minutes.map(at => ago(at, true))).toEqual(["<1m", "<1m", "1m", "59m", "1h", "23h", "1d", "<1m"]);
	});

	test("a full age shows hours with their minutes", () => {
		expect(minutes.map(at => ago(at, false))).toEqual(["0m", "0m", "1m", "59m", "1h 0m", "23h 59m", "1d", "0m"]);
	});
});
