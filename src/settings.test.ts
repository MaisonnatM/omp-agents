import { describe, expect, test } from "bun:test";
import { routeRoles } from "./settings";

describe("routeRoles", () => {
	test("a chat role without its own chain walks the default chain; a model-kind role does not", () => {
		const routing = routeRoles(
			{ default: "anthropic/claude-opus-5-5:high", smol: "anthropic/claude-haiku-4-5", image: "openai/gpt-image-2" },
			{ default: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"] },
		);
		expect(routing).toEqual({
			roles: [
				{
					role: "default",
					primary: "anthropic/claude-opus-5-5:high",
					fallbacks: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"],
					inheritsDefault: false,
				},
				{
					role: "smol",
					primary: "anthropic/claude-haiku-4-5",
					fallbacks: ["openai-codex/gpt-6-sol:high", "cursor/grok-4.7-high"],
					inheritsDefault: true,
				},
				{ role: "image", primary: "openai/gpt-image-2", fallbacks: [], inheritsDefault: false },
			],
			modelChains: [],
		});
	});

	test("model-keyed chains stay apart from roles, and a chain can name a role with no model", () => {
		const routing = routeRoles(
			{ default: "anthropic/claude-opus-5-5" },
			{ "anthropic/*": ["openrouter/anthropic/*"], task: ["cursor/grok-4.7-high"] },
		);
		expect(routing).toEqual({
			roles: [
				{ role: "default", primary: "anthropic/claude-opus-5-5", fallbacks: [], inheritsDefault: false },
				{ role: "task", primary: null, fallbacks: ["cursor/grok-4.7-high"], inheritsDefault: false },
			],
			modelChains: [{ key: "anthropic/*", fallbacks: ["openrouter/anthropic/*"] }],
		});
	});
});
