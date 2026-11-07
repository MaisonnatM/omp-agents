import { expect, test } from "bun:test";
import { creditView, spendLabel } from "./plan-usage";

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
