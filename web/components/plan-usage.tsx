import type { ReactNode } from "react";
import type { PlanUsage, PlanWindow } from "../../src/shared";
import { SidebarFooter } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../use-dashboard";

/** Below this fraction left, a window reads as running low. */
const LOW = 0.2;

function WindowLeft({ window }: { window: PlanWindow }) {
	const percent = Math.round(window.remaining * 100);
	const reset = window.resetsAt === null ? "" : ` Resets ${new Date(window.resetsAt).toLocaleString()}.`;
	return (
		<Tooltip content={`${window.title}: ${percent}% left.${reset}`}>
			<span
				tabIndex={0}
				className={cn(
					"whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
					window.remaining <= 0
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

function PlanRow({ plan, showAccount }: { plan: PlanUsage; showAccount: boolean }) {
	return (
		<li className="flex flex-col gap-0.5">
			<span className="flex min-w-0 items-baseline gap-1.5" title={plan.account ?? undefined}>
				<span className="shrink-0 font-medium text-foreground">{plan.name}</span>
				{showAccount && plan.account && <span className="truncate text-muted-foreground">{plan.account}</span>}
			</span>
			<span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
				{plan.windows.map(window => (
					<WindowLeft key={window.label} window={window} />
				))}
			</span>
		</li>
	);
}

/** Quota left on every plan `omp usage` reports, pinned to the bottom of the sidebar. */
export function PlanUsageFooter({ usage }: { usage: DashboardState["usage"] }) {
	let body: ReactNode;
	if (usage === null) body = <p className="text-muted-foreground">Checking plans…</p>;
	else if (usage.error !== null)
		body = <p className="text-red-600 dark:text-red-400">Cannot read plan usage: {usage.error}</p>;
	else if (usage.plans.length === 0)
		body = (
			<p className="text-muted-foreground">
				<code>omp usage</code> reports no plan limits.
			</p>
		);
	else
		body = (
			<ul className="flex flex-col gap-2">
				{usage.plans.map((plan, index) => (
					<PlanRow
						key={`${plan.provider}:${plan.account ?? index}`}
						plan={plan}
						showAccount={usage.plans.some(other => other !== plan && other.provider === plan.provider)}
					/>
				))}
			</ul>
		);
	return (
		<SidebarFooter className="gap-1.5 border-t border-border px-4 py-3 text-xs">
			<h2 className="font-medium text-muted-foreground">Plan quota left</h2>
			{body}
		</SidebarFooter>
	);
}
