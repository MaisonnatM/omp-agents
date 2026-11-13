import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage, PlanWindow } from "../../src/shared/models";
import { accountTags, creditView, PlanCard, planGauge, spendLabel } from "./plan-usage";

const apiCredits: PlanUsage = { provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null };
const tile = (plan: PlanUsage) => planGauge(plan, undefined);

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

test("a provider refusing requests for lack of credit reads used up and red, with or without a balance to show", () => {
	expect(tile({ ...apiCredits, outOfCreditSince: Date.parse("2026-11-07T08:46:51Z") })).toMatchObject({ value: "used up", tone: "out" });
	expect(tile(apiCredits)).toMatchObject({ value: null, left: null });
	const grant = { ...apiCredits, balance: { kind: "grant", used: 120, limit: 200, expiresAt: null } } as const;
	expect(tile({ ...grant, outOfCreditSince: 1 })).toMatchObject({ value: "$120.00 / $200.00", tone: "out" });
	expect(tile(grant)).toMatchObject({ tone: "ok", left: 0.4 });
	expect(tile({ ...apiCredits, balance: { kind: "prepaid", left: 3 }, outOfCreditSince: 1 })).toMatchObject({ value: "$3.00 left", tone: "out" });
});

const NOW = Date.parse("2026-11-12T10:00:00Z");
const HOUR = 3_600_000;
const planWindow = (label: string, remaining: number, resetsAt: number | null = null): PlanWindow => ({ id: label, label, title: `Claude ${label}`, remaining, exhausted: remaining === 0, resetsAt });
const claude: PlanUsage = { provider: "anthropic", name: "Anthropic", account: "maxence@yampa.ai", windows: [], extra: null, resetCredits: null };

test("a tile reads the tightest open window, named by the account tag when the provider has several", () => {
	const windows = [planWindow("7d", 0.9), planWindow("5h", 0.43), planWindow("fable", 0, NOW + HOUR)];
	expect(planGauge({ ...claude, windows }, undefined)).toEqual({ left: 0.43, value: "43%", tone: "ok", caption: "5h" });
	expect(planGauge({ ...claude, windows: [planWindow("5h", 0.1)] }, "gmail")).toMatchObject({ tone: "low", caption: "gmail" });
	expect(tile({ ...claude, windows: [planWindow("5h", 0, NOW + 3 * HOUR)] })).toMatchObject({ value: "used up", tone: "out", left: 0 });
});

test("a plan with no windows shows its spend past the plan, amber past most of its cap", () => {
	expect(tile({ ...claude, extra: { title: "Extra usage", used: 45, limit: 50, currency: "USD", exhausted: false } })).toMatchObject({ value: "$45.00 / $50.00", tone: "low" });
});

test("account tags tell apart the accounts of one provider, by domain or else by name", () => {
	const yampa = { ...claude };
	const gmail = { ...claude, account: "max@gmail.com" };
	const gmail2 = { ...claude, account: "ana@gmail.com" };
	const openai = { ...claude, provider: "openai-codex", account: "maxence@yampa.ai" };
	const tags = accountTags([yampa, gmail, gmail2, openai]);
	expect([tags.get(yampa), tags.get(gmail), tags.get(gmail2), tags.get(openai)]).toEqual(["yampa", "max", "ana", undefined]);
});


test("the card gives every window its share left and when it resets, with the date", () => {
	const card = renderToStaticMarkup(<PlanCard plan={{ ...claude, windows: [planWindow("5h", 0.59, NOW + 4 * HOUR + 19 * 60_000), planWindow("7d", 0)] }} now={NOW} />).replaceAll("<!-- -->", "");
	expect(card).toContain("59% left");
	expect(card).toContain("used up");
	expect(card).toMatch(/Resets in 4h19m · \D*12\b/);
});
