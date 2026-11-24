import { expect, test } from "bun:test";
import type { RoutineRun } from "../src/routines";
import { spentWords, usageWords } from "./routines-model";

const run = (at: number, usage?: RoutineRun["usage"]): RoutineRun => ({ at, outcome: { kind: "sent", sessionId: "s" }, errors: [], triggeredBy: [], ...(usage ? { usage } : {}) });

test("a run's usage reads as compact tokens and dollars, a cost under a cent as <$0.01", () => {
	expect(usageWords({ tokens: 12_345, cost: 0.0412 })).toBe("12.3k tokens · $0.04");
	expect(usageWords({ tokens: 900, cost: 0.001 })).toBe("900 tokens · <$0.01");
	expect(usageWords({ tokens: 2_500_000, cost: 0 })).toBe("2.5m tokens · $0.00");
});

test("the kept runs' spend sums only the runs whose usage is known, and is null when none is", () => {
	expect(spentWords([run(3), run(2)])).toBeNull();
	expect(spentWords([run(3, { tokens: 10, cost: 0.2 }), run(2), run(1, { tokens: 10, cost: 0.11 })])).toBe("$0.31 over 2 runs");
	expect(spentWords([run(1, { tokens: 10, cost: 12.4 })])).toBe("$12 over 1 run");
});
