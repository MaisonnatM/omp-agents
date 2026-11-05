import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CatalogModel } from "../shared/models";
import type { CredentialOrigin } from "./module-types/models";
import { configuredProviderIds, connectedProviderIds, modelEntries, resolveRoles } from "./models";
import { auth, modelRegistry } from "./modules";

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

const source = (present: Record<string, CredentialOrigin["kind"]>) => (id: string): CredentialOrigin | undefined =>
	present[id] === undefined ? undefined : { kind: present[id] };

describe("connectedProviderIds", () => {
	test("keeps a sign-in provider with a credential, and a catalog provider whose key comes from the model config", () => {
		const connected = connectedProviderIds(
			["anthropic", "cursor"],
			["anthropic", "anthropic-api", "anthropic-api", "from-env", "local-demo"],
			source({ anthropic: "oauth", "anthropic-api": "config", "from-env": "env" }),
		);
		expect([...connected].sort()).toEqual(["anthropic", "anthropic-api"]);
	});

	test("leaves out a sign-in provider with no credential and a keyless catalog provider", () => {
		expect([...connectedProviderIds(["anthropic"], ["anthropic", "local-demo"], source({}))]).toEqual([]);
	});
});

describe("configuredProviderIds", () => {
	test("an Anthropic API key saved in Settings adds the API credits row beside the Anthropic sign-in", () => {
		expect(configuredProviderIds(["anthropic", "cursor"], source({ anthropic: "oauth", cursor: "oauth" }), true)).toEqual(["anthropic-api"]);
		expect(configuredProviderIds(["anthropic", "cursor"], source({ anthropic: "oauth", cursor: "oauth" }), false)).toEqual([]);
	});

	test("a model-config API credits provider and a saved key give one row", () => {
		expect(configuredProviderIds(["anthropic-api", "anthropic-api"], source({ "anthropic-api": "config" }), true)).toEqual(["anthropic-api"]);
	});

	test("a saved key still adds the row when an API credits provider takes its key from the environment", () => {
		expect(configuredProviderIds(["anthropic-api"], source({ "anthropic-api": "env" }), true)).toEqual(["anthropic-api"]);
	});
});

describe("model config API keys", () => {
	test("a provider whose model config sets an API key is a config source, and a keyless one is not", async () => {
		const dir = mkdtempSync(join(tmpdir(), "omp-agents-models-"));
		const modelsPath = join(dir, "models.yml");
		writeFileSync(
			modelsPath,
			[
				"providers:",
				"  anthropic-api:",
				"    baseUrl: https://api.anthropic.com",
				"    api: anthropic-messages",
				"    auth: apiKey",
				"    apiKey: test-key",
				"    models:",
				"      - id: claude-haiku-5-5",
				"        name: Claude Haiku 5.5 (API credits)",
				"        input: [text]",
				"        contextWindow: 100000",
				"        maxTokens: 128000",
				"  local-demo:",
				"    baseUrl: http://127.0.0.1:9",
				"    api: openai-completions",
				"    auth: none",
				"    models:",
				"      - id: demo",
				"        name: Demo",
				"        input: [text]",
				"        contextWindow: 1000",
				"        maxTokens: 100",
				"",
			].join("\n"),
		);
		// The config key stays in the registry's memory. This still opens the real credential store, as the other store tests do.
		const storage = await auth.discoverAuthStorage();
		try {
			const registry = new modelRegistry.ModelRegistry(storage, modelsPath);
			const connected = connectedProviderIds(
				[],
				registry.getAvailable().map(model => model.provider),
				id => storage.keys.source(id),
			);
			expect(storage.keys.source("anthropic-api")?.kind).toBe("config");
			expect(storage.keys.source("local-demo")).toBeUndefined();
			expect(connected.has("anthropic-api")).toBe(true);
			expect(connected.has("local-demo")).toBe(false);
		} finally {
			storage.close();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
