import { expect, test } from "bun:test";
import { parsePlanUsage } from "./usage";

const report = (email: string, orgName: string) => ({
	provider: "anthropic",
	metadata: { email, orgName },
	limits: [{ id: "7d", label: "Claude 7 Day", amount: { usedFraction: 0.5 }, window: { id: "7d" } }],
});

test("two accounts of one provider sharing an email are told apart by organization", () => {
	const plans = parsePlanUsage(JSON.stringify({
		reports: [report("max@yampa.ai", "Yampa"), report("max@gmail.com", "Gmail org"), report("max@yampa.ai", "Personal")],
	}));
	expect(plans.map(plan => plan.account)).toEqual(["max@yampa.ai · Yampa", "max@gmail.com", "max@yampa.ai · Personal"]);
});
