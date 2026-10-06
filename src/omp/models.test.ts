import { describe, expect, test } from "bun:test";
import type { CatalogModel } from "../shared/models";
import { modelEntries, resolveRoles } from "./models";

const listed = (selector: string): CatalogModel => ({ selector, provider: selector.slice(0, selector.indexOf("/")), name: selector, contextWindow: null, thinking: ["low", "high"] });
const catalog = [listed("anthropic/claude-opus-5-5"), listed("anthropic/claude-haiku-4-5"), listed("openrouter/minimax/minimax-m3:batch")];
const connected = new Set(["anthropic", "openrouter"]);

describe("resolveRoles", () => {
	test("each role names its model and the level its selector adds, in config order", () => {
		expect(resolveRoles({ default: "anthropic/claude-opus-5-5:high", smol: "anthropic/claude-haiku-4-5", batch: "openrouter/minimax/minimax-m3:batch" }, catalog, connected)).toEqual([
			{ role: "default", model: { provider: "anthropic", id: "claude-opus-5-5" }, thinking: "high" },
			{ role: "smol", model: { provider: "anthropic", id: "claude-haiku-4-5" }, thinking: null },
			{ role: "batch", model: { provider: "openrouter", id: "minimax/minimax-m3:batch" }, thinking: null },
		]);
	});

	test("an alias takes its target's model, and its level unless it names its own", () => {
		const roles = { default: "anthropic/claude-opus-5-5:high", slow: "@default", plan: "@slow:low", task: "*" };
		expect(resolveRoles(roles, catalog, connected).map(({ role, thinking }) => [role, thinking])).toEqual([
			["default", "high"],
			["slow", "high"],
			["plan", "low"],
			["task", "high"],
		]);
	});

	test("roles that could not switch are left out: patterns, unconnected providers, unknown or looping aliases", () => {
		const roles = { fuzzy: "opus", cursor: "cursor/grok-4.7-high", missing: "@nope", a: "@b", b: "@a" };
		expect(resolveRoles(roles, [...catalog, listed("cursor/grok-4.7-high")], connected)).toEqual([]);
	});
});

describe("modelEntries", () => {
	const model = (selector: string) => {
		const slash = selector.indexOf("/");
		return { provider: selector.slice(0, slash), id: selector.slice(slash + 1), name: selector, contextWindow: null };
	};
	const models = [
		"anthropic/claude-opus-5-5",
		"anthropic/claude-fable-5-1",
		"cursor/grok-4.7",
		"openrouter/minimax/minimax-m3:batch",
		"openrouter/z-ai/glm-5.3",
	].map(model);
	const noRouting = { modelRoles: {}, fallbackChains: {}, modelProviderOrder: [] };
	const curated = (config: { modelRoles?: Record<string, string>; fallbackChains?: Record<string, string[]> }) =>
		modelEntries(models, { ...noRouting, ...config }, new Set(["anthropic", "cursor", "openrouter"])).flatMap(entry =>
			entry.curated ? [`${entry.provider}/${entry.id}`] : [],
		);

	test("a model is curated when a role or a fallback chain names it, with or without a thinking level", () => {
		expect(
			curated({ modelRoles: { default: "anthropic/claude-opus-5-5:high", slow: "@default" }, fallbackChains: { default: ["openrouter/minimax/minimax-m3:batch"] } }),
		).toEqual(["anthropic/claude-opus-5-5", "openrouter/minimax/minimax-m3:batch"]);
	});

	test("a chain keyed by a model curates that model, and a model id holding a colon keeps it", () => {
		expect(curated({ fallbackChains: { "openrouter/z-ai/glm-5.3": ["openrouter/minimax/minimax-m3:batch:low"] } })).toEqual([
			"openrouter/minimax/minimax-m3:batch",
			"openrouter/z-ai/glm-5.3",
		]);
	});

	test("a selector curates the model omp runs for it: a retired variant id or a dotted spelling, but not a wildcard", () => {
		expect(curated({ modelRoles: { plan: "anthropic/claude-fable-5.1:high" }, fallbackChains: { default: ["cursor/grok-4.7-high"], "openrouter/*": ["cursor/grok-4.7-xhigh"] } })).toEqual([
			"anthropic/claude-fable-5-1",
			"cursor/grok-4.7",
		]);
	});

	test("providers in the configured provider order come first, in that order, and the rest keep omp's order", () => {
		const entries = modelEntries(models, { ...noRouting, modelProviderOrder: ["openrouter", "cursor"] }, new Set(["anthropic", "cursor", "openrouter"]));
		expect(entries.map(entry => entry.provider)).toEqual(["openrouter", "openrouter", "cursor", "anthropic", "anthropic"]);
	});

	test("models of providers you are not connected to are left out, even when curated", () => {
		const entries = modelEntries(models, { ...noRouting, modelRoles: { default: "cursor/grok-4.7" } }, new Set(["anthropic"]));
		expect(entries.map(entry => entry.id)).toEqual(["claude-opus-5-5", "claude-fable-5-1"]);
	});

	test("a field beyond the picker entry stays on it", () => {
		const [entry] = modelEntries([{ provider: "anthropic", id: "claude-opus-5-5", name: "Opus", contextWindow: 1_000_000, thinkingLevels: ["low", "high"] }], noRouting, new Set(["anthropic"]));
		expect(entry?.thinkingLevels).toEqual(["low", "high"]);
	});
});
