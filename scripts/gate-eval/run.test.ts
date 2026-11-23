import { expect, test } from "bun:test";
import { evaluate, loadCases } from "./run";

/** Cases each gate gets right today. Raise a floor when a fix lands; a drop means a rule change broke a labeled past call. */
const FLOOR: Record<string, number> = { "bash-guard": 20, "untrusted-reader": 14, ship: 10 };

test("each gate keeps its accuracy on the labeled past calls", async () => {
	const cases = await loadCases();
	expect(cases).toHaveLength(50);
	expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
	const { scores, mismatches } = evaluate(cases);
	for (const s of scores) {
		const wrong = mismatches.filter(m => m.gate === s.gate).map(m => m.id);
		expect(s.cases - wrong.length, `${s.gate} mismatches: ${wrong.join(", ")}`).toBeGreaterThanOrEqual(FLOOR[s.gate] ?? s.cases);
	}
});
