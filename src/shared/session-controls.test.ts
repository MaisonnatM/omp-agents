import { describe, expect, test } from "bun:test";
import { advisorCommand, contextCommand, goalCommand, parseContextAction, parseGoalChange } from "./session-controls";

const goal = { objective: "ship", status: "paused" as const, tokensUsed: 42, tokenBudget: 100000, timeUsedSeconds: 4 };

describe("context actions", () => {
	test("only the named modes cross the socket", () => {
		for (const mode of [null, "soft", "remote", "snapcompact"] as const) expect(contextCommand({ kind: "compact", mode })).toBe(`/compact${mode === null ? "" : ` ${mode}`}`);
		for (const mode of ["elide", "images", "thinking"] as const) expect(contextCommand({ kind: "shake", mode })).toBe(`/shake ${mode}`);
		expect(contextCommand({ kind: "handoff" })).toBe("/handoff");
		expect(parseContextAction({ kind: "compact", mode: "bad" })).toBeNull();
		expect(parseContextAction({ kind: "shake", mode: "soft" })).toBeNull();
		expect(parseContextAction({ kind: "handoff" })).toEqual({ kind: "handoff" });
	});
});

test("advisor tracking accepts only native on, off, and toggle commands", () => {
	expect(advisorCommand(" /advisor ")).toBe("toggle");
	for (const op of ["on", "off", "toggle"] as const) expect(advisorCommand(`/advisor ${op}`)).toBe(op);
	for (const text of ["hello", "/advisors", "/advisor model", "/advisor on extra", "/advisor ON"]) expect(advisorCommand(text)).toBeNull();
});

describe("goal changes", () => {
	test("validates objectives and optional token budgets at the wire", () => {
		expect(parseGoalChange({ op: "set", objective: " ship ", tokenBudget: null })).toEqual({ op: "set", objective: "ship", tokenBudget: null });
		for (const tokenBudget of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"]) expect(parseGoalChange({ op: "set", objective: "ship", tokenBudget })).toBeNull();
		expect(parseGoalChange({ op: "set", objective: " ", tokenBudget: 100 })).toBeNull();
		expect(parseGoalChange({ op: "pause" })).toEqual({ op: "pause" });
	});

	test("maps composer goal commands without changing ordinary prompts", () => {
		expect(goalCommand("hello", null)).toBeNull();
		expect(goalCommand("/goals", null)).toBeNull();
		expect(goalCommand("/goal", null)).toBe("show");
		expect(goalCommand("/goal show", goal)).toBe("show");
		expect(goalCommand("/goal pause", goal)).toEqual({ op: "pause" });
		expect(goalCommand("/goal resume", goal)).toEqual({ op: "resume" });
		expect(goalCommand("/goal drop", goal)).toEqual({ op: "clear" });
		expect(goalCommand("/goal fix the\neditor", null)).toEqual({ op: "set", objective: "fix the\neditor", tokenBudget: null });
		expect(goalCommand("/goal budget 500000", goal)).toEqual({ op: "set", objective: "ship", tokenBudget: 500000 });
		expect(goalCommand("/goal budget none", goal)).toEqual({ op: "set", objective: "ship", tokenBudget: null });
		expect(() => goalCommand("/goal budget 500000", null)).toThrow();
		expect(() => goalCommand("/goal budget nope", goal)).toThrow();
	});
});
