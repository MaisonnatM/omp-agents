/** The Sport page's progress: the cards of each figure, the chart of the one picked against its target, and the records. */
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { lazy, Suspense, useState } from "react";
import { addDays, mondayOf } from "../../../src/shared/days";
import type { ChartSpec } from "../../../src/shared/session-visuals";
import { type ClimbKind, CLIMB_KINDS, FRENCH_GRADES, gradeRank, type Metric, type SportState } from "../../../src/shared/sport";
import { adherence, bestGrades, records, type WeekGrades } from "../../../src/sport-week";
import { activityControl } from "../../activity";
import { amount, BEST_CLIMB_LABEL, bodyweightOf, CLIMB_LABEL, measured, nextTest, recordRows, shortDate } from "../../sport-view";
import { SegmentedTab, SegmentedTabs, SegmentedTabsList } from "../segmented-tabs";

// `recharts` is a chunk of its own, loaded when the first chart draws.
const ChartView = lazy(() => import("../session-chart").then(module => ({ default: module.ChartView })));

/** How far back the chart reaches, in weeks; `null` for everything. */
const RANGES: Record<"8" | "12" | "all", { label: string; weeks: number | null }> = {
	"8": { label: "8 sem.", weeks: 8 },
	"12": { label: "12 sem.", weeks: 12 },
	all: { label: "Tout", weeks: null },
};
type Range = keyof typeof RANGES;

/** What a card shows and the chart draws: a metric, the best grade of a kind of climb, or how much of the plan was done. */
type Figure = { kind: "metric"; metric: Metric } | { kind: "grade"; climb: ClimbKind } | { kind: "plan" };

const figureId = (figure: Figure): string => (figure.kind === "metric" ? `metric-${figure.metric.id}` : figure.kind === "grade" ? figure.climb : "plan");

interface Card {
	figure: Figure;
	label: string;
	value: string;
	detail: string;
}

/** The rank of the hardest `climb` sent across `weeks`, `-1` for none. */
const bestRank = (weeks: WeekGrades[], climb: ClimbKind): number => weeks.reduce((top, week) => Math.max(top, week[climb] ? gradeRank(week[climb]) : -1), -1);

