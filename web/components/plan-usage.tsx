/** How much of each provider plan's usage windows is left, shown in the status bar and the model menu. */
import { createContext } from "react";
import { type CreditBalance, type ExtraUsage, isNameOnlyPlan, type PlanUsage, type PlanWindow, type ResetCredits } from "../../src/shared/models";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { DAY_FORMAT, providerOrg } from "../labels";
import { dollars } from "./settings/analytics-format";
import { OrgIcon } from "./org-icon";

/** Below this fraction left, a window reads as running low. */
const LOW = 0.2;

export const NO_PLANS: readonly PlanUsage[] = [];
/** The plans of the last `omp usage` run, for the model menu's quota line per provider. */
export const Plans = createContext<readonly PlanUsage[]>(NO_PLANS);

const currencyFormats = new Map<string, Intl.NumberFormat>();

/** Spend in the billing currency, with its cap when present; USD retains sub-cent precision. */
export function spendLabel({ used, limit, currency = "USD" }: Pick<ExtraUsage, "used" | "limit"> & { currency?: string }): string {
	let formatter = currencyFormats.get(currency);
	if (currency !== "USD" && !formatter) {
		formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
		currencyFormats.set(currency, formatter);
	}
	const format = currency === "USD" ? dollars : formatter!.format;
	return limit === null ? format(used) : `${format(used)} / ${format(limit)}`;
}

type Tone = "out" | "low" | "ok";

const TONE_CLASS: Record<Tone, string> = {
	out: "text-red-600 dark:text-red-400",
	low: "text-amber-600 dark:text-amber-400",
	ok: "text-foreground",
};

/**
 * How the API credits balance reads in the footer and the model menu: the `amount` beside the name, the `phrase` a
 * sentence uses, the footer's `tooltip`, and its `tone`. With no grant, the dollars left never read below $0.00.
 */
export function creditView(balance: CreditBalance): { amount: string; phrase: string; tooltip: string; tone: Tone } {
	switch (balance.kind) {
		case "grant": {
			const amount = spendLabel(balance);
			const expires = balance.expiresAt === null ? "" : ` Expires ${DAY_FORMAT.format(balance.expiresAt)}.`;
			const left = balance.limit > 0 ? (balance.limit - balance.used) / balance.limit : 1;
			return {
				amount,
				phrase: `${amount} spent`,
				tooltip: `API credits: ${amount} spent.${expires}`,
				tone: balance.used >= balance.limit ? "out" : left < LOW ? "low" : "ok",
			};
		}
		case "prepaid": {
			const amount = `${dollars(Math.max(0, balance.left))} left`;
			return { amount, phrase: amount, tooltip: `API credits: ${amount}. No monthly grant.`, tone: balance.left <= 0 ? "out" : "ok" };
		}
		default: {
			const never: never = balance;
			return never;
		}
	}
}

/** One footer figure: a muted label, then the value in its tone, with the details on hover or focus. */
function QuotaChip({ label, value, tooltip, tone }: { label: string; value: string; tooltip: string; tone: Tone }) {
	return (
		<Tooltip content={tooltip}>
			<span
				tabIndex={0}
				className={cn("whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring", TONE_CLASS[tone])}
			>
				<span className="text-muted-foreground">{label}</span> {value}
			</span>
		</Tooltip>
	);
}

function WindowLeft({ window }: { window: PlanWindow }) {
	const percent = Math.round(window.remaining * 100);
	const reset = window.resetsAt === null ? "" : ` Resets ${new Date(window.resetsAt).toLocaleString()}.`;
	const spent = window.usd ? ` ${spendLabel(window.usd)} spent.` : "";
	return (
		<QuotaChip
			label={window.label}
			value={`${percent}%`}
			tooltip={`${window.title}: ${window.exhausted ? "used up" : `${percent}% left`}.${spent}${reset}`}
			tone={window.exhausted ? "out" : window.remaining < LOW ? "low" : "ok"}
		/>
	);
}

