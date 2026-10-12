import { Cpu, HardDrive, MemoryStick, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import type { SystemLoad } from "../../src/shared/system";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DashboardState } from "../dashboard-state";
import { formatBytes } from "../labels";
import { useRead } from "../reads";
import { shortcutLabels } from "../shortcuts";
import { PlanUsageList } from "./plan-usage";

/** How often the status bar reads the machine's load again while the page is visible. */
const POLL_MS = 5000;

const FACT = "flex items-center gap-1 whitespace-nowrap rounded-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The machine's CPU percent, available memory, and free disk space, read again every few seconds while the page is visible. */
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
	const disk = `${formatBytes(load.diskAvailable)} of ${formatBytes(load.diskTotal)} disk space available`;
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
			<Tooltip content={disk} side="top">
				<span tabIndex={0} aria-label={disk} className={FACT}>
					<HardDrive aria-hidden className="size-3 shrink-0" />
					{formatBytes(load.diskAvailable)}
				</span>
			</Tooltip>
		</>
	);
}

/** The window's bottom strip: plan quota on the left; the terminal's toggle and the machine's load on the right. */
export function StatusBar({ usage, terminalOpen, onToggleTerminal }: { usage: DashboardState["usage"]; terminalOpen: boolean; onToggleTerminal: () => void }) {
	return (
		<footer className="flex min-h-7 shrink-0 items-center gap-4 border-t border-border px-3 py-1 text-xs">
			<PlanUsageList usage={usage} />
			<div className="ml-auto flex min-w-0 shrink-0 items-center gap-3 text-muted-foreground">
				<Tooltip content={terminalOpen ? "Hide the terminal" : "Show the terminal"} shortcut={shortcutLabels("terminal")} side="top">
					<button type="button" aria-pressed={terminalOpen} onClick={onToggleTerminal} className={cn(FACT, "hover:text-foreground", terminalOpen && "text-foreground")}>
						<SquareTerminal aria-hidden className="size-3 shrink-0" />
						Terminal
					</button>
				</Tooltip>
				<MachineLoad />
			</div>
		</footer>
	);
}
