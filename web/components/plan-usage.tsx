/** How much of each provider plan's usage windows is left, shown at the sidebar's foot and in the model menu. */
import { createContext } from "react";
import { type CreditBalance, type ExtraUsage, isNameOnlyPlan, type PlanUsage, type PlanWindow, type ResetCredits } from "../../src/shared/models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { DAY_FORMAT, providerOrg } from "../labels";
import { useHoverPopover } from "../use-hover-popover";
import { useMinute } from "../use-minute";
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

const TONE_CLASS: Record<Tone, { text: string; bar: string }> = {
	out: { text: "text-red-600 dark:text-red-400", bar: "bg-red-500" },
	low: { text: "text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
	ok: { text: "text-foreground", bar: "bg-foreground/60" },
};

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
			<span tabIndex={0} className={cn("whitespace-nowrap tabular-nums", FOCUS, TONE_CLASS[tone].text)}>
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

/** A plan shows as a {@link PlanChip} when it has windows or spend; else by name. */
const hasChip = (plan: PlanUsage): boolean => !isNameOnlyPlan(plan);

/** Time until `at`, in its two largest units: `3h24m`, `1d3h`, `12m`. */
export function untilLabel(at: number, now: number): string {
	const minutes = Math.max(0, Math.round((at - now) / 60_000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	if (days > 0) return `${days}d${hours}h`;
	return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`;
}

/** A reset moment with its date, so a weekday two weeks out never reads as today: `Thu 26 Nov, 17:21`. */
const RESET_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const percentLeft = (window: PlanWindow): number => Math.round(window.remaining * 100);
const windowTone = (window: PlanWindow): Tone => (window.exhausted ? "out" : window.remaining < LOW ? "low" : "ok");
const extraTone = (extra: ExtraUsage): Tone => (extra.exhausted ? "out" : extra.limit !== null && extra.used / extra.limit > 1 - LOW ? "low" : "ok");
const leftLabel = (window: PlanWindow): string => (window.exhausted ? "used up" : `${percentLeft(window)}% left`);

export function creditsLine({ count, nextExpiresAt }: ResetCredits): string {
	const credits = count === 1 ? "1 reset credit" : `${count} reset credits`;
	return nextExpiresAt === null ? `${credits}.` : `${credits}, ${count === 1 ? "expires" : "next expires"} ${DAY_FORMAT.format(nextExpiresAt)}.`;
}

/**
 * A short tag per account of a provider with more than one: the email domain's first label, such as `yampa` for
 * `maxence@yampa.ai`, or the local part when another account of that provider shares the domain.
 */
export function accountTags(plans: readonly PlanUsage[]): Map<PlanUsage, string> {
	const tags = new Map<PlanUsage, string>();
	for (const plan of plans) {
		if (!plan.account) continue;
		const siblings = plans.filter(other => other.provider === plan.provider && other.account);
		if (siblings.length < 2) continue;
		const [local, domain = ""] = plan.account.split("@");
		const label = domain.split(".")[0];
		const shared = siblings.some(other => other !== plan && other.account!.split("@")[1]?.split(".")[0] === label);
		tags.set(plan, label && !shared ? label : (local ?? plan.account));
	}
	return tags;
}

/** One figure on a plan's chip: an optional muted label, then the text in its tone. */
export interface ChipPart {
	label?: string;
	text: string;
	tone: Tone;
}

/**
 * What a plan's chip says, in order: its tightest open window, or `used up`; how many other windows are used up; the
 * spend past the plan when it has no windows. Resets and reset credits show only in {@link PlanCard}.
 */
export function chipParts(plan: PlanUsage): ChipPart[] {
	const parts: ChipPart[] = [];
	let open: PlanWindow | undefined;
	let usedUp = 0;
	for (const window of plan.windows) {
		if (!window.exhausted) {
			if (!open || window.remaining < open.remaining) open = window;
		} else usedUp++;
	}
	if (open) parts.push({ label: open.label, text: `${percentLeft(open)}%`, tone: windowTone(open) });
	if (usedUp > 0) parts.push({ text: open ? `${usedUp} used up` : "used up", tone: "out" });
	if (plan.windows.length === 0 && plan.extra) parts.push({ label: "extra", text: spendLabel(plan.extra), tone: extraTone(plan.extra) });
	return parts;
}

/** The share of a window left, as a bar that empties as the window is used. */
function Meter({ window }: { window: PlanWindow }) {
	return (
		<span aria-hidden className="relative col-span-2 block h-1.5 overflow-hidden rounded-full bg-foreground/12">
			<span className={cn("absolute inset-y-0 left-0", TONE_CLASS[windowTone(window)].bar)} style={{ width: `${percentLeft(window)}%` }} />
		</span>
	);
}

/** The card a plan's chip opens: every window with its bar and reset, the spend past the plan, and the reset credits. */
export function PlanCard({ plan, now }: { plan: PlanUsage; now: number }) {
	return (
		<>
			<div className="border-b border-border px-3 py-2">
				<p className="flex items-center gap-2 text-sm font-medium">
					<OrgIcon org={providerOrg(plan.provider)} fallback={null} />
					{plan.name}
				</p>
				{plan.account && <p className="text-xs text-muted-foreground">{plan.account}</p>}
			</div>
			{(plan.windows.length > 0 || plan.extra) && (
				<div className="flex flex-col gap-3 px-3 py-2.5">
					{plan.windows.map(window => (
						<div key={window.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
							<span className="truncate">{window.title}</span>
							<span className={cn("tabular-nums", TONE_CLASS[windowTone(window)].text)}>
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
							<span className={cn("tabular-nums", TONE_CLASS[extraTone(plan.extra)].text)}>
								{spendLabel(plan.extra)} spent{plan.extra.exhausted ? ", used up" : ""}
							</span>
						</div>
					)}
				</div>
			)}
			{plan.resetCredits && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">✦ {creditsLine(plan.resetCredits)}</p>}
		</>
	);
}

/** A plan with usage windows or spend: its account tag and {@link chipParts}; hovering or clicking opens {@link PlanCard}. */
function PlanChip({ plan, tag }: { plan: PlanUsage; tag: string | undefined }) {
	const popover = useHoverPopover();
	const now = useMinute();
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<button {...popover.trigger} type="button" className={cn("-mx-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-sm px-1 tabular-nums hover:bg-hover", FOCUS)}>
					<span className="sr-only">{plan.account ? `${plan.name} ${plan.account}:` : `${plan.name}:`}</span>
					{tag && <span aria-hidden className="text-muted-foreground">{tag}</span>}
					{chipParts(plan).map((part, index) => (
						<span key={part.text} className={TONE_CLASS[part.tone].text}>
							{index > 0 && <span className="text-muted-foreground">· </span>}
							{part.label && <span className="text-muted-foreground">{part.label} </span>}
							{part.text}
						</span>
					))}
				</button>
			</PopoverTrigger>
			<PopoverContent {...popover.content} side="top" align="start" aria-label={`${plan.name} usage`} className="w-96 max-w-[calc(100vw-2rem)] p-0">
				<PlanCard plan={plan} now={now} />
			</PopoverContent>
		</Popover>
	);
}

/** A plan without a chip, such as API credits: its name and account tag, then its balance or `used up` once the provider refuses requests. */
function NamedPlan({ plan, tag }: { plan: PlanUsage; tag: string | undefined }) {
	const name = tag ? `${plan.name} ${tag}` : plan.name;
	if (plan.balance) return <CreditAmount name={name} balance={plan.balance} outOfCreditSince={plan.outOfCreditSince} />;
	if (plan.outOfCreditSince !== undefined) {
		return <QuotaChip label={name} value="used up" tooltip={`${name}: used up.${refusedSince(plan.outOfCreditSince)}`} tone="out" />;
	}
	return <span className="whitespace-nowrap text-foreground">{name}</span>;
}

/** Plan quota for the sidebar's foot: one row per provider, its logo once, then each of its accounts. */
export function PlanUsageList({ usage }: { usage: DashboardState["usage"] }) {
	if (usage === null) return <p className="text-muted-foreground">Checking plans…</p>;
	if (usage.error !== null) return <p className="min-w-0 truncate text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	if (usage.plans.length === 0)
		return (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	const tags = accountTags(usage.plans);
	const makers = Map.groupBy(usage.plans, plan => providerOrg(plan.provider) ?? plan.provider);
	return (
		<ul aria-label="Plan usage" className="flex min-w-0 flex-col items-start gap-1">
			{[...makers].map(([maker, plans]) => (
				<li key={maker} className="flex max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
					<span aria-hidden className="flex shrink-0 items-center">
						<OrgIcon org={providerOrg(plans[0]!.provider)} fallback={<span className="font-medium text-foreground">{plans[0]!.name}</span>} />
					</span>
					{plans.map((plan, index) => (
						<span key={`${plan.provider}:${plan.account ?? index}`} className={cn("flex min-w-0 items-center", index > 0 && "border-l border-border pl-2")}>
							{hasChip(plan) ? <PlanChip plan={plan} tag={tags.get(plan)} /> : <NamedPlan plan={plan} tag={tags.get(plan)} />}
						</span>
					))}
				</li>
			))}
		</ul>
	);
}
