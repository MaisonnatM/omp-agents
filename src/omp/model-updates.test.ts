import { describe, expect, test } from "bun:test";
import type { CatalogModel } from "../shared/models";
import { findModelUpdates, upgradeEdits } from "./model-updates";

const listed = (selector: string): CatalogModel => ({ selector, provider: selector.slice(0, selector.indexOf("/")), name: selector.slice(selector.indexOf("/") + 1), contextWindow: null, thinking: [] });
const catalog = [
	"anthropic/claude-opus-5-5",
	"anthropic/claude-opus-5-6",
	"anthropic/claude-haiku-4-5",
	"anthropic/claude-sonnet-4-5-20250929",
	"anthropic/claude-sonnet-4-6",
	"openai-codex/gpt-6.1-sol",
	"openai-codex/gpt-6.2-sol",
	"openai-codex/gpt-6-astra",
	"openai-codex/gpt-6-luna",
	"openai-codex/gpt-6.1-luna",
	"openai-codex/gpt-6-2025-08-07",
	"openai-codex/gpt-6.1",
	"cursor/grok-4.7",
	"cursor/grok-4.8",
].map(listed);
const connected = new Set(["anthropic", "openai-codex", "cursor"]);

describe("findModelUpdates", () => {
	test("a role or fallback on an older version gets the newest of its own line, so GPT tiers stay apart", () => {
		const routing = {
			modelRoles: { default: "anthropic/claude-opus-5-5:high", slow: "anthropic/claude-opus-5-5", smol: "anthropic/claude-haiku-4-5" },
			fallbackChains: { default: ["openai-codex/gpt-6.1-sol:high", "openai-codex/gpt-6-astra:xhigh"], smol: ["openai-codex/gpt-6-luna", "anthropic/claude-opus-5-5"] },
		};
		expect(findModelUpdates(catalog, routing, connected)).toEqual([
			{ provider: "anthropic", from: { id: "claude-opus-5-5", name: "claude-opus-5-5" }, to: { id: "claude-opus-5-6", name: "claude-opus-5-6" }, uses: ["default", "slow", "smol fallbacks"] },
			{ provider: "openai-codex", from: { id: "gpt-6.1-sol", name: "gpt-6.1-sol" }, to: { id: "gpt-6.2-sol", name: "gpt-6.2-sol" }, uses: ["default fallbacks"] },
			{ provider: "openai-codex", from: { id: "gpt-6-luna", name: "gpt-6-luna" }, to: { id: "gpt-6.1-luna", name: "gpt-6.1-luna" }, uses: ["smol fallbacks"] },
		]);
	});

	test("a dated snapshot, another vendor's model, a provider not connected, and the newest version get none", () => {
		const routing = {
			modelRoles: { pinned: "anthropic/claude-sonnet-4-5-20250929", grok: "cursor/grok-4.7", newest: "anthropic/claude-opus-5-6" },
			fallbackChains: { default: ["openai-codex/gpt-6-luna"] },
		};
		expect(findModelUpdates(catalog, routing, new Set(["anthropic", "cursor"]))).toEqual([]);
		expect(findModelUpdates(catalog, { modelRoles: {}, fallbackChains: { default: ["openai-codex/gpt-6-2025-08-07"] } }, connected)).toEqual([]);
	});
});

describe("upgradeEdits", () => {
	test("every role and chain entry on the old model moves to the new one, keeping its level and the other entries", () => {
		const routing = {
			modelRoles: { default: "anthropic/claude-opus-5-5:high", slow: "anthropic/claude-opus-5-5:auto", plan: "anthropic/claude-haiku-4-5" },
			fallbackChains: { smol: ["anthropic/claude-haiku-4-5", "anthropic/claude-opus-5-5:low"], "openai-codex/gpt-6.1-sol": ["anthropic/claude-opus-5-5"] },
		};
		expect(upgradeEdits(routing, catalog, "anthropic", "claude-opus-5-5", "claude-opus-5-6")).toEqual([
			{ kind: "role", role: "default", primary: "anthropic/claude-opus-5-6:high" },
			{ kind: "role", role: "slow", primary: "anthropic/claude-opus-5-6:auto" },
			{ kind: "role", role: "smol", fallbacks: ["anthropic/claude-haiku-4-5", "anthropic/claude-opus-5-6:low"] },
			{ kind: "model-chain", key: "openai-codex/gpt-6.1-sol", fallbacks: ["anthropic/claude-opus-5-6"] },
		]);
	});
});
