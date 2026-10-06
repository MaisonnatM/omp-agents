import type { AgentStatus, HostStatus } from "../../src/shared/sessions";
import { cn } from "@/lib/utils";

type Status = HostStatus | AgentStatus;

const DOTS: Record<Status, { label: string; className: string }> = {
	working: { label: "working", className: "bg-emerald-500 shadow-[0_0_0_2px] shadow-emerald-500/25" },
	running: { label: "running", className: "bg-emerald-500 shadow-[0_0_0_2px] shadow-emerald-500/25" },
	"needs-input": { label: "needs input", className: "bg-amber-500 shadow-[0_0_0_2px] shadow-amber-500/30" },
	idle: { label: "idle", className: "bg-blue-500 shadow-[0_0_0_2px] shadow-blue-500/25" },
	parked: { label: "parked", className: "border border-muted-foreground/60" },
	aborted: { label: "aborted", className: "bg-red-500/70" },
	unknown: { label: "status unknown", className: "border border-dashed border-muted-foreground/60" },
};

export const statusLabel = (status: Status): string => DOTS[status].label;

/** Exactly the dot's width: its halo spills into the row's gap rather than widening it. */
export function StatusDot({ status }: { status: Status }) {
	return (
		<span className="flex h-4 w-1.5 shrink-0 items-center" role="img" aria-label={DOTS[status].label}>
			<span className={cn("size-1.5 rounded-full", DOTS[status].className)} />
		</span>
	);
}
