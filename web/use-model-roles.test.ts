import { describe, expect, test } from "bun:test";
import type { ModelRole } from "../src/shared";
import { roleOf } from "./use-model-roles";

const opus = { provider: "anthropic", id: "claude-opus-5-5" };
const flash = { provider: "opencode-go", id: "deepseek-v4.1-flash" };
const roles: ModelRole[] = [
	{ role: "default", model: opus, thinking: "high" },
	{ role: "smol", model: flash, thinking: null },
	{ role: "plan", model: opus, thinking: "high" },
	{ role: "slow", model: opus, thinking: "xhigh" },
];

describe("roleOf", () => {
	test("among roles naming the same model and level, the one picked last wins, else the first in config order", () => {
		expect(roleOf(roles, "anthropic/claude-opus-5-5", "high", "plan")?.role).toBe("plan");
		expect(roleOf(roles, "anthropic/claude-opus-5-5", "high", null)?.role).toBe("default");
	});

	test("a pick that no longer matches the model or level gives way to the role that does", () => {
		expect(roleOf(roles, "anthropic/claude-opus-5-5", "xhigh", "plan")?.role).toBe("slow");
		expect(roleOf(roles, "opencode-go/deepseek-v4.1-flash", "low", "plan")?.role).toBe("smol");
	});

	test("no role matches a model none names, or a level none of its roles names", () => {
		expect(roleOf(roles, "openai/gpt-6", "high", "plan")).toBeNull();
		expect(roleOf(roles, "anthropic/claude-opus-5-5", "low", "default")).toBeNull();
	});
});
