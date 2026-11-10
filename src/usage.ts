/** Plan quota left per provider, read from `omp usage --json` of this same omp package. */
import { readConsoleCreditBalance } from "./console-credits";
import { isObject, num, str } from "./json";
import { ompCommand } from "./omp/install";
import { configuredProviders } from "./omp/models";
import type { UsageReport } from "./omp/module-types/models";
import { type CreditRun, readCreditRuns } from "./omp/stats";
import { readRawUsageReports } from "./omp/usage";
import { run } from "./proc";
import { API_CREDITS_PROVIDER, type CreditBalance, type ExtraUsage, isNameOnlyPlan, PROVIDER_NAMES, type PlanUsage, type PlanWindow, type ResetCredits, type UsdAmount } from "./shared/models";

const TIMEOUT_MS = 30_000;

/** The name the page shows for omp's provider id `provider`: `Anthropic` for `anthropic`, `Minimax Code` for `minimax-code`. */
export const providerName = (provider: string): string =>
	PROVIDER_NAMES[provider] ??
	provider
		.split(/[-_]/)
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");

/** Some providers report only the used fraction, some only absolute amounts. */
function remainingOf(amount: Record<string, unknown>): number | undefined {
	const remaining = num(amount.remainingFraction);
	if (remaining !== undefined) return remaining;
	const left = num(amount.remaining);
	const limit = num(amount.limit);
	if (left !== undefined && limit) return left / limit;
	const used = num(amount.usedFraction);
	return used === undefined ? undefined : 1 - used;
}

/** The dollars of a USD amount; `null` for any other unit or without a spend. */
function usdOf(amount: Record<string, unknown>): UsdAmount | null {
	const used = num(amount.used);
	if (str(amount.unit) !== "usd" || used === undefined) return null;
	return { used, limit: num(amount.limit) ?? null };
}

function parseLimit(raw: unknown): PlanWindow | null {
	if (!isObject(raw) || !isObject(raw.window) || !isObject(raw.amount)) return null;
	const remaining = remainingOf(raw.amount);
	const window = str(raw.window.id) || str(raw.window.label);
	if (remaining === undefined || !window) return null;
	const tier = isObject(raw.scope) ? str(raw.scope.tier) : undefined;
	const left = Math.min(1, Math.max(0, remaining));
	const status = str(raw.status);
	const usd = usdOf(raw.amount);
	return {
		id: str(raw.id) || window,
		label: tier ? `${window} ${tier}` : window,
		title: str(raw.label) || window,
		remaining: left,
		resetsAt: num(raw.window.resetsAt) ?? null,
		exhausted: status === "exhausted" || ((!status || status === "unknown") && left <= 0),
		...(usd && { usd }),
	};
}

/** A USD limit without a window is spend past the plan, such as omp's `anthropic:extra`. */
function parseExtra(raw: unknown): ExtraUsage | null {
	if (!isObject(raw) || isObject(raw.window) || !isObject(raw.amount)) return null;
	const usd = usdOf(raw.amount);
	if (!usd) return null;
	return {
		...usd,
		currency: "USD",
		title: str(raw.label) || "Extra usage",
		exhausted: str(raw.status) === "exhausted" || (usd.limit !== null && usd.used >= usd.limit),
	};
}

function parseResetCredits(raw: unknown): ResetCredits | null {
	if (!isObject(raw)) return null;
	const count = num(raw.availableCount) ?? 0;
	if (count <= 0) return null;
	const expiries = (Array.isArray(raw.credits) ? (raw.credits as unknown[]) : [])
		.filter(isObject)
		.filter(credit => !["expired", "redeemed"].includes(str(credit.status) ?? "") && (num(credit.remainingCount) ?? 1) > 0)
		.map(credit => Date.parse(str(credit.expiresAt) ?? ""))
		.filter(at => !Number.isNaN(at));
	return { count, nextExpiresAt: expiries.length ? Math.min(...expiries) : null };
}

interface BillingMoney {
	value: number;
	currency: string;
}

function billingMoney(minor: unknown, exponent: unknown, currency: unknown): BillingMoney | null {
	if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor < 0) return null;
	if (typeof exponent !== "number" || !Number.isInteger(exponent) || exponent < 0 || exponent > 9) return null;
	if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) return null;
	return { value: minor / 10 ** exponent, currency: currency.toUpperCase() };
}

