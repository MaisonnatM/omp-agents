/** The settings tab for how this dashboard is used: features never or rarely used, the most used ones, navigation, and active time. */
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import type { McpIntegrationId } from "../../../src/shared/accounts";
import type { ActivityRead } from "../../../src/shared/activity";
import { ANALYTICS_RANGES, type AnalyticsRange } from "../../../src/shared/analytics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inventory, report, type UsedFeature } from "../../activity-report";
import { readTime } from "../../labels";
import { activityStore } from "../../reads";
import { SIDEBAR_TABS } from "../../routing";
import { useSidebarTabs } from "../../sidebar-tabs";
import { LoadNote } from "../sheet-details";
import { full } from "./analytics-format";
import { Count, Table } from "./analytics-tab";

// `recharts` is a chunk of its own, loaded when the tab first draws its chart.
const ActivityChart = lazy(() => import("./activity-chart").then(module => ({ default: module.ActivityChart })));

const rangeLabel: Record<AnalyticsRange, string> = { today: "Today", "24h": "24h", "7d": "7d", "30d": "30d", "90d": "90d", all: "All" };
const minutes = (ms: number): string => `${full.format(Math.round(ms / 60_000))} min`;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section className="space-y-3" aria-labelledby={id}>
			<h3 id={id} className="text-sm font-semibold">{title}</h3>
			{children}
		</section>
	);
}

function FeatureRows({ features }: { features: UsedFeature[] }) {
	return features.map(({ kind, key, label, use }) => (
		<tr key={`${kind}:${key}`}>
			<th scope="row" className="border-t border-border py-2 text-start font-medium">{label}</th>
			<td className="border-t border-border py-2 ps-4 text-start text-muted-foreground">{kind}</td>
			<Count>{full.format(use.count)}</Count>
			<Count>{full.format(use.days)}</Count>
			<Count>{kind === "command" ? `${full.format(use.keyboard)} / ${full.format(use.palette)}` : "–"}</Count>
		</tr>
	));
}

function ActivityBody({ data, setUp }: { data: ActivityRead; setUp: ReadonlySet<McpIntegrationId> }) {
	const result = useMemo(() => report(inventory(data.serverActions), data, setUp), [data, setUp]);
	const labels = useMemo(() => new Map([...result.used, ...result.rarely].map(feature => [`${feature.kind}:${feature.key}`, feature.label])), [result]);
	const mostUsed = data.uses.slice(0, 20);
	return (
		<div className="space-y-7">
			<Section id="activity-never" title="Not used">
				{result.never.length === 0 ? <p className="text-sm text-muted-foreground">Every feature was used in this range.</p> : (
					<Table label="Features not used in this range" columns={["Feature", "Kind", "Last used"]} textColumns={2}>
						{result.never.map(({ kind, key, label, lastAt }) => (
							<tr key={`${kind}:${key}`}>
								<th scope="row" className="border-t border-border py-2 text-start font-medium">{label}</th>
								<td className="border-t border-border py-2 ps-4 text-start text-muted-foreground">{kind}</td>
								<Count>{lastAt === null ? "Never" : readTime(lastAt)}</Count>
							</tr>
						))}
					</Table>
				)}
				{result.rarely.length > 0 && (
					<Table label="Features used once or twice in this range" columns={["Rarely used", "Kind", "Uses", "Days", "Keyboard / palette"]} textColumns={2}>
						<FeatureRows features={result.rarely} />
					</Table>
				)}
				{result.notSetUp.length > 0 && <p className="text-xs text-muted-foreground">Not set up, so not counted: {result.notSetUp.map(({ label }) => label).join(", ")}.</p>}
			</Section>
			<Section id="activity-most-used" title="Most used">
				<Table label="The 20 most used features" columns={["Feature", "Kind", "Uses", "Days", "Keyboard / palette"]} textColumns={2}>
					{mostUsed.map(use => (
						<tr key={`${use.kind}:${use.key}`}>
							<th scope="row" className="border-t border-border py-2 text-start font-medium">{labels.get(`${use.kind}:${use.key}`) ?? use.key}</th>
							<td className="border-t border-border py-2 ps-4 text-start text-muted-foreground">{use.kind}</td>
							<Count>{full.format(use.count)}</Count>
							<Count>{full.format(use.days)}</Count>
							<Count>{use.kind === "command" ? `${full.format(use.keyboard)} / ${full.format(use.palette)}` : "–"}</Count>
						</tr>
					))}
				</Table>
			</Section>
			<Section id="activity-navigation" title="Navigation">
				<div className="grid gap-7 lg:grid-cols-2">
					<Table label="The 15 most common moves between views" columns={["From", "To", "Moves"]} textColumns={2}>
						{data.transitions.slice(0, 15).map(({ from, to, count }) => (
							<tr key={`${from}>${to}`}>
								<th scope="row" className="border-t border-border py-2 text-start font-medium">{from}</th>
								<td className="border-t border-border py-2 ps-4 text-start">{to}</td>
								<Count>{full.format(count)}</Count>
							</tr>
						))}
					</Table>
					<Table label="Time on each view" columns={["View", "Time"]}>
						{data.dwell.map(({ view, ms }) => (
							<tr key={view}>
								<th scope="row" className="border-t border-border py-2 text-start font-medium">{view}</th>
								<Count>{minutes(ms)}</Count>
							</tr>
						))}
					</Table>
				</div>
			</Section>
			<Section id="activity-time" title="Active time">
				<Suspense fallback={<div className="h-48" />}>
					<ActivityChart days={data.days} />
				</Suspense>
				<Table label="Active time, visits, and actions per day" columns={["Day", "Active", "Visits", "Actions"]}>
					{data.days.map(({ day, activeMs, visits, actions }) => (
						<tr key={day}>
							<th scope="row" className="border-t border-border py-2 text-start font-medium">{day}</th>
							<Count>{minutes(activeMs)}</Count>
							<Count>{full.format(visits)}</Count>
							<Count>{full.format(actions)}</Count>
						</tr>
					))}
				</Table>
			</Section>
		</div>
	);
}

/** Activity over the chosen range, read while the tab shows. */
export function ActivityTab({ active }: { active: boolean }) {
	const [range, setRange] = useState<AnalyticsRange>("30d");
	const entry = activityStore.use(range);
	const answer = entry.read?.data ?? null;
	const [last, setLast] = useState<ActivityRead | null>(null);
	if (answer !== null && answer !== last) setLast(answer);
	const { error } = entry;
	const data = answer ?? (error === null ? last : null);
	const switching = data !== null && data.range !== range;
	const { signedOut } = useSidebarTabs();
	const setUp = useMemo(() => new Set(SIDEBAR_TABS.flatMap(row => ("integration" in row && !signedOut.has(row.value) ? [row.integration] : []))), [signedOut]);
	useEffect(() => {
		if (active) void activityStore.refresh(range);
	}, [active, range]);
	return (
		<div className="space-y-7">
			<div role="group" aria-label="Time range" className="flex flex-wrap gap-1">
				{ANALYTICS_RANGES.map(option => (
					<Button key={option} variant="ghost" size="compact" active={option === range} aria-pressed={option === range} onClick={() => setRange(option)}>
						{rangeLabel[option]}
					</Button>
				))}
			</div>
			{error && data && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot refresh activity: {error}</p>}
			<div aria-busy={switching || undefined} className={cn("transition-opacity duration-150", switching && "opacity-50")}>
				{!data ? <LoadNote loading="Reading activity…" error={error} /> : <ActivityBody data={data} setUp={setUp} />}
			</div>
		</div>
	);
}
