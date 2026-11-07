import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage } from "../../src/shared/models";
import { PlanUsageList, spendLabel } from "./plan-usage";

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

test("the API credits grant turns amber below a fifth left and red once spent", () => {
	expect(footer({ ...apiCredits, balance: { used: 100, limit: 200, expiresAt: null } })).toContain("text-foreground");
	expect(footer({ ...apiCredits, balance: { used: 170, limit: 200, expiresAt: null } })).toContain("text-amber-600");
	expect(footer({ ...apiCredits, balance: { used: 200, limit: 200, expiresAt: null } })).toContain("text-red-600");
});

test("a provider refusing requests for lack of credit reads used up, with or without a grant to show", () => {
	const refused = footer({ ...apiCredits, outOfCreditSince: Date.parse("2026-11-07T08:46:51Z") });
	expect(refused).toContain("text-red-600");
	expect(refused).toContain("</span> used up</span>");
	expect(footer(apiCredits)).not.toContain("used up");

	const withGrant = footer({ ...apiCredits, balance: { used: 120, limit: 200, expiresAt: null }, outOfCreditSince: 1 });
	expect(withGrant).toContain("text-red-600");
	expect(withGrant).toContain("$120.00 / $200.00");
});
