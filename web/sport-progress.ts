/** How the Sport page's progress tab reads the state: its cards, the chart of the one picked against its target, and how far back the chart reaches. */
import { addDays, mondayOf } from "../src/shared/days";
import type { ChartSpec } from "../src/shared/session-visuals";
import { type ClimbKind, CLIMB_KINDS, FRENCH_GRADES, gradeRank, type Metric, type Plan, type SportState, type Target } from "../src/shared/sport";
import { adherence, bestGrades, type WeekGrades } from "../src/sport-week";
import { amount, BEST_CLIMB_LABEL, bodyweightOf, CLIMB_LABEL, measured, nextTest, shortDate, signedAmount } from "./sport-view";
import type { ChartReference } from "./components/session-chart";

/** How far back the chart reaches, in weeks; `null` for everything. */
export const RANGES = [
	{ id: "8", label: "8 sem.", weeks: 8 },
	{ id: "12", label: "12 sem.", weeks: 12 },
	{ id: "all", label: "Tout", weeks: null },
] as const;
export type Range = (typeof RANGES)[number];

/** The first Monday `range` reaches back to from `today`, `null` for everything. */
export const rangeStart = (range: Range, today: string): string | null => (range.weeks === null ? null : addDays(mondayOf(today), -7 * (range.weeks - 1)));

/** What a card shows and the chart draws: a metric, the best grade of a kind of climb, or how much of the plan was done. */
export type Figure = { kind: "metric"; metric: Metric } | { kind: "grade"; climb: ClimbKind } | { kind: "plan" };

export const figureId = (figure: Figure): string => (figure.kind === "metric" ? `metric-${figure.metric.id}` : figure.kind === "grade" ? figure.climb : "plan");

export interface Card {
	figure: Figure;
	label: string;
	value: string;
	detail: string;
}

/** The day the plan's first phase starts, `null` with no plan. */
export const planStart = (plan: Plan | null): string | null => plan?.phases.map(phase => phase.start).sort()[0] ?? null;

/** The target set on `figure`, `null` for none: the plan has no target. */
export const targetOf = (state: SportState, figure: Figure): Target | null =>
	state.targets.find(entry => (figure.kind === "metric" ? entry.kind === "metric" && entry.metric === figure.metric.id : figure.kind === "grade" && entry.kind === figure.climb)) ?? null;

/** The rank of the hardest `climb` sent across `weeks`, `-1` for none. */
const bestRank = (weeks: WeekGrades[], climb: ClimbKind): number => weeks.reduce((top, week) => Math.max(top, week[climb] ? gradeRank(week[climb]) : -1), -1);

/** The cards in the order the tab lays them: each metric but the bodyweight, the best grade of each kind of climb over 8 weeks, the bodyweight, and the plan followed. */
export function progressCards(state: SportState, today: string): Card[] {
	const bodyweight = bodyweightOf(state);
	const recent = bestGrades(state, addDays(mondayOf(today), -49), today);
	const start = planStart(state.plan);
	const followed = start !== null && start <= today ? adherence(state, start, today) : null;
	return [
		...state.metrics.filter(metric => metric.id !== bodyweight?.id).map(metric => metricCard(state, metric, today, false)),
		...CLIMB_KINDS.map((climb): Card => {
			const best = bestRank(recent, climb);
			const goal = targetOf(state, { kind: "grade", climb });
			return { figure: { kind: "grade", climb }, label: `${BEST_CLIMB_LABEL[climb]} · 8 sem.`, value: best === -1 ? "—" : FRENCH_GRADES[best]!, detail: goal && goal.kind !== "metric" ? `objectif ${goal.grade}` : "aucun objectif" };
		}),
		...(bodyweight ? [metricCard(state, bodyweight, today, true)] : []),
		{ figure: { kind: "plan" }, label: "Plan suivi", value: followed?.ratio == null ? "—" : `${Math.round(followed.ratio * 100)} %`, detail: followed ? `${followed.done} séances sur ${followed.planned}` : "le plan n'a pas commencé" },
	];
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
				? `${signedAmount(last.value - first.value, metric.unit)} depuis ${shortDate(first.at)}`
				: `le ${shortDate(last.at)}`;
	return { figure: { kind: "metric", metric }, label: metric.label, value: last ? amount(last.value, metric.unit) : "—", detail };
}

export interface Chart {
	title: string;
	sentence: string | null;
	spec: ChartSpec;
	reference?: ChartReference;
	format: (value: number) => string;
	/** What the chart says with nothing to draw. */
	empty: string;
}

const line = (series: ChartSpec["series"], data: ChartSpec["data"]): ChartSpec => ({ type: "line", title: null, description: null, x: "day", series, data });

/** The chart of `figure` from `from`, `null` for everything, to `today`, with its target as a labeled line across it. */
export function chartOf(state: SportState, figure: Figure, from: string | null, today: string): Chart {
	const goal = targetOf(state, figure);
	switch (figure.kind) {
		case "metric": {
			const { metric } = figure;
			const all = measured(state, metric.id);
			const rows = all.filter(({ at }) => at <= today && (from === null || at >= from));
			const value = goal?.kind === "metric" ? goal.value : null;
			const last = all.at(-1);
			const first = all[0];
			const test = nextTest(state, metric.id, today);
			const parts = [
				last && first && first !== last ? `${signedAmount(last.value - first.value, metric.unit)} depuis le ${shortDate(first.at)}` : null,
				last && value !== null ? (metric.better === "higher" ? last.value >= value : last.value <= value) ? "Objectif atteint" : `Il te reste ${amount(Math.abs(value - last.value), metric.unit)} pour atteindre ${amount(value, metric.unit)}${goal?.by ? ` d'ici le ${shortDate(goal.by)}` : ""}` : null,
				test ? `Prochain test le ${shortDate(test)}` : null,
			];
			return {
				title: metric.label,
				sentence: parts.flatMap(part => (part ? [part.endsWith(".") ? part : `${part}.`] : [])).join(" ") || null,
				spec: line([{ key: "value", label: metric.label }], rows.map(row => ({ day: shortDate(row.at), value: row.value }))),
				reference: value === null ? undefined : { value, label: `Objectif ${amount(value, metric.unit)}` },
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
				reference: aim ? { value: gradeRank(aim), label: `Objectif ${aim}` } : undefined,
				format: rank => FRENCH_GRADES[Math.round(rank)] ?? "",
				empty: climb === "boulder" ? "Aucun bloc réussi sur la période." : "Aucune voie réussie sur la période.",
			};
		}
		case "plan": {
			const start = planStart(state.plan);
			const data = [];
			if (start !== null && start <= today) {
				for (let monday = mondayOf(from && from > start ? from : start); monday <= today; monday = addDays(monday, 7)) {
					const { planned, done } = adherence(state, monday, addDays(monday, 6) < today ? addDays(monday, 6) : today);
					data.push({ day: shortDate(monday), planned, done });
				}
			}
			return {
				title: "Séances faites par semaine",
				sentence: null,
				spec: { type: "bar", title: null, description: null, x: "day", series: [{ key: "planned", label: "Prévues" }, { key: "done", label: "Faites" }], data },
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
