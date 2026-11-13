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

test("a provider refusing requests for lack of credit reads used up and red, with or without a balance to show, and says why on hover", () => {
	const since = Date.parse("2026-11-07T08:46:51Z");
	const refused = ` Requests refused for lack of credit since ${new Date(since).toLocaleString()}.`;
	expect(tile({ ...apiCredits, outOfCreditSince: since })).toMatchObject({ value: "used up", tone: "out", detail: { kind: "tooltip", text: `API credits: used up.${refused}` } });
	expect(tile(apiCredits)).toEqual({ left: null, value: null, tone: "ok", caption: "API credits", label: "API credits: omp usage reports no balance.", detail: { kind: "tooltip", text: "API credits: omp usage reports no balance." } });
	const grant = { ...apiCredits, balance: { kind: "grant", used: 120, limit: 200, expiresAt: null } } as const;
	expect(tile({ ...grant, outOfCreditSince: since })).toMatchObject({ value: "$120.00 / $200.00", tone: "out", label: `API credits: $120.00 / $200.00 spent.${refused}` });
	expect(tile(grant)).toMatchObject({ tone: "ok", left: 0.4 });
	expect(tile({ ...apiCredits, balance: { kind: "grant", used: 0, limit: 0, expiresAt: null } }).left).toBeNull();
	expect(tile({ ...apiCredits, balance: { kind: "prepaid", left: 3 }, outOfCreditSince: 1 })).toMatchObject({ value: "$3.00 left", tone: "out" });
});

const NOW = Date.parse("2026-11-12T10:00:00Z");
const HOUR = 3_600_000;
const planWindow = (label: string, remaining: number, resetsAt: number | null = null): PlanWindow => ({ id: label, label, title: `Claude ${label}`, remaining, exhausted: remaining === 0, resetsAt });
const claude: PlanUsage = { provider: "anthropic", name: "Anthropic", account: "maxence@yampa.ai", windows: [], extra: null, resetCredits: null };

test("a tile reads the tightest open window, turns red when any window is used up, and names the account when the provider has several", () => {
	const windows = [planWindow("7d", 0.9), planWindow("5h", 0.43), planWindow("fable", 0, NOW + HOUR)];
	expect(planGauge({ ...claude, windows }, undefined)).toEqual({ left: 0.43, value: "43%", tone: "out", caption: "5h", label: "Anthropic, maxence@yampa.ai, 5h, 43% left, 1 used up", detail: { kind: "card" } });
	expect(planGauge({ ...claude, windows: windows.slice(0, 2) }, undefined)).toMatchObject({ tone: "ok", label: "Anthropic, maxence@yampa.ai, 5h, 43% left" });
	expect(planGauge({ ...claude, account: "max@gmail.com", windows: [planWindow("5h", 0.1)] }, "max@gmail.com")).toMatchObject({ tone: "low", caption: "max@gmail.com", label: "Anthropic, max@gmail.com, 10% left" });
	expect(tile({ ...claude, windows: [planWindow("5h", 0, NOW + 3 * HOUR)] })).toMatchObject({ value: "used up", tone: "out", left: 0, label: "Anthropic, maxence@yampa.ai, used up" });
});

test("a plan with no windows shows its spend past the plan, amber past most of its cap, and a cap of nothing leaves the ring empty", () => {
	const extra = { title: "Extra usage", used: 45, limit: 50, currency: "USD", exhausted: false };
	expect(tile({ ...claude, extra })).toMatchObject({ value: "$45.00 / $50.00", tone: "low", label: "Anthropic, maxence@yampa.ai, extra, $45.00 / $50.00 spent", detail: { kind: "card" } });
	expect(tile({ ...claude, extra: { ...extra, used: 0, limit: 0 } }).left).toBeNull();
});

test("reset credits on an account with no windows open its card instead of hiding behind its name", () => {
	expect(tile({ ...claude, resetCredits: { count: 3, nextExpiresAt: null } })).toMatchObject({ value: "✦ 3", label: "Anthropic, maxence@yampa.ai, 3 reset credits", detail: { kind: "card" } });
	expect(tile({ ...apiCredits, resetCredits: { count: 1, nextExpiresAt: null }, balance: { kind: "prepaid", left: 3 } }).detail.kind).toBe("tooltip");
});

test("a provider with several accounts names each by its full email; a lone account goes unnamed", () => {
	const yampa = { ...claude };
	const gmail = { ...claude, account: "max@gmail.com" };
	const openai = { ...claude, provider: "openai-codex", account: "maxence@yampa.ai" };
	const tags = accountTags([yampa, gmail, openai]);
	expect([tags.get(yampa), tags.get(gmail), tags.get(openai)]).toEqual(["maxence@yampa.ai", "max@gmail.com", undefined]);
});

test("the card gives every window its share left and when it resets, with the date", () => {
	const card = renderToStaticMarkup(<PlanCard plan={{ ...claude, windows: [planWindow("5h", 0.59, NOW + 4 * HOUR + 19 * 60_000), planWindow("7d", 0)] }} now={NOW} />).replaceAll("<!-- -->", "");
	expect(card).toContain("59% left");
	expect(card).toContain("used up");
	expect(card).toMatch(/Resets in 4h19m · \D*12\b/);
});
