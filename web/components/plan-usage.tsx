/** How much of each provider plan's usage windows is left, shown in the status bar and the model menu. */
import { createContext } from "react";
import type { PlanUsage, PlanWindow, ResetCredits } from "../../src/shared/models";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { DAY_FORMAT, providerOrg } from "../labels";
import { OrgIcon } from "./org-icon";

/** Below this fraction left, a window reads as running low. */
const LOW = 0.2;

export const NO_PLANS: readonly PlanUsage[] = [];
/** The plans of the last `omp usage` run, for the model menu's quota line per provider. */
export const Plans = createContext<readonly PlanUsage[]>(NO_PLANS);

function WindowLeft({ window }: { window: PlanWindow }) {
	const percent = Math.round(window.remaining * 100);
	const reset = window.resetsAt === null ? "" : ` Resets ${new Date(window.resetsAt).toLocaleString()}.`;
	return (
		<Tooltip content={`${window.title}: ${window.exhausted ? "used up" : `${percent}% left`}.${reset}`}>
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

function creditsLine({ count, nextExpiresAt }: ResetCredits): string {
	const credits = count === 1 ? "1 reset credit" : `${count} reset credits`;
	return nextExpiresAt === null ? `${credits}.` : `${credits}, ${count === 1 ? "expires" : "next expires"} ${DAY_FORMAT.format(nextExpiresAt)}.`;
}

function PlanRow({ plan }: { plan: PlanUsage }) {
	const name = plan.account ? `${plan.name} · ${plan.account}` : plan.name;
	const label = plan.resetCredits ? `${name}. ${creditsLine(plan.resetCredits)}` : name;
	return (
		<li className="flex items-center gap-2 border-border not-first:border-l not-first:pl-2.5">
			<Tooltip content={label}>
				<span role="img" aria-label={label} className="flex shrink-0 items-center">
					<OrgIcon
						org={providerOrg(plan.provider)}
						fallback={<span className="font-medium text-foreground">{plan.name}</span>}
					/>
				</span>
			</Tooltip>
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