/** `null` disables billing; an absent or invalid observation leaves normalized CLI spend intact. */
function claudeExtra(raw: unknown): ExtraUsage | null | undefined {
	if (!isObject(raw)) return undefined;
	const modern = raw.spend !== undefined && raw.spend !== null;
	const spend = modern ? raw.spend : raw.extra_usage;
	if (!isObject(spend)) return undefined;
	const enabled = modern ? spend.enabled : spend.is_enabled;
	if (enabled === false) return null;
	if (enabled !== true) return undefined;
	const used = modern && isObject(spend.used)
		? billingMoney(spend.used.amount_minor, spend.used.exponent, spend.used.currency)
		: !modern
			? billingMoney(spend.used_credits, spend.decimal_places ?? 2, spend.currency ?? "USD")
			: null;
	if (!used) return undefined;
	const cap = modern ? spend.limit : spend.monthly_limit;
	const limit = cap === null
		? null
		: modern && isObject(cap)
			? billingMoney(cap.amount_minor, cap.exponent, cap.currency)
			: !modern
				? billingMoney(cap, spend.decimal_places ?? 2, spend.currency ?? "USD")
				: undefined;
	if (limit === undefined || (cap !== null && !limit)) return undefined;
	if (limit && (limit.currency !== used.currency || limit.value <= 0)) return undefined;
	return {
		used: used.value,
		limit: limit?.value ?? null,
		currency: used.currency,
		title: "Claude Extra Usage",
		exhausted: limit !== null && used.value >= limit.value,
	};
}

interface ReportIdentity {
	orgId: string | null;
	accountId: string | null;
	email: string | null;
}

function reportIdentity(report: { metadata?: unknown; limits?: unknown }): ReportIdentity | null {
	const metadata = isObject(report.metadata) ? report.metadata : {};
	const scopes = (Array.isArray(report.limits) ? report.limits : []).filter(isObject).map(limit => limit.scope).filter(isObject);
	const field = (key: string): string[] => [...new Set([metadata[key], ...scopes.map(scope => scope[key])]
		.filter((value): value is string => typeof value === "string" && value.trim() !== "")
		.map(value => value.trim()))];
	const orgIds = field("orgId");
	const accountIds = field("accountId");
	if (orgIds.length > 1 || accountIds.length > 1) return null;
	const email = str(metadata.email)?.trim().toLowerCase() || null;
	if (accountIds.length === 0 && !email) return null;
	return { orgId: orgIds[0] ?? null, accountId: accountIds[0] ?? null, email };
}

function sameIdentity(left: ReportIdentity, right: ReportIdentity): boolean {
	if (left.orgId !== null && right.orgId !== null && left.orgId !== right.orgId) return false;
	if (left.accountId !== null && right.accountId !== null) return left.accountId === right.accountId;
	if (left.orgId !== right.orgId) return false;
	return left.email !== null && left.email === right.email;
}

/** Merge billing before a report without quota windows can be discarded, without replacing CLI quotas. */
function withRawBilling(report: Record<string, unknown>, reports: readonly UsageReport[], cliReports: readonly unknown[]): Record<string, unknown> {
	const identity = reportIdentity(report);
	if (!identity) return report;
	const matches = reports.filter(candidate => {
		if (candidate.provider !== report.provider) return false;
		const other = reportIdentity(candidate);
		return other !== null && sameIdentity(identity, other);
	});
	if (matches.length !== 1) return report;
	const match = matches[0]!;
	if (!isObject(match.raw)) return report;
	const matchedIdentity = reportIdentity(match)!;
	if (identity.accountId === null || matchedIdentity.accountId === null) {
		const accountIds = new Set<string>();
		for (const candidate of [...cliReports, ...reports]) {
			if (!isObject(candidate) || candidate.provider !== report.provider) continue;
			const other = reportIdentity(candidate);
			if (other?.orgId === identity.orgId && other.email === identity.email && other.accountId !== null) {
				accountIds.add(other.accountId);
			}
		}
		if (accountIds.size > 1) return report;
	}
	const targets = cliReports.filter(candidate => {
		if (!isObject(candidate) || candidate.provider !== report.provider) return false;
		const other = reportIdentity(candidate);
		return other !== null && sameIdentity(matchedIdentity, other);
	});
	return targets.length === 1 ? { ...report, raw: match.raw } : report;
}

