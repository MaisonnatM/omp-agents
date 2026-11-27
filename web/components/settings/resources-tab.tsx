/** Settings › Resources: this Mac's memory now and over the last day, who holds it with a stop for each, what stops next under pressure, and the automatic stops. */
import { lazy, Suspense } from "react";
import type { AutoStop, Footprint, LadderEntry, MemoryReading } from "../../../src/shared/resources";
import { Button } from "@/components/ui/button";
import { age, formatBytes } from "../../labels";
import { ownerKey, ownerKind, ownerName, PRESSURE_LABEL, PRESSURE_TONE, resourceHistoryStore, resourcesStore, stopOwner } from "../../resources";
import { useAction } from "../../use-action";
import { useDashboardActions } from "../dashboard-context";
import { TONE_CLASS } from "../gauge-tile";
import { ErrorText, Section } from "./editor";
import { Count, RowHead, Table, Text } from "./table";

const ResourcesChart = lazy(() => import("./resources-chart").then(module => ({ default: module.ResourcesChart })));

const RUNG_LABEL: Record<LadderEntry["rung"], string> = {
	0: "Stray",
	1: "Idle MCP server",
	2: "Job of an idle session",
	3: "Settled session",
	4: "Settled private session, critical only",
};

const BECAUSE_LABEL: Record<AutoStop["because"], string> = {
	idle: "Idle",
	stray: "Unlisted",
	normal: "Idle",
	warn: "High pressure",
	critical: "Critical pressure",
	unknown: "Idle",
};

function Now({ reading }: { reading: MemoryReading | null }) {
	const pressure = reading?.pressure ?? "unknown";
	const known = reading !== null && pressure !== "unknown";
	const figures: [string, string][] = [
		["In use", known ? `${formatBytes(reading.totalBytes - reading.availableBytes)} of ${formatBytes(reading.totalBytes)}` : "—"],
		["Swap used", known ? formatBytes(reading.swapUsedBytes) : "—"],
		["Swapped out", known ? `${formatBytes(reading.swapOutBytesPerMin)} a minute` : "—"],
	];
	return (
		<Section meta="Pressure is read every 15 seconds from macOS. Under high pressure the dashboard stops one idle thing a tick, under critical three, and never a busy session.">
			<dl className="grid gap-x-8 gap-y-4 sm:grid-cols-4">
				<div>
					<dt className="text-xs text-muted-foreground">Pressure</dt>
					<dd className={`mt-1 text-xl font-semibold ${TONE_CLASS[PRESSURE_TONE[pressure]].text}`}>{PRESSURE_LABEL[pressure]}</dd>
				</div>
				{figures.map(([label, value]) => (
					<div key={label}>
						<dt className="text-xs text-muted-foreground">{label}</dt>
						<dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd>
					</div>
				))}
			</dl>
		</Section>
	);
}

function History({ active }: { active: boolean }) {
	const { read, error } = resourceHistoryStore.usePolling(null, active);
	const samples = read?.data ?? [];
	const jetsam = samples.flatMap(sample => sample.jetsam);
	return (
		<Section title="Last 24 hours" meta={jetsam.length === 0 ? "No Jetsam event: macOS killed nothing for memory." : `${jetsam.length} Jetsam ${jetsam.length === 1 ? "event" : "events"}: ${jetsam.map(event => `${event.killed} killed, ${event.largestProcess} largest`).join("; ")}.`}>
			{samples.length === 0 ? (
				<p className="text-sm text-muted-foreground">{read === null ? "Reading…" : "No samples yet. The dashboard keeps one a minute."}</p>
			) : (
				<Suspense fallback={<div className="h-56" />}>
					<ResourcesChart samples={samples} />
				</Suspense>
			)}
			{error && <ErrorText>Cannot read the history. {error}</ErrorText>}
		</Section>
	);
}

