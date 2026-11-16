/** The machine's CPU, memory, and disk at the header's right end, each a chip with its card or tooltip. */
import { IconProcessor, IconSdCard, IconStorage } from "central-icons";
import { type HTMLAttributes, type ReactNode, type Ref, useEffect, useMemo, useState } from "react";
import type { Bot } from "../../src/shared/bots";
import type { LiveSessionProcesses, SessionProcess } from "../../src/shared/processes";
import type { RosterHost } from "../../src/shared/sessions";
import type { SystemLoad } from "../../src/shared/system";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { isPhonePage } from "../api";
import { activityControl } from "../activity";
import { commandLabel, formatBytes, hostLabel } from "../labels";
import { sessionProcessesStore, useRead, writeProcessStop } from "../reads";
import { hashForSettings } from "../routing";
import { useAction } from "../use-action";
import { useHoverPopover } from "../use-hover-popover";
import { TONE_CLASS, type Tone } from "./gauge-tile";
import { LoadNote } from "./sheet-details";

/** How often the header reads the machine's load again while the page is visible. */
const POLL_MS = 5000;

const ICON = "size-3.5 text-muted-foreground";
const CHIP = "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring";

/** A machine figure's tone from the share in use: amber past 80%, red past 95%. */
const usedTone = (used: number): Tone => (used > 0.95 ? "out" : used > 0.8 ? "low" : "ok");

interface StatChipProps extends Omit<HTMLAttributes<HTMLElement>, "className"> {
	/** A button, which opens a card; otherwise a focusable picture, which a tooltip explains. */
	as: "button" | "img";
	/** What a screen reader says for the chip. */
	label: string;
	tone: Tone;
	icon: ReactNode;
	value: string;
	ref?: Ref<HTMLElement>;
}

/** One stat of the header: its icon and its figure in its tone; it takes a popover's or a tooltip's trigger props. */
function StatChip({ as, label, tone, icon, value, ref, ...props }: StatChipProps) {
	const body = (
		<>
			{icon}
			<span className={TONE_CLASS[tone].text}>{value}</span>
		</>
	);
	if (as === "button") {
		return (
			<button {...props} ref={ref as Ref<HTMLButtonElement>} type="button" aria-label={label} className={CHIP}>
				{body}
			</button>
		);
	}
	return (
		<span {...props} ref={ref} tabIndex={0} role="img" aria-label={label} className={CHIP}>
			{body}
		</span>
	);
}

/** A `ps` CPU percent, of one core, rounded; a share that rounds to nothing but is not idle reads `<1%`. */
const cpuLabel = (percent: number): string => (percent > 0 && percent < 0.5 ? "<1%" : `${Math.round(percent)}%`);

/** The CPU chip, whose popover lists what every live session runs, busiest session first, read again every few seconds while it is open. */
function CpuFact({ percent, titles }: { percent: number; titles: SessionTitles }) {
	const popover = useHoverPopover();
	const cpu = `${Math.round(percent)}%`;
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<StatChip
					{...activityControl("sidebar.cpu")}
					{...popover.trigger}
					as="button"
					label={`CPU: ${cpu} busy`}
					tone={usedTone(percent / 100)}
					icon={<IconProcessor className={ICON} />}
					value={cpu}
				/>
			</PopoverTrigger>
			<PopoverContent {...popover.content} side="bottom" align="end" aria-label="Sessions' processes" className="w-96 p-0">
				<div className="border-b border-border px-3 py-2">
					<p className="text-sm font-medium tabular-nums">{`CPU ${cpu} busy across all cores`}</p>
					<p className="text-xs text-muted-foreground">Per process, 100% is one full core.</p>
				</div>
				<SessionProcessList titles={titles} />
			</PopoverContent>
		</Popover>
	);
}