/**
 * Plans with at least one quota window or extra usage, in omp's order. A window is named by its id (`5h`, `7d`),
 * plus its model tier when it meters one model. Limits that would share a name keep omp's label.
 */
export function parsePlanUsage(stdout: string, rawReports: readonly UsageReport[] = []): PlanUsage[] {
	const data: unknown = JSON.parse(stdout);
	if (!isObject(data) || !Array.isArray(data.reports)) throw new Error("omp usage --json printed no reports");
	const plans: PlanUsage[] = [];
	for (const rawReport of data.reports as unknown[]) {
		if (!isObject(rawReport) || !Array.isArray(rawReport.limits)) continue;
		const report = withRawBilling(rawReport, rawReports, data.reports);
		const provider = str(report.provider);
		const limits = report.limits as unknown[];
		const windows = limits.map(parseLimit).filter(window => window !== null);
		const billing = provider === "anthropic" ? claudeExtra(report.raw) : undefined;
		const extra = billing === undefined ? limits.map(parseExtra).find(found => found !== null) ?? null : billing;
		if (!provider || (windows.length === 0 && extra === null)) continue;
		const metadata = isObject(report.metadata) ? report.metadata : {};
		plans.push({
			provider,
			name: providerName(provider),
			account: str(metadata.email) || str(metadata.accountId) || null,
			windows: windows.map(window =>
				windows.some(other => other !== window && other.label === window.label) ? { ...window, label: window.title } : window,
			),
			extra,
			resetCredits: parseResetCredits(report.resetCredits),
		});
	}
	return plans;
}

/**
 * Plans plus a name-only row for each configured provider `omp usage` did not report.
 * An API key, from the model config or saved in Settings for Anthropic's API credits, has no quota window in that report.
 */
export function plansWithConfiguredProviders(plans: readonly PlanUsage[], configured: readonly string[]): PlanUsage[] {
	const shown = new Set(plans.map(plan => plan.provider));
	const extra = configured.filter(id => !shown.has(id)).sort();
	return [
		...plans,
		...extra.map(provider => ({ provider, name: providerName(provider), account: null, windows: [], extra: null, resetCredits: null })),
	];
}

/** Puts `balance` on the name-only API credits row. A missing balance leaves every plan as it was. */
export function withCreditBalance(plans: readonly PlanUsage[], balance: CreditBalance | null): PlanUsage[] {
	if (!balance) return [...plans];
	return plans.map(plan =>
		plan.provider === API_CREDITS_PROVIDER && isNameOnlyPlan(plan) ? { ...plan, balance } : plan,
	);
}

/** Marks each name-only row whose provider is refusing requests for lack of credit, from the bell's credit runs. */
export function withCreditRuns(plans: readonly PlanUsage[], runs: readonly CreditRun[]): PlanUsage[] {
	const since = new Map(runs.map(run => [run.provider, run.since]));
	return plans.map(plan => {
		const outOfCreditSince = since.get(plan.provider);
		return outOfCreditSince !== undefined && isNameOnlyPlan(plan) ? { ...plan, outOfCreditSince } : plan;
	});
}

/** omp exits non-zero when some provider fails, after printing the reports it did get. */
export async function fetchPlanUsage(): Promise<PlanUsage[]> {
	const refusals = readCreditRuns(Date.now()).catch(() => []);
	// A credential-store miss must not hide the plan windows `omp usage` returns.
	const configured = configuredProviders().catch((): string[] => []);
	// Only the API credits row shows the Console balance, so nothing else copies the browser's cookie databases to read it.
	const credits = configured.then(providers => (providers.includes(API_CREDITS_PROVIDER) ? readConsoleCreditBalance().catch(() => null) : null));
	const rawReports = await readRawUsageReports().catch(() => null);
	const { stdout, stderr, code } = await run([...ompCommand, "usage", "--json"], { timeoutMs: TIMEOUT_MS });
	let plans: PlanUsage[];
	try {
		plans = parsePlanUsage(stdout, rawReports ?? []);
	} catch {
		throw new Error(stderr.trim().split("\n").pop() || `omp usage exited with code ${code}`);
	}
	return withCreditRuns(withCreditBalance(plansWithConfiguredProviders(plans, await configured), await credits), await refusals);
}
