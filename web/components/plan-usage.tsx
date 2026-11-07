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

/** The API credits amount: dollars spent of the grant, or with no grant, the prepaid dollars left. */
export const creditLabel = (balance: CreditBalance): string => (balance.kind === "grant" ? spendLabel(balance) : `${dollars(balance.left)} left`);

/** What the API credits row's hover says, and how its amount is colored. */
function creditState(balance: CreditBalance): { tooltip: string; tone: "out" | "low" | "ok" } {
	if (balance.kind === "prepaid") return { tooltip: `API credits: ${creditLabel(balance)}. No promotional grant.`, tone: balance.left <= 0 ? "out" : "ok" };
	const expires = balance.expiresAt === null ? "" : ` Expires ${DAY_FORMAT.format(balance.expiresAt)}.`;
	const left = balance.limit > 0 ? (balance.limit - balance.used) / balance.limit : 1;
	return { tooltip: `API credits: ${creditLabel(balance)} spent.${expires}`, tone: balance.used >= balance.limit ? "out" : left < LOW ? "low" : "ok" };
}

function WindowLeft({ window }: { window: PlanWindow }) {
	const percent = Math.round(window.remaining * 100);
	const reset = window.resetsAt === null ? "" : ` Resets ${new Date(window.resetsAt).toLocaleString()}.`;
	const spent = window.usd ? ` ${spendLabel(window.usd)} spent.` : "";
	return (
		<Tooltip content={`${window.title}: ${window.exhausted ? "used up" : `${percent}% left`}.${spent}${reset}`}>
			<span
				tabIndex={0}
				className={cn(
					"whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					window.exhausted
						? "text-red-600 dark:text-red-400"
						: window.remaining < LOW
							? "text-amber-600 dark:text-amber-400"
							: "text-foreground",
				)}
			>
				<span className="text-muted-foreground">{window.label}</span> {percent}%
			</span>
		</Tooltip>
	);
}

function ExtraSpent({ extra }: { extra: ExtraUsage }) {
	const low = extra.limit !== null && extra.used / extra.limit > 1 - LOW;
	return (
		<Tooltip content={`${extra.title}: ${spendLabel(extra)} spent${extra.exhausted ? ", used up" : ""}.`}>
			<span
				tabIndex={0}
				className={cn(
					"whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					extra.exhausted ? "text-red-600 dark:text-red-400" : low ? "text-amber-600 dark:text-amber-400" : "text-foreground",
				)}
			>
				<span className="text-muted-foreground">extra</span> {spendLabel(extra)}
			</span>
		</Tooltip>
	);
}

function CreditAmount({ name, balance }: { name: string; balance: CreditBalance }) {
	const { tooltip, tone } = creditState(balance);
	return (
		<Tooltip content={tooltip}>
			<span
				tabIndex={0}
				className={cn(
					"whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					tone === "out" ? "text-red-600 dark:text-red-400" : tone === "low" ? "text-amber-600 dark:text-amber-400" : "text-foreground",
				)}
			>
				<span className="text-muted-foreground">{name}</span> {creditLabel(balance)}
			</span>
		</Tooltip>
	);
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
			{nameOnly && !plan.balance && <span aria-hidden className="whitespace-nowrap text-foreground">{plan.name}</span>}
			{nameOnly && plan.balance && <CreditAmount name={plan.name} balance={plan.balance} />}
			{plan.extra && <ExtraSpent extra={plan.extra} />}
			{plan.windows.map(window => (
				<WindowLeft key={window.label} window={window} />
			))}
		</li>
	);
}

/** Plan quota, one plan after another, for the status bar. */
export function PlanUsageList({ usage }: { usage: DashboardState["usage"] }) {
	if (usage === null) return <p className="text-muted-foreground">Checking plans…</p>;
	if (usage.error !== null) return <p className="min-w-0 truncate text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	if (usage.plans.length === 0)
		return (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	return (
		<ul aria-label="Plan usage" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5">
			{usage.plans.map((plan, index) => (
				<PlanRow key={`${plan.provider}:${plan.account ?? index}`} plan={plan} />
			))}
		</ul>
	);
}
