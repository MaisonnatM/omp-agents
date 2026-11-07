/**
 * What the Sport module derives from its state, the same for the page and the agent: a week's workouts with each
 * exercise's load, the pain flags, the best grade per week, the records, and how many planned workouts were done.
 * Every date is a `YYYY-MM-DD` day, counted on the calendar alone. A skipped log adds no load, climb, or record.
 */
import { addDays, DAY_KEYS, type DayKey, daysBetween, mondayOf, weekdayOf } from "./shared/days";
import { type ClimbKind, type Exercise, type FrenchGrade, gradeRank, type Measurement, type PainPlace, type Phase, type Plan, type Slot, type SportState, type Workout, type WorkoutLog } from "./shared/sport";

/** The pain, out of 10, from which a log flags it. */
export const PAIN_FLAG_LEVEL = 3;

/** The days a pain flag holds after its log, during which a finger flag removes the hangs. */
export const PAIN_FLAG_DAYS = 7;

/** Kilograms added and where they come from: the log that lifted them, or the rule with the day of the max it read, `null` for a fixed rule. */
export type Load = { kg: number; from: "log"; logId: string; date: string } | { kg: number; from: "rule"; measuredAt: string | null };

export interface PlannedExercise {
	exercise: Exercise;
	/** From {@link loadFor}. */
	load: Load | null;
	/** A hang a recent finger pain flag removes. */
	removed: boolean;
}

export interface PlannedWorkout extends Omit<Workout, "blocks"> {
	optional: boolean;
	blocks: { title: string; items: PlannedExercise[] }[];
	/** The day's log of this workout, done or skipped, `null` until there is one. */
	log: WorkoutLog | null;
}

export interface PlannedDay {
	date: string;
	weekday: DayKey;
	phase: Phase | null;
	deload: boolean;
	/** The plan replaces this day's phase slots, as on a test day. */
	override: boolean;
	workouts: PlannedWorkout[];
}

export interface PainFlag {
	logId: string;
	date: string;
	level: number;
	where: PainPlace;
	/** The last day the flag holds. */
	until: string;
}

export interface WeekGrades {
	monday: string;
	boulder: FrenchGrade | null;
	route: FrenchGrade | null;
}

export interface SportRecords {
	/** The best value of each metric measured, by the metric's `better`, first reached on `at`. */
	metrics: { metric: string; value: number; at: string }[];
	/** The heaviest load logged for each exercise key, first reached on `date`. */
	loads: { key: string; kg: number; date: string }[];
	/** The hardest grade sent, first on `date`. */
	grades: Record<ClimbKind, { grade: FrenchGrade; date: string } | null>;
}

export interface Adherence {
	planned: number;
	done: number;
	/** `done / planned`, `null` when nothing was planned. */
	ratio: number | null;
}

/** The phase `date` falls in, start and end included. */
export const phaseOn = (plan: Plan, date: string): Phase | null => plan.phases.find(({ start, end }) => start <= date && date <= end) ?? null;

/** The newest measurement of `metric` on or before `date`. */
const measured = (state: SportState, metric: string, date: string): Measurement | undefined => state.measurements.findLast(entry => entry.metric === metric && entry.at <= date);

/**
 * The load `exercise` calls for on `date`, `null` when unknown. The newest load logged done for it before `date` wins
 * while the plan stays in the same phase and no newer measurement of its rule's metric came since; otherwise the rule
 * gives it from the newest measurements on or before `date`.
 */
export function loadFor(state: SportState, exercise: Exercise, date: string): Load | null {
	const rule = exercise.load;
	const logged = state.log.findLast(log => log.status === "done" && log.date < date && Object.hasOwn(log.loads, exercise.key));
	const { plan } = state;
	const phase = plan && phaseOn(plan, date);
	if (logged && plan && phase && phaseOn(plan, logged.date)?.id === phase.id) {
		const tested = rule?.kind === "of-max" ? measured(state, rule.metric, date) : undefined;
		if (!tested || logged.date >= tested.at) return { kg: logged.loads[exercise.key]!, from: "log", logId: logged.id, date: logged.date };
	}
	if (!rule) return null;
	if (rule.kind === "fixed") return { kg: rule.kg, from: "rule", measuredAt: null };
	const max = measured(state, rule.metric, date);
	const less = rule.less === null ? 0 : measured(state, rule.less, date)?.value;
	return max && less !== undefined ? { kg: Math.round(rule.fraction * max.value - less + rule.offsetKg), from: "rule", measuredAt: max.at } : null;
}

/** The phase of `date`, whether its week is a deload week, and its slots: the plan's override for the day, else the phase's. */
function slotsOn(plan: Plan | null, date: string): { phase: Phase | null; deload: boolean; override: boolean; slots: Slot[] } {
	const phase = plan && phaseOn(plan, date);
	const deload = phase !== null && phase.deloadMondays.includes(mondayOf(date));
	const override = plan?.overrides.find(entry => entry.date === date);
	if (override) return { phase, deload, override: true, slots: override.slots };
	return { phase, deload, override: false, slots: phase ? (deload ? phase.deloadWeek : phase.week)[weekdayOf(date)] : [] };
}

