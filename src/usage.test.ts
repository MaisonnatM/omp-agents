import { describe, expect, test } from "bun:test";
import { parsePlanUsage, plansWithConfiguredProviders, withCreditBalance, withCreditRuns } from "./usage";

const limit = (label: string, window: string, amount: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
	label,
	window: { id: window, resetsAt: 1790870400000 },
	amount,
	...extra,
});

describe("parsePlanUsage", () => {
	test("names windows by id and tier, and falls back to omp's label when two would match", () => {
		const stdout = JSON.stringify({
			reports: [
				{
					provider: "anthropic",
					limits: [
						limit("Claude 5 Hour", "5h", { remainingFraction: 0.69 }, { id: "anthropic:5h" }),
						limit("Claude 7 Day (Fable)", "7d", { remainingFraction: 1 }, { id: "anthropic:7d:fable", scope: { tier: "fable" } }),
					],
					metadata: { email: "me@example.com" },
				},
				{
					provider: "cursor",
					limits: [
						limit("Cursor Models", "monthly", { usedFraction: 0.4 }),
						limit("Other Models", "monthly", { remaining: 0, limit: 20 }),
					],
				},
			],
		});
		expect(parsePlanUsage(stdout)).toEqual([
			{
				provider: "anthropic",
				name: "Anthropic",
				account: "me@example.com",
				windows: [
					{ id: "anthropic:5h", label: "5h", title: "Claude 5 Hour", remaining: 0.69, resetsAt: 1790870400000, exhausted: false },
					{ id: "anthropic:7d:fable", label: "7d fable", title: "Claude 7 Day (Fable)", remaining: 1, resetsAt: 1790870400000, exhausted: false },
				],
				extra: null,
				resetCredits: null,
			},
			{
				provider: "cursor",
				name: "Cursor",
				account: null,
				windows: [
					{ id: "monthly", label: "Cursor Models", title: "Cursor Models", remaining: 0.6, resetsAt: 1790870400000, exhausted: false },
					{ id: "monthly", label: "Other Models", title: "Other Models", remaining: 0, resetsAt: 1790870400000, exhausted: true },
				],
				extra: null,
				resetCredits: null,
			},
		]);
	});

	test("takes omp's status over the amount left, so an allowed overdraft is not used up", () => {
		const stdout = JSON.stringify({
			reports: [
				{
					provider: "openai-codex",
					limits: [
						limit("5 Hour", "5h", { remainingFraction: 0 }, { id: "openai-codex:primary", status: "warning" }),
						limit("7 Day", "7d", { remainingFraction: 0.01 }, { id: "openai-codex:secondary", status: "exhausted" }),
					],
				},
			],
		});
		expect(parsePlanUsage(stdout)[0]?.windows.map(({ id, exhausted }) => [id, exhausted])).toEqual([
			["openai-codex:primary", false],
			["openai-codex:secondary", true],
		]);
	});

	test("counts the banked reset credits and dates the soonest one omp counts, usable now or not", () => {
		const report = (resetCredits: unknown) => ({ provider: "openai-codex", limits: [limit("5 Hour", "5h", { remainingFraction: 1 })], resetCredits });
		const stdout = JSON.stringify({
			reports: [
				report({
					availableCount: 3,
					credits: [
						{ expiresAt: "2026-10-01T00:00:00Z", status: "redeemed" },
						{ expiresAt: "2026-10-05T00:00:00Z", status: "expired" },
						{ expiresAt: "2026-10-08T00:00:00Z", status: "unavailable", remainingCount: 0 },
						{ expiresAt: "2026-10-29T00:00:00Z", status: "available" },
						{ expiresAt: "2026-10-15T00:00:00Z", status: "paused" },
						{ expiresAt: "2026-10-22T00:00:00Z" },
					],
				}),
				report({ availableCount: 0, credits: [{ expiresAt: "2026-10-22T00:00:00Z", status: "redeemed" }] }),
				report({ availableCount: 1 }),
				report(null),
			],
		});
		expect(parsePlanUsage(stdout).map(plan => plan.resetCredits)).toEqual([
			{ count: 3, nextExpiresAt: Date.parse("2026-10-15T00:00:00Z") },
			null,
			{ count: 1, nextExpiresAt: null },
			null,
		]);
	});

	test("skips providers without a measurable limit and clamps overdrawn windows", () => {
		const stdout = JSON.stringify({
			reports: [
				{ provider: "github-copilot", limits: [] },
				{ provider: "zai", limits: [limit("Tokens", "5h", { used: 3 })] },
				{ provider: "kimi-code", limits: [limit("Weekly", "7d", { usedFraction: 1.25 })] },
			],
		});
		expect(parsePlanUsage(stdout)).toEqual([
			{
				provider: "kimi-code",
				name: "Kimi Code",
				account: null,
				windows: [{ id: "7d", label: "7d", title: "Weekly", remaining: 0, resetsAt: 1790870400000, exhausted: true }],
				extra: null,
				resetCredits: null,
			},
		]);
	});

	test("reads a windowless USD limit as extra usage, and keeps the dollars of a USD window", () => {
		const extra = (amount: Record<string, unknown>, status?: string) => ({ id: "anthropic:extra", label: "Claude Extra Usage", amount: { unit: "usd", ...amount }, ...(status && { status }) });
		const stdout = JSON.stringify({
			reports: [
				{ provider: "anthropic", limits: [limit("Claude 5 Hour", "5h", { remainingFraction: 0.5 }), extra({ used: 12.4, limit: 50 })] },
				{ provider: "anthropic", limits: [extra({ used: 3 })] },
				{ provider: "anthropic", limits: [extra({ used: 50, limit: 50 }, "exhausted")] },
				{ provider: "cursor", limits: [limit("Other Models", "monthly", { used: 5, limit: 20, remaining: 15, unit: "usd" })] },
			],
		});
		const plans = parsePlanUsage(stdout);
		expect(plans.map(plan => [plan.windows.length, plan.extra])).toEqual([
			[1, { used: 12.4, limit: 50, currency: "USD", title: "Claude Extra Usage", exhausted: false }],
			[0, { used: 3, limit: null, currency: "USD", title: "Claude Extra Usage", exhausted: false }],
			[0, { used: 50, limit: 50, currency: "USD", title: "Claude Extra Usage", exhausted: true }],
			[1, null],
		]);
		expect(plans[3]?.windows[0]).toMatchObject({ remaining: 0.75, usd: { used: 5, limit: 20 } });
		expect(plans[0]?.windows[0]?.usd).toBeUndefined();
	});

	test("rejects output that is not a usage report", () => {
		expect(() => parsePlanUsage("Error: not logged in")).toThrow();
		expect(() => parsePlanUsage(JSON.stringify({ generatedAt: 1 }))).toThrow("omp usage --json printed no reports");
	});
});

