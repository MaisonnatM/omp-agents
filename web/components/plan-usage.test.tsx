import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage } from "../../src/shared/models";
import { creditView, PlanUsageList, spendLabel } from "./plan-usage";

const apiCredits: PlanUsage = { provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null };
const footer = (plan: PlanUsage) => renderToStaticMarkup(<PlanUsageList usage={{ plans: [plan], error: null }} />);

test("formats subscription spend and caps in the account currency without converting", () => {
	expect(spendLabel({ used: 13.65, limit: null, currency: "EUR" })).toBe("€13.65");
	expect(spendLabel({ used: 13.65, limit: 50, currency: "EUR" })).toBe("€13.65 / €50.00");
	expect(spendLabel({ used: 13.65, limit: 50, currency: "USD" })).toBe("$13.65 / $50.00");
});

test("preserves dollar formatting for API grants and USD quota windows", () => {
	expect(spendLabel({ used: 12.4, limit: 200 })).toBe("$12.40 / $200.00");
	expect(spendLabel({ used: 0.001, limit: null })).toBe("$0.001");
});

test("the API credits amount and tone: red once the grant or the prepaid balance runs out, never below $0.00", () => {
	const cases = [
		[{ kind: "prepaid", left: -0.72 }, "$0.00 left", "out"],
		[{ kind: "prepaid", left: 0 }, "$0.00 left", "out"],
		[{ kind: "prepaid", left: 5 }, "$5.00 left", "ok"],
		[{ kind: "grant", used: 200, limit: 200, expiresAt: null }, "$200.00 / $200.00", "out"],
		[{ kind: "grant", used: 170, limit: 200, expiresAt: null }, "$170.00 / $200.00", "low"],
		[{ kind: "grant", used: 11.13, limit: 200, expiresAt: null }, "$11.13 / $200.00", "ok"],
	] as const;
	for (const [balance, amount, tone] of cases) expect(creditView(balance)).toMatchObject({ amount, tone });
});

test("a provider refusing requests for lack of credit reads used up, with or without a balance to show", () => {
	const refused = footer({ ...apiCredits, outOfCreditSince: Date.parse("2026-11-07T08:46:51Z") });
	expect(refused).toContain("text-red-600");
	expect(refused).toContain("</span> used up</span>");
	expect(footer(apiCredits)).not.toContain("used up");

	const withGrant = footer({ ...apiCredits, balance: { kind: "grant", used: 120, limit: 200, expiresAt: null }, outOfCreditSince: 1 });
	expect(withGrant).toContain("text-red-600");
	expect(withGrant).toContain("$120.00 / $200.00");
	expect(footer({ ...apiCredits, balance: { kind: "grant", used: 120, limit: 200, expiresAt: null } })).not.toContain("text-red-600");

	const withPrepaid = footer({ ...apiCredits, balance: { kind: "prepaid", left: 3 }, outOfCreditSince: 1 });
	expect(withPrepaid).toContain("text-red-600");
	expect(withPrepaid).toContain("$3.00 left");
});