/** Every live session's processes, polled while mounted, which is while the CPU card is open. */
function SessionProcessList({ titles }: { titles: SessionTitles }) {
	const { read, error } = sessionProcessesStore.usePolling();
	if (!read) {
		return (
			<div className="px-3 py-2">
				<LoadNote loading="Reading the sessions' processes…" error={error && `Cannot read the sessions' processes: ${error}`} />
			</div>
		);
	}
	if (read.data.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">No session is running.</p>;
	const busiest = read.data
		.map(session => ({ session, cpuPercent: session.processes.reduce((sum, process) => sum + process.cpuPercent, session.omp.cpuPercent) }))
		.sort((a, b) => b.cpuPercent - a.cpuPercent);
	return (
		<div className="max-h-96 overflow-y-auto">
			{busiest.map(({ session, cpuPercent }) => (
				<SessionGroup key={session.instanceId} title={titles.get(session.instanceId) ?? "Session"} cpuPercent={cpuPercent} session={session} readAt={read.at} />
			))}
		</div>
	);
}

/** One live session: its title and total CPU, omp's own line, and each process it runs besides omp. */
function SessionGroup({ title, cpuPercent, session, readAt }: { title: string; cpuPercent: number; session: LiveSessionProcesses; readAt: number }) {
	const { omp } = session;
	const ompFacts = [cpuLabel(omp.cpuPercent), formatBytes(omp.memoryBytes), omp.processCount > 1 ? `${omp.processCount} processes` : null].filter(fact => fact !== null);
	return (
		<section aria-label={title} className="border-b border-border px-3 py-2 last:border-b-0">
			<div className="flex items-baseline gap-2">
				<p title={title} className="min-w-0 flex-1 truncate text-xs font-medium">
					{title}
				</p>
				<span className="text-xs text-muted-foreground tabular-nums">{cpuLabel(cpuPercent)}</span>
			</div>
			<ul className="divide-y divide-border">
				<li className="py-1.5">
					<p className="text-xs">omp and its MCP servers</p>
					<p className="text-xs text-muted-foreground tabular-nums">{ompFacts.join(" · ")}</p>
				</li>
				{session.processes.map(process => (
					<ProcessItem key={process.id} instanceId={session.instanceId} process={process} readAt={readAt} />
				))}
			</ul>
		</section>
	);
}

function ProcessItem({ instanceId, process, readAt }: { instanceId: string; process: SessionProcess; readAt: number }) {
	const stop = useAction(() => writeProcessStop(instanceId, process.id), "Cannot stop the process");
	const facts = [
		cpuLabel(process.cpuPercent),
		formatBytes(process.memoryBytes),
		process.processCount > 1 ? `${process.processCount} processes` : null,
		process.shared ? "Shared with this project's sessions" : null,
		process.stopsAt === null ? null : `Stops in ${Math.max(1, Math.ceil((process.stopsAt - readAt) / 60_000))} min`,
	].filter(fact => fact !== null);
	return (
		<li className="flex items-center gap-2 py-1.5">
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

/** Disk use and the entry to Storage, with the same hover-and-click behavior as the CPU card. */
function DiskFact({ available, total }: { available: number; total: number }) {
	const popover = useHoverPopover();
	const used = total - available;
	const share = total > 0 ? used / total : null;
	const percent = Math.round((share ?? 0) * 100);
	return (
		<Popover {...popover.root}>
			<PopoverTrigger asChild>
				<StatChip
					{...activityControl("sidebar.disk")}
					{...popover.trigger}
					as="button"
					label={`Disk free: ${formatBytes(available)} of ${formatBytes(total)}`}
					tone={usedTone(share ?? 0)}
					icon={<IconStorage className={ICON} />}
					value={formatBytes(available)}
				/>
			</PopoverTrigger>
			<PopoverContent {...popover.content} side="bottom" align="end" aria-label="Disk space" className="w-64 space-y-3 text-xs">
				<p className="text-sm font-medium tabular-nums">{`Disk ${percent}% used`}</p>
				<div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-muted-foreground" style={{ width: `${percent}%` }} /></div>
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
					<dt className="text-muted-foreground">Used</dt><dd className="text-right">{formatBytes(used)}</dd>
					<dt className="text-muted-foreground">Free</dt><dd className="text-right">{formatBytes(available)}</dd>
					<dt className="text-muted-foreground">Total</dt><dd className="text-right">{formatBytes(total)}</dd>
				</dl>
				<p className="text-muted-foreground">The volume that holds your home folder.</p>
				<div className="border-t border-border pt-2"><Button variant="ghost" size="compact" render={<a href={hashForSettings("storage")} />} onClick={() => popover.root.onOpenChange(false)}>Clean up…</Button></div>
			</PopoverContent>
		</Popover>
	);
}

/** The machine's load, read again every few seconds while the page is visible; never on a paired phone, where it would describe the Mac. */
function useSystemLoad(): SystemLoad | null {
	const phone = isPhonePage();
	const [tick, setTick] = useState(0);
	useEffect(() => {
		if (phone) return;
		const timer = setInterval(() => {
			if (!document.hidden) setTick(count => count + 1);
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [phone]);
	return useRead<SystemLoad>(phone ? null : "/api/system", tick).data;
}

/** Each live session's title in the CPU card, by instance id: its Bot's name for a Bot's conversation, else its own title. */
type SessionTitles = ReadonlyMap<string, string>;

/** The machine's CPU, available memory, and free disk space as chips, once read; nothing on a paired phone. */
export function MachineStats({ hosts, bots }: { hosts: readonly RosterHost[]; bots: readonly Bot[] | null }) {
	const titles = useMemo<SessionTitles>(() => {
		const botNames = new Map((bots ?? []).flatMap(bot => (bot.sessionId === null ? [] : [[bot.sessionId, bot.name] as const])));
		return new Map(hosts.map(host => {
			const botName = botNames.get(host.sessionId);
			return [host.instanceId, botName === undefined ? hostLabel(host) : `${botName} · Bot`];
		}));
	}, [hosts, bots]);
	const load = useSystemLoad();
	return load && <MachineLoad load={load} titles={titles} />;
}

/** The read load's chips, in a labelled group. */
export function MachineLoad({ load, titles }: { load: SystemLoad; titles: SessionTitles }) {
	const memory = `Memory free: ${formatBytes(load.memoryAvailable)} of ${formatBytes(load.memoryTotal)}`;
	const memoryUsed = load.memoryTotal > 0 ? 1 - load.memoryAvailable / load.memoryTotal : null;
	return (
		<div role="group" aria-label="Machine load" className="flex shrink-0 items-center gap-0.5">
			{load.cpuPercent !== null && <CpuFact percent={load.cpuPercent} titles={titles} />}
			<Tooltip content={memory} side="bottom">
				<StatChip as="img" label={memory} tone={usedTone(memoryUsed ?? 0)} icon={<IconSdCard className={ICON} />} value={formatBytes(load.memoryAvailable)} />
			</Tooltip>
			<DiskFact available={load.diskAvailable} total={load.diskTotal} />
		</div>
	);
}
