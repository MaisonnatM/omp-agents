import { expect, test } from "bun:test";
import { parseRpcGoal } from "./rpc";

test("parses native goal events without importing dashboard goal shapes", () => {
	const goal = { objective: "ship", status: "complete" as const, tokensUsed: 42, timeUsedSeconds: 3 };
	expect(parseRpcGoal(goal)).toEqual(goal);
	for (const status of ["active", "paused", "budget-limited", "complete", "dropped"] as const) expect(parseRpcGoal({ ...goal, status, tokenBudget: 100000 })).toEqual({ ...goal, status, tokenBudget: 100000 });
	for (const value of [null, {}, { ...goal, status: "unknown" }, { ...goal, objective: 1 }, { ...goal, tokensUsed: NaN }, { ...goal, timeUsedSeconds: Infinity }, { ...goal, tokenBudget: "100" }]) expect(parseRpcGoal(value)).toBeNull();
});