export function ProgressTab({ state, today }: { state: SportState; today: string }) {
	const [picked, setPicked] = useState<string | null>(null);
	const [range, setRange] = useState<Range>("all");
	const bodyweight = bodyweightOf(state);
	const recent = bestGrades(state, addDays(mondayOf(today), -49), today);
	const start = state.plan?.phases.map(phase => phase.start).sort()[0] ?? null;
	const followed = start !== null && start <= today ? adherence(state, start, today) : null;
	const target = (figure: Figure) => state.targets.find(entry => (figure.kind === "metric" ? entry.kind === "metric" && entry.metric === figure.metric.id : figure.kind === "grade" && entry.kind === figure.climb)) ?? null;

	const cards: Card[] = [
		...state.metrics.filter(metric => metric.id !== bodyweight?.id).map(metric => metricCard(state, metric, today, false)),
		...CLIMB_KINDS.map((climb): Card => {
			const best = bestRank(recent, climb);
			const goal = target({ kind: "grade", climb });
			return { figure: { kind: "grade", climb }, label: `${BEST_CLIMB_LABEL[climb]} · 8 sem.`, value: best === -1 ? "—" : FRENCH_GRADES[best]!, detail: goal && goal.kind !== "metric" ? `objectif ${goal.grade}` : "aucun objectif" };
		}),
		...(bodyweight ? [metricCard(state, bodyweight, today, true)] : []),
		{ figure: { kind: "plan" }, label: "Plan suivi", value: followed?.ratio == null ? "—" : `${Math.round(followed.ratio * 100)} %`, detail: followed ? `${followed.done} séances sur ${followed.planned}` : "le plan n'a pas commencé" },
	];
	const card = cards.find(entry => figureId(entry.figure) === picked) ?? cards[0]!;
	const { weeks } = RANGES[range];
	const from = weeks === null ? null : addDays(mondayOf(today), -7 * (weeks - 1));
	const chart = chartOf(state, card.figure, from, today, target(card.figure));
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 @3xl/sport:px-6">
			<RadioGroup aria-label="Mesures" value={figureId(card.figure)} onValueChange={next => setPicked(cards.map(entry => figureId(entry.figure)).find(id => id === next) ?? picked)} className="grid grid-cols-2 gap-3 @4xl/sport:grid-cols-5">
				{cards.map(entry => (
					<Radio.Root key={figureId(entry.figure)} value={figureId(entry.figure)} {...activityControl("sport.progress.card")} className="flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:ring-1 data-[checked]:ring-primary">
						<span className="max-w-full truncate text-xs text-muted-foreground">{entry.label}</span>
						<span className="text-2xl font-semibold tabular-nums">{entry.value}</span>
						<span className="max-w-full truncate text-xs text-muted-foreground">{entry.detail}</span>
					</Radio.Root>
				))}
			</RadioGroup>
			<section aria-label={chart.title} className="flex flex-col gap-3 rounded-xl border border-border p-4">
				<header className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="text-sm font-semibold">{chart.title}</h2>
						{chart.sentence && <p className="text-xs text-muted-foreground">{chart.sentence}</p>}
					</div>
					<SegmentedTabs value={range} onValueChange={value => setRange(value as Range)} activationMode="manual">
						<SegmentedTabsList aria-label="Période">
							{(Object.keys(RANGES) as Range[]).map(key => (
								<SegmentedTab key={key} value={key} {...activityControl("sport.progress.range")}>{RANGES[key].label}</SegmentedTab>
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

/** A metric's card: its last value and how far it moved since the first, or, for the bodyweight, its four-week average. */
function metricCard(state: SportState, metric: Metric, today: string, average: boolean): Card {
	const rows = measured(state, metric.id).filter(({ at }) => at <= today);
	const last = rows.at(-1);
	const first = rows[0];
	const month = rows.filter(({ at }) => at > addDays(today, -28));
	const detail = !last
		? "aucune mesure"
		: average
			? month.length ? `moyenne 4 sem. ${amount(month.reduce((sum, { value }) => sum + value, 0) / month.length, metric.unit)}` : `le ${shortDate(last.at)}`
			: first && first !== last
				? `${last.value >= first.value ? "+" : "−"}${amount(Math.abs(last.value - first.value), metric.unit)} depuis ${shortDate(first.at)}`
				: `le ${shortDate(last.at)}`;
	return { figure: { kind: "metric", metric }, label: metric.label, value: last ? amount(last.value, metric.unit) : "—", detail };
}

interface Chart {
	title: string;
	sentence: string | null;
	spec: ChartSpec;
	reference: { value: number; label: string } | null;
	format: (value: number) => string;
	/** What the chart says with nothing to draw. */
	empty: string;
}

const line = (series: ChartSpec["series"], data: ChartSpec["data"]): ChartSpec => ({ type: "line", title: null, description: null, x: "day", series, data });

/** The chart of `figure` from `from`, `null` for everything, to `today`, with `goal` as a labeled line across it. */
function chartOf(state: SportState, figure: Figure, from: string | null, today: string, goal: SportState["targets"][number] | null): Chart {
	switch (figure.kind) {
		case "metric": {
			const { metric } = figure;
			const rows = measured(state, metric.id).filter(({ at }) => at <= today && (from === null || at >= from));
			const value = goal?.kind === "metric" ? goal.value : null;
			const series = [{ key: "value", label: metric.label }];
			const all = measured(state, metric.id);
			const last = all.at(-1);
			const first = all[0];
			const test = nextTest(state, metric.id, today);
			const parts = [
				last && first && first !== last ? `${last.value >= first.value ? "+" : "−"}${amount(Math.abs(last.value - first.value), metric.unit)} depuis le ${shortDate(first.at)}` : null,
				last && value !== null ? (metric.better === "higher" ? last.value >= value : last.value <= value) ? "Objectif atteint" : `Il te reste ${amount(Math.abs(value - last.value), metric.unit)} pour atteindre ${amount(value, metric.unit)}${goal?.by ? ` d'ici le ${shortDate(goal.by)}` : ""}` : null,
				test ? `Prochain test le ${shortDate(test)}` : null,
			];
			return {
				title: metric.label,
				sentence: parts.flatMap(part => (part ? [part.endsWith(".") ? part : `${part}.`] : [])).join(" ") || null,
				spec: line(series, rows.map(row => ({ day: shortDate(row.at), value: row.value }))),
				reference: value === null ? null : { value, label: `Objectif ${amount(value, metric.unit)}` },
				format: kg => amount(kg, metric.unit),
				empty: `Aucune mesure de ${metric.label.toLowerCase()} sur la période.`,
			};
		}
		case "grade": {
			const { climb } = figure;
			const first = state.log.map(({ date }) => date).sort()[0] ?? today;
			const weeks = bestGrades(state, from ?? first, today);
			const aim = goal && goal.kind === climb ? goal.grade : null;
			const best = bestRank(weeks, climb);
			const label = BEST_CLIMB_LABEL[climb];
			return {
				title: `${label} par semaine`,
				sentence: best === -1 ? null : `${label} sur la période : ${FRENCH_GRADES[best]}${aim ? `, objectif ${aim}` : ""}.`,
				spec: best === -1 ? line([], []) : line([{ key: "grade", label: CLIMB_LABEL[climb] }], weeks.map(week => ({ day: shortDate(week.monday), ...(week[climb] ? { grade: gradeRank(week[climb]) } : {}) }))),
				reference: aim ? { value: gradeRank(aim), label: `Objectif ${aim}` } : null,
				format: rank => FRENCH_GRADES[Math.round(rank)] ?? "",
				empty: climb === "boulder" ? "Aucun bloc réussi sur la période." : "Aucune voie réussie sur la période.",
			};
		}
		case "plan": {
			const start = state.plan?.phases.map(phase => phase.start).sort()[0] ?? today;
			const data = [];
			for (let monday = mondayOf(from && from > start ? from : start); monday <= today; monday = addDays(monday, 7)) {
				const { planned, done } = adherence(state, monday, addDays(monday, 6) < today ? addDays(monday, 6) : today);
				data.push({ day: shortDate(monday), planned, done });
			}
			return {
				title: "Séances faites par semaine",
				sentence: null,
				spec: { type: "bar", title: null, description: null, x: "day", series: [{ key: "planned", label: "Prévues" }, { key: "done", label: "Faites" }], data },
				reference: null,
				format: count => String(count),
				empty: "Le plan n'a pas encore commencé.",
			};
		}
		default: {
			const never: never = figure;
			return never;
		}
	}
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