describe("Claude raw billing", () => {
	const identity = { accountId: "account-a", email: "maxence@yampa.ai", orgId: "org-a" };
	const money = (amount_minor: unknown = 1365, currency: unknown = "EUR", exponent: unknown = 2) => ({ amount_minor, currency, exponent });
	const spend = (used: unknown = money(), cap: unknown = null) => ({ enabled: true, used, limit: cap });
	const report = (raw: unknown, metadata: Record<string, unknown> = identity, limits: unknown[] = []) => ({ provider: "anthropic", metadata, limits, raw });
	const cli = (metadata: Record<string, unknown> = identity, limits: unknown[] = []) => report(undefined, metadata, limits);
	const normalized = { id: "anthropic:extra", label: "Claude Extra Usage", amount: { unit: "usd", used: 3, limit: 50 } };
	const parse = (raw: unknown, limits: unknown[] = []) => parsePlanUsage(JSON.stringify({ reports: [cli(identity, limits)] }), [report(raw)]);

	test("keeps EUR 13.65 with no cap even when the CLI report has no limits", () => {
		expect(parse({ spend: spend() })).toEqual([{
			provider: "anthropic",
			name: "Anthropic",
			account: "maxence@yampa.ai",
			windows: [],
			extra: { used: 13.65, limit: null, currency: "EUR", title: "Claude Extra Usage", exhausted: false },
			resetCredits: null,
		}]);
	});

	test("keeps CLI quota windows and reset credits when raw billing supplements them", () => {
		const quota = limit("Custom Claude quota", "custom", { remainingFraction: 0.25 });
		const stdout = JSON.stringify({ reports: [{ ...cli(identity, [quota]), resetCredits: { availableCount: 2 } }] });
		const plan = parsePlanUsage(stdout, [report({ spend: spend() }, identity, [limit("Ignored native quota", "5h", { remainingFraction: 1 })])])[0];
		expect(plan?.windows).toEqual([{ id: "custom", label: "custom", title: "Custom Claude quota", remaining: 0.25, resetsAt: 1790870400000, exhausted: false }]);
		expect(plan?.resetCredits).toEqual({ count: 2, nextExpiresAt: null });
		expect(plan?.extra?.currency).toBe("EUR");
	});

	test("preserves normalized USD spend when raw billing is absent or invalid", () => {
		for (const raw of [undefined, {}, { spend: { enabled: true } }, { spend: spend(money(), money(5000, "USD")) }]) {
			expect(parse(raw, [normalized])[0]?.extra).toEqual({ used: 3, limit: 50, currency: "USD", title: "Claude Extra Usage", exhausted: false });
		}
		expect(parse({ spend: spend(money(1365, "USD"), money(5000, "usd")) })[0]?.extra)
			.toEqual({ used: 13.65, limit: 50, currency: "USD", title: "Claude Extra Usage", exhausted: false });
	});

	test("only compares matching currencies and allows distinct valid exponents", () => {
		expect(parse({ spend: spend(money(1365, "eur"), money(100, "EUR", 1)) })[0]?.extra)
			.toEqual({ used: 13.65, limit: 10, currency: "EUR", title: "Claude Extra Usage", exhausted: true });
		for (const cap of [money(5000, "USD"), money(0), money(-1), {}]) {
			expect(parse({ spend: spend(money(), cap) })).toEqual([]);
		}
	});

	test("disabled modern billing suppresses stale CLI extra and does not revive legacy spend", () => {
		const legacy = { is_enabled: true, used_credits: 2000, monthly_limit: 5000 };
		expect(parse({ spend: { enabled: false }, extra_usage: legacy }, [normalized])).toEqual([]);
		expect(parse({ extra_usage: { is_enabled: false } }, [normalized])).toEqual([]);
		const quota = limit("Claude 5 Hour", "5h", { remainingFraction: 0.5 });
		expect(parse({ spend: { enabled: false } }, [quota, normalized])[0]?.extra).toBeNull();
	});

	test("reads legacy cents only without a modern spend observation", () => {
		const legacy = { is_enabled: true, used_credits: 1365, monthly_limit: null };
		expect(parse({ extra_usage: legacy })[0]?.extra).toEqual({ used: 13.65, limit: null, currency: "USD", title: "Claude Extra Usage", exhausted: false });
		expect(parse({ extra_usage: { ...legacy, currency: "EUR" } })[0]?.extra?.currency).toBe("EUR");
		expect(parse({ spend: { enabled: true }, extra_usage: legacy })).toEqual([]);
		expect(parse({ spend: { enabled: true }, extra_usage: legacy }, [normalized])[0]?.extra?.used).toBe(3);
	});

	test("rejects malformed amounts, currencies, exponents, and missing caps", () => {
		const invalid = [
			money(-1), money(1.5), money("1365"), money(Number.MAX_SAFE_INTEGER + 1),
			money(NaN), money(Infinity), money(1, "EU"), money(1, "EURO"),
			money(1, "12A"), money(1, null), money(1, "EUR", -1),
			money(1, "EUR", 1.5), money(1, "EUR", 10), money(1, "EUR", "2"),
		];
		for (const used of invalid) expect(parse({ spend: spend(used) })).toEqual([]);
		for (const cap of invalid) expect(parse({ spend: spend(money(), cap) })).toEqual([]);
		for (const value of [{ enabled: true, used: money() }, { enabled: "true", used: money(), limit: null }]) {
			expect(parse({ spend: value })).toEqual([]);
		}
	});

	test("matches account and organization rather than an email shared across subscriptions", () => {
		const stdout = JSON.stringify({ reports: [
			cli(identity, [normalized]),
			cli({ ...identity, orgId: "org-b" }, [normalized]),
			cli({ ...identity, accountId: "account-b" }, [normalized]),
		] });
		const plans = parsePlanUsage(stdout, [report({ spend: spend() })]);
		expect(plans.map(plan => [plan.extra?.used, plan.extra?.currency])).toEqual([[13.65, "EUR"], [3, "USD"], [3, "USD"]]);
	});

	test("uses email only when an account id is unavailable and the organization matches", () => {
		const emailOnly = { email: identity.email.toUpperCase(), orgId: identity.orgId };
		const stdout = JSON.stringify({ reports: [cli()] });
		expect(parsePlanUsage(stdout, [report({ spend: spend() }, emailOnly)])[0]?.extra?.used).toBe(13.65);
		expect(parsePlanUsage(stdout, [report({ spend: spend() }, { ...emailOnly, orgId: "org-b" })])).toEqual([]);
		expect(parsePlanUsage(stdout, [report({ spend: spend() }, { email: identity.email })])).toEqual([]);
	});

	test("does not attach ambiguous native or CLI identities", () => {
		const raw = report({ spend: spend() });
		const stdout = JSON.stringify({ reports: [cli()] });
		expect(parsePlanUsage(stdout, [raw, raw])).toEqual([]);
		const emailOnly = { email: identity.email, orgId: identity.orgId };
		const accounts = JSON.stringify({ reports: [cli(), cli({ ...identity, accountId: "account-b" })] });
		expect(parsePlanUsage(accounts, [report({ spend: spend() }, emailOnly)])).toEqual([]);
		expect(parsePlanUsage(stdout, [
			report({ spend: spend() }, emailOnly),
			report({ spend: spend() }, { ...identity, accountId: "account-b" }),
		])).toEqual([]);
		const scoped = [limit("Quota", "5h", { remainingFraction: 1 }, { scope: { accountId: "different-account" } })];
		expect(parsePlanUsage(stdout, [report({ spend: spend() }, identity, scoped)])).toEqual([]);
	});

	test("keeps Claude euros without an organization and leaves another provider's extra alone", () => {
		const cursorExtra = { id: "cursor:extra", label: "Cursor extra", amount: { unit: "usd", used: 5, limit: null } };
		const cursor = { ...cli({ accountId: "cursor-account", email: "maxence@yampa.ai" }, [cursorExtra]), provider: "cursor" };
		const stdout = JSON.stringify({ reports: [cursor, cli({ accountId: identity.accountId, email: identity.email })] });
		const plans = parsePlanUsage(stdout, [
			{ ...report({ spend: { enabled: false } }), provider: "cursor", metadata: { accountId: "cursor-account", email: "maxence@yampa.ai" } },
			report({ spend: spend() }),
		]);
		expect(plans.map(plan => [plan.provider, plan.extra?.used, plan.extra?.currency])).toEqual([
			["cursor", 5, "USD"],
			["anthropic", 13.65, "EUR"],
		]);
		expect(parsePlanUsage(JSON.stringify({ reports: [cursor] }), [report({ spend: spend() })])[0]?.extra?.used).toBe(5);
	});
});

