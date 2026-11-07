import { expect, test } from "bun:test";
import { creditLabel, spendLabel } from "./plan-usage";

test("formats subscription spend and caps in the account currency without converting", () => {
	expect(spendLabel({ used: 13.65, limit: null, currency: "EUR" })).toBe("€13.65");
	expect(spendLabel({ used: 13.65, limit: 50, currency: "EUR" })).toBe("€13.65 / €50.00");
	expect(spendLabel({ used: 13.65, limit: 50, currency: "USD" })).toBe("$13.65 / $50.00");
});

test("preserves dollar formatting for API grants and USD quota windows", () => {
	expect(spendLabel({ used: 12.4, limit: 200 })).toBe("$12.40 / $200.00");
	expect(spendLabel({ used: 0.001, limit: null })).toBe("$0.001");
});

test("a prepaid balance overdrawn below zero reads as nothing left", () => {
	expect(creditLabel({ kind: "prepaid", left: -0.72 })).toBe("$0.00 left");
	expect(creditLabel({ kind: "prepaid", left: 5 })).toBe("$5.00 left");
});
