/** How much of each provider plan's usage windows is left, shown at the sidebar's foot and in the model menu. */
import { createContext, type ReactNode } from "react";
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

export type Tone = "out" | "low" | "ok";

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

function refusedSince(since: number): string {
	return ` Requests refused for lack of credit since ${new Date(since).toLocaleString()}.`;
}

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

/** The account's full email, for each account of a provider with more than one. */
export function accountTags(plans: readonly PlanUsage[]): Map<PlanUsage, string> {
	const tags = new Map<PlanUsage, string>();
	for (const plan of plans) {
		if (plan.account && plans.some(other => other !== plan && other.provider === plan.provider && other.account)) tags.set(plan, plan.account);
	}
	return tags;
}

/** A plan's tile: the share left of its tightest window, its spend, or its credit balance, as a ring and a figure. */
export interface PlanGauge {
	/** Fraction the ring fills, 0 to 1; `null` when nothing measures it. */
	left: number | null;
	/** The figure under the ring; `null` for a plan known by name only. */
	value: string | null;
	tone: Tone;
	/** What tells the tile apart: the account tag, else the window, else the plan's name. */
	caption: string;
}

export function planGauge(plan: PlanUsage, tag: string | undefined): PlanGauge {
	const open = plan.windows.filter(window => !window.exhausted).sort((a, b) => a.remaining - b.remaining)[0];
	if (open) return { left: open.remaining, value: `${percentLeft(open)}%`, tone: windowTone(open), caption: tag ?? open.label };
	if (plan.windows.length > 0) return { left: 0, value: "used up", tone: "out", caption: tag ?? plan.name };
	if (plan.extra) {
		const left = plan.extra.limit === null ? null : Math.max(0, 1 - plan.extra.used / plan.extra.limit);
		return { left, value: spendLabel(plan.extra), tone: extraTone(plan.extra), caption: tag ?? "extra" };
	}
	const caption = tag ? `${plan.name} ${tag}` : plan.name;
	if (plan.balance) {
		const { amount, tone } = creditView(plan.balance);
		const left = plan.balance.kind === "grant" && plan.balance.limit > 0 ? Math.max(0, 1 - plan.balance.used / plan.balance.limit) : null;
		return { left, value: amount, tone: plan.outOfCreditSince === undefined ? tone : "out", caption };
	}
	if (plan.outOfCreditSince !== undefined) return { left: 0, value: "used up", tone: "out", caption };
	return { left: null, value: null, tone: "ok", caption };
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

const RING_STROKE: Record<Tone, string> = { out: "stroke-red-500", low: "stroke-amber-500", ok: "stroke-foreground/60" };
const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** One tile of the sidebar foot's grids: a ring, its figure, and its caption, stacked. */
export const TILE = "flex min-w-0 flex-col items-center gap-0.5 rounded-md px-0.5 py-1 tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring";

/** An icon inside a ring filled to `fill`, 0 to 1, or left empty for `null`. */
export function GaugeRing({ fill, tone, children }: { fill: number | null; tone: Tone; children: ReactNode }) {
	return (
		<span aria-hidden className="relative grid size-8 place-items-center">
			<svg viewBox="0 0 32 32" className="absolute inset-0 -rotate-90">
				<circle cx="16" cy="16" r={RING_RADIUS} fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
				{fill !== null && (
					<circle cx="16" cy="16" r={RING_RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round" className={RING_STROKE[tone]} strokeDasharray={`${Math.max(0.02, fill) * RING_LENGTH} ${RING_LENGTH}`} />
				)}
			</svg>
			{children}
		</span>
	);
}

/** A tile's figure in its tone, then its muted caption, whole on hover. */
export function GaugeText({ value, caption, tone }: { value: string | null; caption: string; tone: Tone }) {
	return (
		<>
			<span className={cn("max-w-full truncate font-medium", TONE_CLASS[tone].text)}>{value ?? "—"}</span>
			<span title={caption} className="max-w-full truncate text-[10px] text-muted-foreground">{caption}</span>
		</>
	);
}

/** A provider's logo inside a ring that empties as the plan is used. */
function Ring({ plan, gauge }: { plan: PlanUsage; gauge: PlanGauge }) {
	return (
		<GaugeRing fill={gauge.left} tone={gauge.tone}>
			<OrgIcon org={providerOrg(plan.provider)} className="size-3.5" fallback={<span className="text-[10px] font-medium">{plan.name.slice(0, 2)}</span>} />
		</GaugeRing>
	);
}

function TileText({ gauge }: { gauge: PlanGauge }) {
	return <GaugeText value={gauge.value} caption={gauge.caption} tone={gauge.tone} />;
}

/** A plan with windows or spend; hovering or clicking opens {@link PlanCard} with its resets and credits. */
function PlanTile({ plan, gauge }: { plan: PlanUsage; gauge: PlanGauge }) {
	const popover = useHoverPopover();
	const now = useMinute();
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<button {...popover.trigger} type="button" aria-label={`${plan.name} ${plan.account ?? ""} ${gauge.caption} ${gauge.value ?? ""}`} className={TILE}>
					<Ring plan={plan} gauge={gauge} />
					<TileText gauge={gauge} />
				</button>
			</PopoverTrigger>
			<PopoverContent {...popover.content} side="top" align="start" aria-label={`${plan.name} usage`} className="w-96 max-w-[calc(100vw-2rem)] p-0">
				<PlanCard plan={plan} now={now} />
			</PopoverContent>
		</Popover>
	);
}

/** A plan known by name, such as API credits: its balance, or `used up` once the provider refuses requests, explained on hover. */
function NamedTile({ plan, gauge }: { plan: PlanUsage; gauge: PlanGauge }) {
	const balance = plan.balance ? creditView(plan.balance).tooltip : `${gauge.caption}${gauge.value ? `: ${gauge.value}.` : "."}`;
	const tooltip = plan.outOfCreditSince === undefined ? balance : `${balance}${refusedSince(plan.outOfCreditSince)}`;
	return (
		<Tooltip content={tooltip}>
			<span tabIndex={0} aria-label={tooltip} className={TILE}>
				<Ring plan={plan} gauge={gauge} />
				<TileText gauge={gauge} />
			</span>
		</Tooltip>
	);
}

/** The note that stands in for the plan tiles while they are read, failed, or absent; `null` once there are tiles. */
function planNote(usage: DashboardState["usage"]): ReactNode {
	if (usage === null) return <p className="text-muted-foreground">Checking plans…</p>;
	if (usage.error !== null) return <p className="min-w-0 truncate text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	if (usage.plans.length === 0)
		return (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	return null;
}

/** The sidebar foot's grid of ring tiles: one per plan account, in `omp usage` order, then `after`, such as the machine's load. */
export function PlanUsageList({ usage, after }: { usage: DashboardState["usage"]; after?: ReactNode }) {
	const tags = usage ? accountTags(usage.plans) : new Map<PlanUsage, string>();
	return (
		<>
			{planNote(usage)}
			<ul aria-label="Plan usage and machine load" className="grid grid-cols-4 gap-1">
				{usage?.error === null &&
					usage.plans.map((plan, index) => {
						const gauge = planGauge(plan, tags.get(plan));
						return (
							<li key={`${plan.provider}:${plan.account ?? index}`} className="flex min-w-0 flex-col">
								{isNameOnlyPlan(plan) ? <NamedTile plan={plan} gauge={gauge} /> : <PlanTile plan={plan} gauge={gauge} />}
							</li>
						);
					})}
				{after && <li className="contents">{after}</li>}
			</ul>
		</>
	);
}
