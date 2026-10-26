/** The settings tab for how this dashboard is used: features never or rarely used, the most used ones, navigation, and active time. */
import { lazy, type ReactNode, Suspense, useMemo } from "react";
import { type ActivityRead, featureId } from "../../../src/shared/activity";
import { cn } from "@/lib/utils";
import { inventory, report, type UsedFeature } from "../../activity-report";
import { readTime } from "../../labels";
import { activityStore } from "../../reads";
import type { SidebarTab } from "../../routing";
import { useSidebarTabs } from "../../sidebar-tabs";
import { LoadNote } from "../sheet-details";
import { full } from "./analytics-format";
import { RangePicker, useRangedRead } from "./range";
import { Count, RowHead, Table, Text } from "./table";

// `recharts` is a chunk of its own, loaded when the tab first draws its chart.
const ActivityChart = lazy(() => import("./activity-chart").then(module => ({ default: module.ActivityChart })));

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
		<tr key={featureId(kind, key)}>
			<RowHead>{label}</RowHead>
			<Text muted>{kind}</Text>
			<Count>{full.format(use.count)}</Count>
			<Count>{full.format(use.days)}</Count>
			<Count>{kind === "command" ? `${full.format(use.keyboard)} / ${full.format(use.palette)}` : "–"}</Count>
		</tr>
	));
}

function ActivityBody({ data, signedOut }: { data: ActivityRead; signedOut: ReadonlySet<SidebarTab> }) {
	const result = useMemo(() => report(inventory(data.serverActions), data, signedOut), [data, signedOut]);
	return (
		<div className="space-y-7">
			<Section id="activity-never" title="Not used">
				{result.never.length === 0 ? <p className="text-sm text-muted-foreground">Every feature was used in this range.</p> : (
					<Table label="Features not used in this range" columns={["Feature", "Kind", "Last used"]} textColumns={2}>
						{result.never.map(({ kind, key, label, lastAt }) => (
							<tr key={featureId(kind, key)}>
								<RowHead>{label}</RowHead>
								<Text muted>{kind}</Text>
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
					<FeatureRows features={result.mostUsed} />
				</Table>
			</Section>
			<Section id="activity-navigation" title="Navigation">
				<div className="grid gap-7 lg:grid-cols-2">
					<Table label="The 15 most common moves between views" columns={["From", "To", "Moves"]} textColumns={2}>
						{data.transitions.slice(0, 15).map(({ from, to, count }) => (
							<tr key={`${from}>${to}`}>
								<RowHead>{from}</RowHead>
								<Text>{to}</Text>
								<Count>{full.format(count)}</Count>
							</tr>
						))}
					</Table>
					<Table label="Time on each view" columns={["View", "Time"]}>
						{data.dwell.map(({ view, ms }) => (
							<tr key={view}>
								<RowHead>{view}</RowHead>
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
							<RowHead>{day}</RowHead>
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
	const { range, setRange, data, error, switching } = useRangedRead(activityStore, "30d", active);
	const { signedOut } = useSidebarTabs();
	return (
		<div className="space-y-7">
			<RangePicker range={range} onChange={setRange} />
			{error && data && <p role="alert" className="text-sm text-red-600 dark:text-red-400">Cannot refresh activity: {error}</p>}
			<div aria-busy={switching || undefined} className={cn("transition-opacity duration-150", switching && "opacity-50")}>
				{!data ? <LoadNote loading="Reading activity…" error={error} /> : <ActivityBody data={data} signedOut={signedOut} />}
			</div>
		</div>
	);
}
