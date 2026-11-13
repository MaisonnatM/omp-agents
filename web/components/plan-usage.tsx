/** How much of each provider plan's usage windows is left, shown at the sidebar's foot and in the model menu. */
import { createContext } from "react";
import type { CreditBalance, ExtraUsage, PlanUsage, PlanWindow, ResetCredits } from "../../src/shared/models";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { DAY_FORMAT, providerOrg } from "../labels";
import { useHoverPopover } from "../use-hover-popover";
import { useMinute } from "../use-minute";
import { GaugeCell, GaugeTile, TONE_CLASS, type Tone } from "./gauge-tile";
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

/** The share of `limit` that `used` leaves, 0 to 1; `null` with no cap, or a cap of nothing, to measure it against. */
const shareLeft = (used: number, limit: number | null): number | null => (limit === null || limit <= 0 ? null : Math.max(0, 1 - used / limit));

/**
 * How the API credits balance reads on its tile at the sidebar's foot and in the model menu: the `amount` beside the name,
 * the `phrase` a sentence uses, the tile's `tooltip`, and its `tone`. With no grant, the dollars left never read below $0.00.
 */
export function creditView(balance: CreditBalance): { amount: string; phrase: string; tooltip: string; tone: Tone } {
	switch (balance.kind) {
		case "grant": {
			const amount = spendLabel(balance);
			const expires = balance.expiresAt === null ? "" : ` Expires ${DAY_FORMAT.format(balance.expiresAt)}.`;
			const left = shareLeft(balance.used, balance.limit) ?? 1;
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
const extraTone = (extra: ExtraUsage): Tone => (extra.exhausted ? "out" : (shareLeft(extra.used, extra.limit) ?? 1) < LOW ? "low" : "ok");
const leftLabel = (window: PlanWindow): string => (window.exhausted ? "used up" : `${percentLeft(window)}% left`);

const resetCreditCount = (count: number): string => (count === 1 ? "1 reset credit" : `${count} reset credits`);

export function creditsLine({ count, nextExpiresAt }: ResetCredits): string {
	const credits = resetCreditCount(count);
	return nextExpiresAt === null ? `${credits}.` : `${credits}, ${count === 1 ? "expires" : "next expires"} ${DAY_FORMAT.format(nextExpiresAt)}.`;
}

/** The account's full email, for each account of a provider with more than one. */
export function accountTags(plans: readonly PlanUsage[]): Map<PlanUsage, string> {
	const accounts = new Map<string, number>();
	for (const plan of plans) if (plan.account) accounts.set(plan.provider, (accounts.get(plan.provider) ?? 0) + 1);
	const tags = new Map<PlanUsage, string>();
	for (const plan of plans) if (plan.account && accounts.get(plan.provider)! > 1) tags.set(plan, plan.account);
	return tags;
}

/** What a plan's tile opens: {@link PlanCard}, or a tooltip for a plan known by name, with its balance or why it is used up. */
export type PlanDetail = { kind: "card" } | { kind: "tooltip"; text: string };

/** A plan's tile: the share left of its tightest window, its spend, its reset credits, or its credit balance, as a ring and a figure. */
export interface PlanGauge {
	/** Fraction the ring fills, 0 to 1; `null` when nothing measures it. */
	left: number | null;
	/** The figure under the ring; `null` for a plan known by name only. */
	value: string | null;
	/** The figure's and the ring's tone; red when any window is used up. */
	tone: Tone;
	/** What tells the tile apart: the account tag, else the window, else the plan's name. */
	caption: string;
	/** What a screen reader says for the tile, such as `Anthropic, max@gmail.com, 90% left`. */
	label: string;
	detail: PlanDetail;
}

export function planGauge(plan: PlanUsage, tag: string | undefined): PlanGauge {
	/** A card's tile: named by the plan, its account, and its caption when that says more, then by what the tile reads. */
	const card = (face: Omit<PlanGauge, "label" | "detail">, ...says: (string | null)[]): PlanGauge => {
		const caption = face.caption === plan.name || face.caption === plan.account ? null : face.caption;
		return { ...face, label: [plan.name, plan.account, caption, ...says].filter(Boolean).join(", "), detail: { kind: "card" } };
	};
	const open = plan.windows.filter(window => !window.exhausted).sort((a, b) => a.remaining - b.remaining)[0];
	const usedUp = plan.windows.filter(window => window.exhausted).length;
	if (open) {
		const percent = percentLeft(open);
		return card({ left: open.remaining, value: `${percent}%`, tone: usedUp > 0 ? "out" : windowTone(open), caption: tag ?? open.label }, `${percent}% left`, usedUp > 0 ? `${usedUp} used up` : null);
	}
	if (usedUp > 0) return card({ left: 0, value: "used up", tone: "out", caption: tag ?? plan.name }, "used up");
	if (plan.extra) {
		const spend = spendLabel(plan.extra);
		return card({ left: shareLeft(plan.extra.used, plan.extra.limit), value: spend, tone: extraTone(plan.extra), caption: tag ?? "extra" }, `${spend} spent`, plan.extra.exhausted ? "used up" : null);
	}
	if (plan.resetCredits && !plan.balance && plan.outOfCreditSince === undefined) {
		const { count } = plan.resetCredits;
		return card({ left: null, value: `✦ ${count}`, tone: "ok", caption: tag ?? plan.name }, resetCreditCount(count));
	}
	const caption = tag ? `${plan.name} ${tag}` : plan.name;
	const refused = plan.outOfCreditSince === undefined ? "" : refusedSince(plan.outOfCreditSince);
	const named = (face: Omit<PlanGauge, "caption" | "label" | "detail">, text: string): PlanGauge => ({ ...face, caption, label: text, detail: { kind: "tooltip", text } });
	if (plan.balance) {
		const { amount, tone, tooltip } = creditView(plan.balance);
		const left = plan.balance.kind === "grant" ? shareLeft(plan.balance.used, plan.balance.limit) : null;
		return named({ left, value: amount, tone: refused ? "out" : tone }, `${tooltip}${refused}`);
	}
	if (refused) return named({ left: 0, value: "used up", tone: "out" }, `${caption}: used up.${refused}`);
	return named({ left: null, value: null, tone: "ok" }, `${caption}: omp usage reports no balance.`);
}

/** The share of a window left, as a bar that empties as the window is used. */
function Meter({ window }: { window: PlanWindow }) {
	return (
		<span aria-hidden className="relative col-span-2 block h-1.5 overflow-hidden rounded-full bg-foreground/12">
			<span className={cn("absolute inset-y-0 left-0", TONE_CLASS[windowTone(window)].bar)} style={{ width: `${percentLeft(window)}%` }} />
		</span>
	);
}

/** The card a plan's tile opens: every window with its bar and reset, the spend past the plan, and the reset credits. */
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

/** A plan's tile: its logo in a ring; hovering or clicking opens {@link PlanCard}, or for a plan known by name, a tooltip. */
function PlanTile({ plan, gauge }: { plan: PlanUsage; gauge: PlanGauge }) {
	const popover = useHoverPopover();
	const now = useMinute();
	const tile = {
		label: gauge.label,
		fill: gauge.left,
		tone: gauge.tone,
		icon: <OrgIcon org={providerOrg(plan.provider)} className="size-3.5" fallback={<span className="text-3xs font-medium">{plan.name.slice(0, 2)}</span>} />,
		value: gauge.value,
		caption: gauge.caption,
	};
	switch (gauge.detail.kind) {
		case "card":
			return (
				<Popover {...popover.root}>
					<PopoverTrigger asChild>
						<GaugeTile {...popover.trigger} as="button" {...tile} />
					</PopoverTrigger>
					<PopoverContent {...popover.content} side="right" align="end" aria-label={`${plan.name} usage`} className="w-96 max-w-[calc(100vw-2rem)] p-0">
						<PlanCard plan={plan} now={now} />
					</PopoverContent>
				</Popover>
			);
		case "tooltip":
			return (
				<Tooltip content={gauge.detail.text}>
					<GaugeTile as="img" {...tile} />
				</Tooltip>
			);
		default: {
			const never: never = gauge.detail;
			return never;
		}
	}
}

/** The note that stands in for the plan tiles while they are read, failed, or absent; nothing once there are tiles. */
export function PlanNote({ usage }: { usage: DashboardState["usage"] }) {
	if (usage === null) return <p className="text-muted-foreground">Checking plans…</p>;
	if (usage.error !== null) return <p title={usage.error} className="line-clamp-3 min-w-0 break-words text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	if (usage.plans.length === 0)
		return (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	return null;
}

/** One cell of the sidebar foot's grid per plan account, in `omp usage` order. */
export function PlanTiles({ plans }: { plans: readonly PlanUsage[] }) {
	const tags = accountTags(plans);
	return plans.map((plan, index) => (
		<GaugeCell key={`${plan.provider}:${plan.account ?? index}`}>
			<PlanTile plan={plan} gauge={planGauge(plan, tags.get(plan))} />
		</GaugeCell>
	));
}