describe("plansWithConfiguredProviders", () => {
	const plan = (provider: string) => ({
		provider,
		name: provider,
		account: null,
		windows: [{ id: "5h", label: "5h", title: "5h", remaining: 1, resetsAt: null, exhausted: false }],
		extra: null,
		resetCredits: null,
	});

	test("adds a name-only row for a configured provider that usage left out", () => {
		const plans = plansWithConfiguredProviders([plan("anthropic")], ["anthropic-api"]);
		expect(plans.map(each => each.provider)).toEqual(["anthropic", "anthropic-api"]);
		expect(plans[1]).toEqual({ provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null });
	});

	test("leaves a provider usage already reported as that report", () => {
		const reported = plan("anthropic-api");
		expect(plansWithConfiguredProviders([reported], ["anthropic-api"])).toEqual([reported]);
	});
});

describe("withCreditBalance", () => {
	const row = (provider: string) => ({
		provider,
		name: provider,
		account: null,
		windows: [] as [],
		extra: null,
		resetCredits: null,
	});
	const grant = { kind: "grant" as const, used: 11.13, limit: 200, expiresAt: Date.parse("2026-12-03T00:00:00Z") };

	test("puts the grant on the name-only API credits row and leaves the subscription row", () => {
		const plans = [row("anthropic"), row("anthropic-api")];
		expect(withCreditBalance(plans, grant)[1]).toEqual({ ...plans[1], balance: grant });
		expect(withCreditBalance(plans, grant)[0]).toEqual(plans[0]);
	});

	test("a missing grant leaves the rows unchanged", () => {
		const plans = [row("anthropic-api")];
		expect(withCreditBalance(plans, null)).toEqual(plans);
	});
});

describe("withCreditRuns", () => {
	const run = (provider: string, since: number) => ({ provider, model: "claude-opus-5-5", failures: 3, since, error: "Your credit balance is too low" });

	test("marks the name-only row of a provider refusing requests for lack of credit, and no plan with windows", () => {
		const apiKey = { provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null };
		const subscription = { ...apiKey, provider: "anthropic", name: "Anthropic", windows: [{ id: "5h", label: "5h", title: "5 hour", remaining: 0, exhausted: true, resetsAt: null }] };
		const marked = withCreditRuns([subscription, apiKey], [run("anthropic-api", 7), run("anthropic", 8)]);
		expect(marked).toEqual([subscription, { ...apiKey, outOfCreditSince: 7 }]);
	});

	test("no runs leave the rows unchanged", () => {
		const plans = [{ provider: "anthropic-api", name: "API credits", account: null, windows: [], extra: null, resetCredits: null }];
		expect(withCreditRuns(plans, [])).toEqual(plans);
	});
});
