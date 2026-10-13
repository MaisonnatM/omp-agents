import { describe, expect, test } from "bun:test";
import { readSelector, resolveSelector, routedSelectors } from "./config";

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
