import { Cpu } from "lucide-react";
import type { SessionProcess } from "../../src/shared/processes";
import { Button } from "@/components/ui/button";
import { commandLabel, formatBytes } from "../labels";
import { sessionProcessesStore, writeProcessStop } from "../reads";
import { useAction } from "../use-action";
import { DetailsEmpty } from "./details-sidebar-frame";
import { LoadNote } from "./sheet-details";

/** What live session `instanceId` runs besides omp, biggest memory first, each with a Stop button; the sidebar polls the read. */
export function SessionProcessesTab({ instanceId }: { instanceId: string }) {
	const { read, error } = sessionProcessesStore.use(instanceId);
	if (!read) return <div className="px-4 py-2"><LoadNote loading="Reading the session's processes…" error={error && `Cannot read the session's processes: ${error}`} /></div>;
	const { omp, processes } = read.data;
	return (
		<div className="space-y-3 px-4 pb-4">
			{processes.length === 0 ? (
				<DetailsEmpty icon={Cpu} title="Nothing runs besides omp" description="Dev servers, watchers, and services this session starts show here, each with a Stop button." />
			) : (
				<ul aria-label="This session's processes" className="divide-y divide-border">
					{processes.map(process => (
						<ProcessItem key={process.id} instanceId={instanceId} process={process} readAt={read.at} />
					))}
				</ul>
			)}
			<p className="text-xs text-muted-foreground tabular-nums">
				{`omp and its MCP servers use ${formatBytes(omp.memoryBytes)}${omp.processCount > 1 ? ` across ${omp.processCount} processes` : ""}; they end with the session.`}
			</p>
		</div>
	);
}

function ProcessItem({ instanceId, process, readAt }: { instanceId: string; process: SessionProcess; readAt: number }) {
	const stop = useAction(() => writeProcessStop(instanceId, process.id), "Cannot stop the process");
	const facts = [
		formatBytes(process.memoryBytes),
		process.processCount > 1 ? `${process.processCount} processes` : null,
		process.shared ? "Shared with this project's sessions" : null,
		process.stopsAt === null ? null : `Stops in ${Math.max(1, Math.ceil((process.stopsAt - readAt) / 60_000))} min`,
	].filter(fact => fact !== null);
	return (
		<li className="flex items-center gap-2 py-2">
			<div className="min-w-0 flex-1">
				<p title={process.label} className="truncate font-mono text-xs">
					{commandLabel(process.label)}
				</p>
				<p className="text-xs text-muted-foreground tabular-nums">{facts.join(" · ")}</p>
			</div>
			<Button variant="ghost" size="compact" loading={stop.pending} onClick={() => stop.run()} aria-label={`Stop ${process.label}`}>
				Stop
			</Button>
		</li>
	);
}
