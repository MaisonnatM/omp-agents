/** How much of each provider plan's usage windows is left, shown in the status bar and the model menu. */
import { createContext } from "react";
import { type CreditBalance, type ExtraUsage, isNameOnlyPlan, type PlanUsage, type PlanWindow, type ResetCredits } from "../../src/shared/models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { DAY_FORMAT, providerOrg } from "../labels";
import { useHoverPopover } from "../use-hover-popover";
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

const BAR_CLASS: Record<Tone, string> = { out: "bg-red-500", low: "bg-amber-500", ok: "bg-foreground/60" };

const FOCUS = "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
			<span tabIndex={0} className={cn("whitespace-nowrap tabular-nums", FOCUS, TONE_CLASS[tone])}>
				<span className="text-muted-foreground">{label}</span> {value}
			</span>
		</Tooltip>
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

/** Time until `at`, in its two largest units: `3h24m`, `1d3h`, `12m`. */
function untilLabel(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((at - now) / 60_000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	if (days > 0) return `${days}d${hours}h`;
	return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`;
}

/** A reset moment with its date, so a weekday two weeks out never reads as today: `Thu 26 Nov, 17:21`. */
const RESET_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const windowTone = (window: PlanWindow): Tone => (window.exhausted ? "out" : window.remaining < LOW ? "low" : "ok");
const leftLabel = (window: PlanWindow): string => (window.exhausted ? "used up" : `${Math.round(window.remaining * 100)}% left`);

function savedResetsLine({ count, nextExpiresAt }: ResetCredits): string {
	const resets = count === 1 ? "1 saved reset" : `${count} saved resets`;
	return nextExpiresAt === null ? `${resets}.` : `${resets}, ${count === 1 ? "expires" : "next expires"} ${DAY_FORMAT.format(nextExpiresAt)}.`;
}

/** The account's short tag, such as `yampa` for `maxence@yampa.ai`, when its provider has another account in `plans`; else `null`. */
function accountTag(plan: PlanUsage, plans: readonly PlanUsage[]): string | null {
	if (!plan.account || plans.filter(other => other.provider === plan.provider).length < 2) return null;
	const domain = plan.account.split("@")[1];
	return domain ? domain.split(".")[0]! : plan.account;
}

/** The share of a window left, as a bar that empties as the window is used. */
function Meter({ window }: { window: PlanWindow }) {
	return (
		<span aria-hidden className="relative col-span-2 block h-1.5 overflow-hidden rounded-full bg-foreground/12">
			<span className={cn("absolute inset-y-0 left-0", BAR_CLASS[windowTone(window)])} style={{ width: `${Math.round(window.remaining * 100)}%` }} />
		</span>
	);
}

/** The card a plan's chip opens: every window with its bar and reset, the spend past the plan, and the saved resets. */
function PlanCard({ plan, now }: { plan: PlanUsage; now: number }) {
	return (
		<>
			<div className="border-b border-border px-3 py-2">
				<p className="flex items-center gap-2 text-sm font-medium">
					<OrgIcon org={providerOrg(plan.provider)} fallback={null} />
					{plan.name}
				</p>
				{plan.account && <p className="text-xs text-muted-foreground">{plan.account}</p>}
			</div>
			<div className="flex flex-col gap-3 px-3 py-2.5">
				{plan.windows.map(window => (
					<div key={window.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
						<span className="truncate">{window.title}</span>
						<span className={cn("tabular-nums", TONE_CLASS[windowTone(window)])}>
							{leftLabel(window)}
							{window.usd && <span className="text-muted-foreground"> · {spendLabel(window.usd)} spent</span>}
						</span>
						<Meter window={window} />
						{window.resetsAt !== null && (
							<span className="col-span-2 tabular-nums text-muted-foreground">
								Resets in {untilLabel(window.resetsAt, now)} · {RESET_FORMAT.format(window.resetsAt)}
							</span>
						)}
					</div>
				))}
				{plan.extra && (
					<div className="flex items-center justify-between gap-3 text-xs">
						<span className="truncate">{plan.extra.title}</span>
						<span className={cn("tabular-nums", plan.extra.exhausted ? TONE_CLASS.out : "text-muted-foreground")}>
							{spendLabel(plan.extra)} spent{plan.extra.exhausted ? ", used up" : ""}
						</span>
					</div>
				)}
			</div>
			{plan.resetCredits?.count ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">✦ {savedResetsLine(plan.resetCredits)}</p> : null}
		</>
	);
}

/**
 * A plan with usage windows: its logo, the account's tag when the provider has two, the tightest window still open, how
 * many windows are used up, and the saved resets; hovering or clicking opens {@link PlanCard}.
 */
function PlanChip({ plan, tag }: { plan: PlanUsage; tag: string | null }) {
	const popover = useHoverPopover();
	const now = Date.now();
	const open = plan.windows.filter(window => !window.exhausted).sort((a, b) => a.remaining - b.remaining)[0];
	const usedUp = plan.windows.filter(window => window.exhausted);
	const backAt = usedUp.reduce<number | null>((latest, window) => (window.resetsAt === null ? latest : Math.max(latest ?? 0, window.resetsAt)), null);
	const saved = plan.resetCredits?.count ?? 0;
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<button {...popover.trigger} type="button" className={cn("-mx-1 flex items-center gap-1.5 whitespace-nowrap px-1 tabular-nums hover:bg-muted", FOCUS)}>
					<span aria-hidden className="flex shrink-0 items-center">
						<OrgIcon org={providerOrg(plan.provider)} fallback={<span className="font-medium text-foreground">{plan.name}</span>} />
					</span>
					<span className="sr-only">{plan.account ? `${plan.name} ${plan.account}:` : `${plan.name}:`}</span>
					{tag && <span aria-hidden className="text-muted-foreground">{tag}</span>}
					{open && (
						<span className={TONE_CLASS[windowTone(open)]}>
							<span className="text-muted-foreground">{open.label}</span> {Math.round(open.remaining * 100)}% left
						</span>
					)}
					{!open && usedUp.length > 0 && <span className={TONE_CLASS.out}>used up{backAt !== null && ` · back in ${untilLabel(backAt, now)}`}</span>}
					{open && usedUp.length > 0 && <span className={TONE_CLASS.out}>· {usedUp.length} used up</span>}
					{plan.windows.length === 0 && plan.extra && (
						<span className={plan.extra.exhausted ? TONE_CLASS.out : "text-foreground"}>
							<span className="text-muted-foreground">extra</span> {spendLabel(plan.extra)}
						</span>
					)}
					{saved > 0 && (
						<span className="text-muted-foreground">
							{plan.windows.length > 0 || plan.extra ? "· " : ""}✦ {saved}
							<span className="sr-only"> saved {saved === 1 ? "reset" : "resets"}</span>
						</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent {...popover.content} side="top" align="start" onOpenAutoFocus={event => event.preventDefault()} aria-label={`${plan.name} usage`} className="w-96 p-0">
				<PlanCard plan={plan} now={now} />
			</PopoverContent>
		</Popover>
	);
}

/** A plan with no usage windows, such as API credits: its name, then its balance or `used up` once the provider refuses requests. */
function NamedPlan({ plan }: { plan: PlanUsage }) {
	if (plan.balance) return <CreditAmount name={plan.name} balance={plan.balance} outOfCreditSince={plan.outOfCreditSince} />;
	if (plan.outOfCreditSince !== undefined) {
		return <QuotaChip label={plan.name} value="used up" tooltip={`${plan.name}: used up.${refusedSince(plan.outOfCreditSince)}`} tone="out" />;
	}
	return <span className="whitespace-nowrap text-foreground">{plan.name}</span>;
}

function PlanRow({ plan, tag }: { plan: PlanUsage; tag: string | null }) {
	const nameOnly = isNameOnlyPlan(plan) && !plan.resetCredits?.count;
	return (
		<li className="flex items-center gap-2 border-border not-first:border-l not-first:pl-2.5">
			{nameOnly ? (
				<>
					<OrgIcon org={providerOrg(plan.provider)} fallback={null} />
					<NamedPlan plan={plan} />
				</>
			) : (
				<PlanChip plan={plan} tag={tag} />
			)}
		</li>
	);
}

/** Plan quota, one chip per account, for the status bar; on a phone, on one line that scrolls sideways. */
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
		<ul aria-label="Plan usage" className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 max-phone:-my-1 max-phone:flex-nowrap max-phone:overflow-x-auto max-phone:py-1 max-phone:scroll-fade-x max-phone:[scrollbar-width:none] max-phone:*:shrink-0">
			{usage.plans.map((plan, index) => (
				<PlanRow key={`${plan.provider}:${plan.account ?? index}`} plan={plan} tag={accountTag(plan, usage.plans)} />
			))}
		</ul>
	);
}
