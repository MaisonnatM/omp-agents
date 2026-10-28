/** `StatusDot`, the colored dot that shows a session's or subagent's status. */
import type { AgentStatus, HostStatus } from "../../src/shared/sessions";
import { cn } from "@/lib/utils";

type Status = HostStatus | AgentStatus;

const DOTS: Record<Status, { label: string; className: string | null }> = {
	// A running agent needs nothing from you, so it draws no dot and takes no space; only an idle one, waiting on you, lights up.
	working: { label: "working", className: null },
	running: { label: "running", className: null },
	"needs-input": { label: "needs input", className: "bg-amber-500 shadow-[0_0_0_2px] shadow-amber-500/30" },
	idle: { label: "idle", className: "bg-blue-500 shadow-[0_0_0_2px] shadow-blue-500/25" },
	parked: { label: "parked", className: "border border-muted-foreground/60" },
	aborted: { label: "aborted", className: "bg-red-500/70" },
	unknown: { label: "status unknown", className: "border border-dashed border-muted-foreground/60" },
};

export const statusLabel = (status: Status): string => DOTS[status].label;

/** Exactly the dot's width: its halo spills into the row's gap rather than widening it. */
export function StatusDot({ status }: { status: Status }) {
	const { label, className } = DOTS[status];
	// `sr-only` is absolutely positioned, so the row's flex gap skips it and the title sits flush.
	if (className === null) return <span className="sr-only">{label}</span>;
	return (
		<span className="flex h-4 w-1.5 shrink-0 items-center" role="img" aria-label={label}>
			<span className={cn("size-1.5 rounded-full", className)} />
		</span>
	);
}
