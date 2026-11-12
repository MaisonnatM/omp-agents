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

const text = (plans: PlanUsage[]) => renderToStaticMarkup(<PlanUsageList usage={{ plans, error: null }} />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const window = (label: string, remaining: number, resetsAt: number | null = null) => ({ id: label, label, title: label, remaining, exhausted: remaining === 0, resetsAt });
const claude: PlanUsage = { provider: "anthropic", name: "Anthropic", account: "maxence@yampa.ai", windows: [], extra: null, resetCredits: null };

test("an account's chip shows its tightest open window and counts the used-up ones", () => {
	const chip = text([{ ...claude, windows: [window("7d", 0.9), window("5h", 0.43), window("fable", 0)] }]);
	expect(chip).toContain("5h 43% left · 1 used up");
	expect(chip).not.toContain("7d");
});

test("with every window used up, the chip says when the last one comes back", () => {
	const now = Date.now();
	const chip = text([{ ...claude, windows: [window("5h", 0, now + 3 * 3_600_000), window("7d", 0, now + 30 * 3_600_000)] }]);
	expect(chip).toContain("used up · back in 1d6h");
});

test("the account tag appears only when its provider has another account", () => {
	expect(text([{ ...claude, windows: [window("5h", 0.5)] }])).not.toContain(" yampa ");
	const both = text([
		{ ...claude, windows: [window("5h", 0.5)] },
		{ ...claude, account: "max@gmail.com", windows: [window("7d", 0.5)] },
	]);
	expect(both).toContain("yampa 5h 50% left");
	expect(both).toContain("gmail 7d 50% left");
});

test("saved resets show on an account with no windows instead of hiding behind its name", () => {
	expect(text([{ ...claude, resetCredits: { count: 3, nextExpiresAt: null } }])).toContain("✦ 3 saved resets");
	expect(text([{ ...claude, extra: { title: "Extra usage", used: 4, limit: 50, currency: "USD", exhausted: false } }])).toContain("extra $4.00 / $50.00");
});
