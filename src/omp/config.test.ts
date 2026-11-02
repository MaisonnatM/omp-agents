import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";
import { loadOmpConfig, loadSessionControlsConfig, readSelector, resolveSelector, routedSelectors } from "./config";
import { advisorConfig, advisorSettings, compaction, config, goalSettings, modelCompactionSettings } from "./modules";
import type { OmpSettingsInstance } from "./module-types/config";

afterEach(() => mock.restore());

const known = new Set(["anthropic/claude-opus-5-5", "openrouter/minimax/minimax-m3:batch", "cursor/grok-4.7"]);

describe("readSelector", () => {
	test("splits off a :level only once the id without it is listed, so an id with its own colon stays whole", () => {
		expect(readSelector(" anthropic/claude-opus-5-5:high ", known)).toEqual({ provider: "anthropic", id: "claude-opus-5-5", suffix: ":high" });
		expect(readSelector("openrouter/minimax/minimax-m3:batch", known)).toEqual({ provider: "openrouter", id: "minimax/minimax-m3:batch", suffix: "" });
		expect(readSelector("openrouter/minimax/minimax-m3:batch:low", known)).toEqual({ provider: "openrouter", id: "minimax/minimax-m3:batch", suffix: ":low" });
	});

	test("reads a model that is not listed, and nothing from a selector without a provider", () => {
		expect(readSelector("cursor/grok-4.7-high", known)).toEqual({ provider: "cursor", id: "grok-4.7-high", suffix: "" });
		expect(readSelector("opus", known)).toBeNull();
		expect(readSelector("  ", known)).toBeNull();
	});
});

describe("resolveSelector", () => {
	test("keeps only a selector whose model is listed", () => {
		expect(resolveSelector("anthropic/claude-opus-5-5:high", known)).toEqual({ provider: "anthropic", id: "claude-opus-5-5", suffix: ":high" });
		expect(resolveSelector("cursor/grok-4.7-high", known)).toBeNull();
		expect(resolveSelector("anthropic/claude-opus-9", known)).toBeNull();
	});
});

describe("routedSelectors", () => {
	test("names each role's selector, then each chain's key and entries", () => {
		const routing = { modelRoles: { default: "anthropic/claude-opus-5-5", slow: "@default" }, fallbackChains: { default: ["cursor/grok-4.7"], "anthropic/claude-opus-5-5": ["openrouter/minimax/minimax-m3:batch"] } };
		expect(routedSelectors(routing)).toEqual(["anthropic/claude-opus-5-5", "@default", "default", "cursor/grok-4.7", "anthropic/claude-opus-5-5", "openrouter/minimax/minimax-m3:batch"]);
	});
});

describe("session controls config", () => {
	function settings(roles: Record<string, string> = {}, modes = ["interactive"]) {
		const value = fromPartial<OmpSettingsInstance>({ getModelRoles: () => roles });
		spyOn(config.Settings, "loadReadOnly").mockResolvedValue(value);
		spyOn(advisorSettings.cfgAdvisorEnabled, "get").mockReturnValue(false);
		spyOn(goalSettings.cfgGoalEnabled, "get").mockReturnValue(true);
		spyOn(goalSettings.cfgGoalContinuationModes, "get").mockReturnValue(modes);
		return value;
	}

	test("keeps advisor models structured, omits disabled entries, and falls back to the advisor role", async () => {
		settings({ advisor: "p/fallback" });
		const discover = spyOn(advisorConfig, "discoverAdvisorConfigs").mockResolvedValue({ advisors: [{ model: "p/one" }, { model: "p/disabled", enabled: false }, {}] });
		expect((await loadSessionControlsConfig("/project")).advisorModels).toEqual(["p/one", "p/fallback"]);
		discover.mockResolvedValue({ advisors: [{ model: "p/single" }] });
		expect((await loadSessionControlsConfig("/project")).advisorModels).toEqual(["p/single"]);
		discover.mockResolvedValue({ advisors: [] });
		expect((await loadSessionControlsConfig("/project")).advisorModels).toEqual(["p/fallback"]);
		settings();
		expect((await loadSessionControlsConfig("/project")).advisorModels).toEqual([]);
	});

	test("continues only when native settings opt RPC in", async () => {
		settings();
		spyOn(advisorConfig, "discoverAdvisorConfigs").mockResolvedValue({ advisors: [] });
		expect((await loadSessionControlsConfig("/project")).goalContinues).toBe(false);
		spyOn(goalSettings.cfgGoalContinuationModes, "get").mockReturnValue(["interactive", "rpc"]);
		expect((await loadSessionControlsConfig("/project")).goalContinues).toBe(true);
	});

	test("resolves the current model and context window through native compaction policy", async () => {
		const scope = settings();
		spyOn(advisorConfig, "discoverAdvisorConfigs").mockResolvedValue({ advisors: [] });
		const policy = { reserveTokens: 1234 };
		const resolve = spyOn(modelCompactionSettings, "resolveModelCompactionSettings").mockReturnValue(policy);
		const threshold = spyOn(compaction, "resolveThresholdTokens").mockReturnValue(180000);
		const loaded = await loadSessionControlsConfig("/project");
		const model = { provider: "p", id: "one" };
		expect(loaded.compactionThreshold(model, 200000)).toBe(180000);
		expect(resolve).toHaveBeenLastCalledWith(scope, model);
		expect(threshold).toHaveBeenLastCalledWith(200000, policy);
		loaded.compactionThreshold(undefined, 1000000);
		expect(resolve).toHaveBeenLastCalledWith(scope, undefined);
		expect(threshold).toHaveBeenLastCalledWith(1000000, policy);
	});

	test("generic routing reads do not discover advisor files", async () => {
		const discover = spyOn(advisorConfig, "discoverAdvisorConfigs");
		await loadOmpConfig("/tmp");
		expect(discover).not.toHaveBeenCalled();
	});
});
