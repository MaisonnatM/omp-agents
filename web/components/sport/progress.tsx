/** The Sport page's progress: the cards of each figure, the chart of the one picked against its target, and the records. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { lazy, Suspense, useState } from "react";
import type { SportState } from "../../../src/shared/sport";
import { records } from "../../../src/sport-week";
import { activityControl } from "../../activity";
import { chartOf, figureId, progressCards, type Range, RANGES, rangeStart } from "../../sport-progress";
import { recordRows, shortDate } from "../../sport-view";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";

// `recharts` is a chunk of its own, loaded when the first chart draws.
const ChartView = lazy(() => import("../session-chart").then(module => ({ default: module.ChartView })));

export function ProgressTab({ state, today }: { state: SportState; today: string }) {
	const [picked, setPicked] = useState<string | null>(null);
	const [range, setRange] = useState<Range>(RANGES[2]);
	const cards = progressCards(state, today);
	const card = cards.find(entry => figureId(entry.figure) === picked) ?? cards[0]!;
	const chart = chartOf(state, card.figure, rangeStart(range, today), today);
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 max-phone:px-6 @3xl/sport:px-6">
			<RadioGroup aria-label="Mesures" value={figureId(card.figure)} onValueChange={next => setPicked(cards.map(entry => figureId(entry.figure)).find(id => id === next) ?? picked)} className="grid grid-cols-2 gap-3 @4xl/sport:grid-cols-5">
				{cards.map(entry => (
					<Radio.Root key={figureId(entry.figure)} value={figureId(entry.figure)} {...activityControl("sport.progress.card")} className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:ring-1 data-[checked]:ring-primary">
						<span className="max-w-full text-xs text-pretty text-muted-foreground">{entry.label}</span>
						<span className="text-2xl font-semibold tabular-nums">{entry.value}</span>
						<span className="max-w-full text-xs text-pretty text-muted-foreground">{entry.detail}</span>
					</Radio.Root>
				))}
			</RadioGroup>
			<section aria-label={chart.title} className="flex flex-col gap-3 rounded-xl border border-border p-4">
				<header className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="text-sm font-semibold">{chart.title}</h2>
						{chart.sentence && <p className="text-xs text-muted-foreground">{chart.sentence}</p>}
					</div>
					<SegmentedTabs value={range.id} onValueChange={value => setRange(RANGES.find(({ id }) => id === value) ?? range)} activationMode="manual">
						<SegmentedTabsList aria-label="Période">
							{RANGES.map(entry => (
								<SegmentedTab key={entry.id} value={entry.id} {...activityControl("sport.progress.range")}>{entry.label}</SegmentedTab>
							))}
						</SegmentedTabsList>
					</SegmentedTabs>
				</header>
				{chart.spec.data.length === 0 ? (
					<p className="py-10 text-center text-sm text-muted-foreground">{chart.empty}</p>
				) : (
					<Suspense fallback={<div className="h-64" />}>
						<ChartView spec={chart.spec} label={chart.title} expanded={false} reference={chart.reference} format={chart.format} fit />
					</Suspense>
				)}
			</section>
			<Records state={state} />
		</div>
	);
}

/** The best of each metric, each kind of climb, and each load, with the day it was first reached. */
function Records({ state }: { state: SportState }) {
	const rows = recordRows(state, records(state));
	return (
		<section aria-label="Records" className="rounded-xl border border-border p-4">
			<h2 className="text-sm font-semibold">Records</h2>
			<p className="text-xs text-muted-foreground">Ta meilleure marque sur chaque mesure, depuis le début.</p>
			{rows.length === 0 ? (
				<p className="pt-3 text-sm text-muted-foreground">Aucun record pour l'instant. Ils viennent avec les tests et les séances notées.</p>
			) : (
				<table className="mt-3 w-full text-sm">
					<thead className="text-left text-xs text-muted-foreground">
						<tr className="border-b border-border">
							<th className="py-1.5 font-normal">Mesure</th>
							<th className="py-1.5 font-normal">Date</th>
							<th className="py-1.5 text-right font-normal">Record</th>
						</tr>
					</thead>
					<tbody>
						{rows.map(row => (
							<tr key={row.key} className="border-b border-border last:border-b-0">
								<td className="py-2">{row.label}</td>
								<td className="py-2 text-muted-foreground">{shortDate(row.date)}</td>
								<td className="py-2 text-right font-medium tabular-nums">{row.value}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
}