const logOf = (state: SportState, date: string, workout: string): WorkoutLog | null => state.log.find(log => log.date === date && log.workout === workout) ?? null;

/** The pain flags of the logs from `from` to `to`, oldest first. */
function flagsBetween(state: SportState, from: string, to: string): PainFlag[] {
	return state.log.flatMap(({ id, date, pain }) =>
		pain && pain.level >= PAIN_FLAG_LEVEL && from <= date && date <= to ? [{ logId: id, date, level: pain.level, where: pain.where, until: addDays(date, PAIN_FLAG_DAYS) }] : [],
	);
}

/** The pain flags that hold on `date`: those of the logs from {@link PAIN_FLAG_DAYS} days before it to that day, oldest first. */
export const painFlags = (state: SportState, date: string): PainFlag[] => flagsBetween(state, addDays(date, -PAIN_FLAG_DAYS), date);

/** `date` with its workouts, their loads, and the hangs a finger pain flag among `flags` removes. */
function planDay(state: SportState, date: string, flags: PainFlag[]): PlannedDay {
	const { plan } = state;
	const { phase, deload, override, slots } = slotsOn(plan, date);
	const fingersRest = flags.some(flag => flag.where === "fingers" && flag.date < date && date <= flag.until);
	const workouts = slots.flatMap(({ workout: id, optional }) => {
		const workout = plan?.workouts.find(entry => entry.id === id);
		if (!workout) return [];
		const blocks = workout.blocks.map(({ title, items }) => ({
			title,
			items: items.map(exercise => ({ exercise, load: loadFor(state, exercise, date), removed: exercise.hang && fingersRest })),
		}));
		return [{ ...workout, optional, blocks, log: logOf(state, date, id) }];
	});
	return { date, weekday: weekdayOf(date), phase, deload, override, workouts };
}

/** One day of the plan, with its workouts, their loads, and the hangs a finger pain flag removes. */
export const dayPlan = (state: SportState, date: string): PlannedDay => planDay(state, date, painFlags(state, date));

/** The seven days of the week `day` falls in, Monday first, each as {@link dayPlan} gives it. */
export function weekPlan(state: SportState, day: string): PlannedDay[] {
	const monday = mondayOf(day);
	const flags = flagsBetween(state, addDays(monday, -PAIN_FLAG_DAYS), addDays(monday, DAY_KEYS.length - 1));
	return DAY_KEYS.map((_, i) => planDay(state, addDays(monday, i), flags));
}

/** The hardest boulder and route sent each week from `from` to `to`, a week with none `null`, oldest week first. */
export function bestGrades(state: SportState, from: string, to: string): WeekGrades[] {
	const weeks = new Map<string, WeekGrades>();
	for (let monday = mondayOf(from); monday <= to; monday = addDays(monday, 7)) weeks.set(monday, { monday, boulder: null, route: null });
	for (const { date, status, climbs } of state.log) {
		const week = status === "done" && from <= date && date <= to ? weeks.get(mondayOf(date)) : undefined;
		if (!week) continue;
		for (const { kind, grade } of climbs) {
			const best = week[kind];
			if (best === null || gradeRank(grade) > gradeRank(best)) week[kind] = grade;
		}
	}
	return [...weeks.values()];
}

/** The best of each metric, each logged load, and each kind of climb, with the day each was first reached. */
export function records(state: SportState): SportRecords {
	const lower = new Set(state.metrics.flatMap(({ id, better }) => (better === "lower" ? [id] : [])));
	const metrics = new Map<string, { metric: string; value: number; at: string }>();
	for (const { metric, value, at } of state.measurements) {
		const best = metrics.get(metric);
		if (!best || (lower.has(metric) ? value < best.value : value > best.value)) metrics.set(metric, { metric, value, at });
	}
	const loads = new Map<string, { key: string; kg: number; date: string }>();
	const grades: SportRecords["grades"] = { boulder: null, route: null };
	for (const { date, status, loads: logged, climbs } of state.log) {
		if (status !== "done") continue;
		for (const [key, kg] of Object.entries(logged)) {
			const best = loads.get(key);
			if (!best || kg > best.kg) loads.set(key, { key, kg, date });
		}
		for (const { kind, grade } of climbs) {
			const best = grades[kind];
			if (!best || gradeRank(grade) > gradeRank(best.grade)) grades[kind] = { grade, date };
		}
	}
	return { metrics: [...metrics.values()], loads: [...loads.values()], grades };
}

/** How many workouts were planned from `from` to `to` and how many of them were done; an optional one counts only once done. */
export function adherence(state: SportState, from: string, to: string): Adherence {
	let planned = 0;
	let done = 0;
	for (const date of daysBetween(from, to)) {
		for (const { workout, optional } of slotsOn(state.plan, date).slots) {
			const did = logOf(state, date, workout)?.status === "done";
			if (did) done++;
			if (did || !optional) planned++;
		}
	}
	return { planned, done, ratio: planned ? done / planned : null };
}
