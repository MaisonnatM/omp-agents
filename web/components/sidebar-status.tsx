import type { DashboardState } from "../dashboard-state";
import { NO_PLANS, PlanNote, PlanTiles } from "./plan-usage";

/** The sidebar's foot: the note on plan usage, then one bar row per plan account. */
export function SidebarFoot({ usage }: { usage: DashboardState["usage"] }) {
	const plans = usage?.error === null ? usage.plans : NO_PLANS;
	return (
		<footer data-sidebar="footer" className="mx-2 flex shrink-0 flex-col gap-2 border-t border-border pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-xs">
			<PlanNote usage={usage} />
			{plans.length > 0 && (
				<ul aria-label="Plan usage" className="flex flex-col gap-0.5">
					<PlanTiles plans={plans} />
				</ul>
			)}
		</footer>
	);
}