function Footprints({ footprints }: { footprints: Footprint[] }) {
	const { end } = useDashboardActions();
	const stop = useAction(async ({ owner }: Footprint) => {
		if (owner.kind === "session") await end(owner.instanceId);
		else if (owner.kind === "process" || owner.kind === "stray") await stopOwner(owner);
		await resourcesStore.refresh();
	}, "Cannot stop it");
	const rows = footprints.toSorted((a, b) => b.memoryBytes - a.memoryBytes);
	return (
		<Section title="Who holds memory" meta="Each session counts its MCP servers. End session ends a session as the session's own button does.">
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing measured yet.</p>
			) : (
				<Table label="Memory by owner" columns={["Owner", "Kind", "Memory", "Processes", "Action"]} textColumns={2}>
					{rows.map(footprint => {
						const { owner } = footprint;
						const pending = stop.state.kind === "pending" && stop.state.args[0] === footprint;
						const stoppable = footprint.stoppable && (owner.kind === "session" || owner.kind === "process" || owner.kind === "stray");
						return (
							<tr key={ownerKey(owner)}>
								<RowHead className="max-w-80 truncate" title={ownerName(owner)}>{ownerName(owner)}</RowHead>
								<Text muted>{ownerKind(owner)}</Text>
								<Count>{formatBytes(footprint.memoryBytes)}</Count>
								<Count>{footprint.processCount}</Count>
								<td className="border-t border-border py-2 ps-4 text-end">
									{stoppable && (
										<Button size="xs" variant="outline" disabled={stop.pending} onClick={() => stop.run(footprint)}>
											{pending ? "Stopping…" : owner.kind === "session" ? "End session" : "Stop"}
										</Button>
									)}
								</td>
							</tr>
						);
					})}
				</Table>
			)}
		</Section>
	);
}

function Ladder({ ladder }: { ladder: LadderEntry[] }) {
	return (
		<Section title="What stops next" meta="If pressure rises, these stop in this order, cheapest loss first.">
			{ladder.length === 0 ? (
				<p className="text-sm text-muted-foreground">Nothing idle to stop.</p>
			) : (
				<Table label="What stops next under pressure" columns={["Owner", "Why it goes", "Memory"]} textColumns={2}>
					{ladder.map(entry => (
						<tr key={ownerKey(entry.owner)}>
							<RowHead className="max-w-80 truncate" title={ownerName(entry.owner)}>{ownerName(entry.owner)}</RowHead>
							<Text muted>{RUNG_LABEL[entry.rung]}</Text>
							<Count>{formatBytes(entry.memoryBytes)}</Count>
						</tr>
					))}
				</Table>
			)}
		</Section>
	);
}

function Stops({ stops }: { stops: AutoStop[] }) {
	const rows = stops.toSorted((a, b) => b.at - a.at);
	return (
		<Section title="Automatic stops" meta="What the dashboard stopped without a click since it started, and why.">
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">None yet.</p>
			) : (
				<Table label="Automatic stops" columns={["Owner", "Why", "Memory", "When"]} textColumns={2}>
					{rows.map(stop => (
						<tr key={`${ownerKey(stop.owner)}@${stop.at}`}>
							<RowHead className="max-w-80 truncate" title={ownerName(stop.owner)}>{ownerName(stop.owner)}</RowHead>
							<Text muted>{BECAUSE_LABEL[stop.because]}</Text>
							<Count>{formatBytes(stop.memoryBytes)}</Count>
							<Count title={new Date(stop.at).toLocaleString()}>{age(stop.at)}</Count>
						</tr>
					))}
				</Table>
			)}
		</Section>
	);
}

export function ResourcesTab({ active }: { active: boolean }) {
	const { read, error } = resourcesStore.usePolling(null, active);
	const view = read?.data ?? null;
	return (
		<>
			<Now reading={view?.reading ?? null} />
			{error && <ErrorText>Cannot read memory. {error}</ErrorText>}
			<History active={active} />
			<Footprints footprints={view?.footprints ?? []} />
			<Ladder ladder={view?.ladder ?? []} />
			<Stops stops={view?.stops ?? []} />
		</>
	);
}
