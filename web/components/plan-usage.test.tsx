import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanUsage, PlanWindow } from "../../src/shared/models";
import { accountTags, chipParts, creditView, PlanCard, PlanUsageList, spendLabel } from "./plan-usage";

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

const NOW = Date.parse("2026-11-12T10:00:00Z");
const HOUR = 3_600_000;
const planWindow = (label: string, remaining: number, resetsAt: number | null = null): PlanWindow => ({ id: label, label, title: `Claude ${label}`, remaining, exhausted: remaining === 0, resetsAt });
const claude: PlanUsage = { provider: "anthropic", name: "Anthropic", account: "maxence@yampa.ai", windows: [], extra: null, resetCredits: null };
const chip = (plan: Partial<PlanUsage>) => chipParts({ ...claude, ...plan }, NOW).map(({ label, text }) => (label ? `${label} ${text}` : text));

test("a chip shows the tightest open window, then how many windows are used up, then the reset credits", () => {
	const windows = [planWindow("7d", 0.9), planWindow("5h", 0.43), planWindow("fable", 0, NOW + HOUR)];
	expect(chip({ windows, resetCredits: { count: 2, nextExpiresAt: null } })).toEqual(["5h 43% left", "1 used up", "✦ 2"]);
	expect(chipParts({ ...claude, windows: [planWindow("5h", 0.1)] }, NOW)[0]?.tone).toBe("low");
});

test("with every window used up, the chip says when the last one resets", () => {
	expect(chip({ windows: [planWindow("5h", 0, NOW + 3 * HOUR), planWindow("7d", 0, NOW + 30 * HOUR)] })).toEqual(["used up, resets in 1d6h"]);
	expect(chip({ windows: [planWindow("5h", 0)] })).toEqual(["used up"]);
});

test("a plan with no windows shows its spend past the plan, amber past most of its cap", () => {
	const parts = chipParts({ ...claude, extra: { title: "Extra usage", used: 45, limit: 50, currency: "USD", exhausted: false } }, NOW);
	expect(parts).toEqual([{ label: "extra", text: "$45.00 / $50.00", tone: "low" }]);
});

test("account tags tell apart the accounts of one provider, by domain or else by name", () => {
	const yampa = { ...claude };
	const gmail = { ...claude, account: "max@gmail.com" };
	const gmail2 = { ...claude, account: "ana@gmail.com" };
	const openai = { ...claude, provider: "openai-codex", account: "maxence@yampa.ai" };
	const tags = accountTags([yampa, gmail, gmail2, openai]);
	expect([tags.get(yampa), tags.get(gmail), tags.get(gmail2), tags.get(openai)]).toEqual(["yampa", "max", "ana", undefined]);
});

test("reset credits on an account with no windows show on its chip instead of hiding behind its name", () => {
	expect(footer({ ...claude, resetCredits: { count: 3, nextExpiresAt: null } })).toContain("✦ 3");
});

test("the card gives every window its share left and when it resets, with the date", () => {
	const card = renderToStaticMarkup(<PlanCard plan={{ ...claude, windows: [planWindow("5h", 0.59, NOW + 4 * HOUR + 19 * 60_000), planWindow("7d", 0)] }} now={NOW} />).replaceAll("<!-- -->", "");
	expect(card).toContain("59% left");
	expect(card).toContain("used up");
	expect(card).toMatch(/Resets in 4h19m · \D*12\b/);
});