function ExtraSpent({ extra }: { extra: ExtraUsage }) {
	const low = extra.limit !== null && extra.used / extra.limit > 1 - LOW;
	return (
		<QuotaChip
			label="extra"
			value={spendLabel(extra)}
			tooltip={`${extra.title}: ${spendLabel(extra)} spent${extra.exhausted ? ", used up" : ""}.`}
			tone={extra.exhausted ? "out" : low ? "low" : "ok"}
		/>
	);
}

/** The balance in its tone, turned red once the provider refuses requests for lack of credit. */
function CreditAmount({ name, balance, outOfCreditSince }: { name: string; balance: CreditBalance; outOfCreditSince?: number }) {
	const { amount, tooltip, tone } = creditView(balance);
	if (outOfCreditSince === undefined) return <QuotaChip label={name} value={amount} tooltip={tooltip} tone={tone} />;
	return <QuotaChip label={name} value={amount} tooltip={`${tooltip}${refusedSince(outOfCreditSince)}`} tone="out" />;
}

function refusedSince(since: number): string {
	return ` Requests refused for lack of credit since ${new Date(since).toLocaleString()}.`;
}

function creditsLine({ count, nextExpiresAt }: ResetCredits): string {
	const credits = count === 1 ? "1 reset credit" : `${count} reset credits`;
	return nextExpiresAt === null ? `${credits}.` : `${credits}, ${count === 1 ? "expires" : "next expires"} ${DAY_FORMAT.format(nextExpiresAt)}.`;
}

function PlanRow({ plan }: { plan: PlanUsage }) {
	const name = plan.account ? `${plan.name} · ${plan.account}` : plan.name;
	const label = plan.resetCredits ? `${name}. ${creditsLine(plan.resetCredits)}` : name;
	const nameOnly = isNameOnlyPlan(plan);
	return (
		<li className="flex items-center gap-2 border-border not-first:border-l not-first:pl-2.5">
			<Tooltip content={label}>
				<span role="img" aria-label={label} className="flex shrink-0 items-center">
					<OrgIcon
						org={providerOrg(plan.provider)}
						fallback={nameOnly ? null : <span className="font-medium text-foreground">{plan.name}</span>}
					/>
				</span>
			</Tooltip>
			{nameOnly && !plan.balance && plan.outOfCreditSince === undefined && <span aria-hidden className="whitespace-nowrap text-foreground">{plan.name}</span>}
			{nameOnly && !plan.balance && plan.outOfCreditSince !== undefined && (
				<QuotaChip label={plan.name} value="used up" tooltip={`${plan.name}: used up.${refusedSince(plan.outOfCreditSince)}`} tone="out" />
			)}
			{nameOnly && plan.balance && <CreditAmount name={plan.name} balance={plan.balance} outOfCreditSince={plan.outOfCreditSince} />}
			{plan.extra && <ExtraSpent extra={plan.extra} />}
			{plan.windows.map(window => (
				<WindowLeft key={window.label} window={window} />
			))}
		</li>
	);
}

/** Plan quota, one plan after another, for the status bar; `oneRow` keeps them on one line that scrolls sideways, as on a phone. */
export function PlanUsageList({ usage, oneRow = false }: { usage: DashboardState["usage"]; oneRow?: boolean }) {
	if (usage === null) return <p className="text-muted-foreground">Checking plans…</p>;
	if (usage.error !== null) return <p className="min-w-0 truncate text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	if (usage.plans.length === 0)
		return (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	return (
		<ul aria-label="Plan usage" className={cn("flex min-w-0 items-center gap-x-2.5 gap-y-0.5", oneRow ? "-my-1 overflow-x-auto py-1 scroll-fade-x scrollbar-none *:shrink-0" : "flex-wrap")}>
			{usage.plans.map((plan, index) => (
				<PlanRow key={`${plan.provider}:${plan.account ?? index}`} plan={plan} />
			))}
		</ul>
	);
}
