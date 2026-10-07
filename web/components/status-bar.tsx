import { Cpu, FolderGit2, MemoryStick } from "lucide-react";
import { useEffect, useState } from "react";
import type { SystemLoad } from "../../src/shared/system";
import { Tooltip } from "@/components/ui/tooltip";
import type { DashboardState } from "../dashboard-state";
import { formatBytes, projectName } from "../labels";
import { useRead } from "../reads";
import { PlanUsageList } from "./plan-usage";

/** How often the status bar reads the machine's load again while the page is visible. */
const POLL_MS = 5000;

const FACT = "flex items-center gap-1 whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The worktree the focused session works in, else its directory, by name with its full path on hover. */
function Workspace({ dir }: { dir: string }) {
	return (
		<Tooltip content={dir} side="top">
			<span tabIndex={0} aria-label={`Worktree: ${dir}`} className={`${FACT} min-w-0 max-w-64`}>
				<FolderGit2 aria-hidden className="size-3 shrink-0" />
				<span className="truncate">{projectName(dir) ?? dir}</span>
			</span>
		</Tooltip>
	);
}

/** The machine's CPU percent and available memory, read again every few seconds while the page is visible. */
function MachineLoad() {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => {
			if (!document.hidden) setTick(count => count + 1);
		}, POLL_MS);
		return () => clearInterval(timer);
	}, []);
	const load = useRead<SystemLoad>("/api/system", tick).data;
	if (!load) return null;
	const cpu = load.cpuPercent === null ? null : `${Math.round(load.cpuPercent)}%`;
	const memory = `${formatBytes(load.memoryAvailable)} of ${formatBytes(load.memoryTotal)} memory available`;
	return (
		<>
			{cpu !== null && (
				<Tooltip content={`CPU ${cpu} busy across all cores`} side="top">
					<span tabIndex={0} aria-label={`CPU ${cpu} busy`} className={FACT}>
						<Cpu aria-hidden className="size-3 shrink-0" />
						{cpu}
					</span>
				</Tooltip>
			)}
			<Tooltip content={memory} side="top">
				<span tabIndex={0} aria-label={memory} className={FACT}>
					<MemoryStick aria-hidden className="size-3 shrink-0" />
					{formatBytes(load.memoryAvailable)}
				</span>
			</Tooltip>
		</>
	);
}

/** The window's bottom strip: plan quota on the left; the focused session's worktree and the machine's load on the right. */
export function StatusBar({ usage, workspace }: { usage: DashboardState["usage"]; workspace: string | null }) {
	return (
		<footer className="flex min-h-7 shrink-0 items-center gap-4 border-t border-border px-3 py-1 text-xs">
			<PlanUsageList usage={usage} />
			<div className="ml-auto flex min-w-0 shrink-0 items-center gap-3 text-muted-foreground">
				{workspace !== null && <Workspace dir={workspace} />}
				<MachineLoad />
			</div>
		</footer>
	);
}
