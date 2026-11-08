/** How the Sport page words and colors what `src/sport-week.ts` computes: scale words, workout colors, loads, doses, and the exercises a demo opens. */
import { addDays, daysApart, mondayOf } from "../src/shared/days";
import { type Climb, CLIMB_KINDS, type ClimbKind, type Exercise, exercisesOf, gradeRank, type Measurement, type Metric, PAIN_PLACES, type PainPlace, type Phase, type Place, type Plan, type SportChange, type SportState, type Workout, type WorkoutLog } from "../src/shared/sport";
import { applySport } from "../src/sport";
import { bodyweightMetric, type Load, PAIN_FLAG_DAYS, PAIN_FLAG_LEVEL, type PlannedDay, type PlannedExercise, type PlannedWorkout, records, removesHangs, type SportRecords, testedMetric } from "../src/sport-week";

/** The word under a pain level, 0 to 10. */
export function painWord(level: number): string {
	if (level === 0) return "Aucune";
	if (level <= 2) return "Gêne légère";
	if (level <= 5) return "Douleur nette";
	if (level <= 7) return "Forte";
	return "Arrête";
}

/** The word under an effort, 1 to 10. */
export function effortWord(rpe: number): string {
	if (rpe <= 3) return "Facile";
	if (rpe <= 6) return "Modéré";
	if (rpe <= 8) return "Dur";
	if (rpe === 9) return "Très dur";
	return "Maximal";
}

/** Each kind of workout's chart color, the stripe of its day and log. */
export const KIND_COLOR: Record<Workout["kind"], string> = {
	hangboard: "var(--chart-1)",
	boulder: "var(--chart-2)",
	hip: "var(--chart-3)",
	route: "var(--chart-4)",
	strength: "var(--chart-5)",
};

export const KIND_LABEL: Record<Workout["kind"], string> = { hangboard: "Poutre", boulder: "Bloc", hip: "Hanche", route: "Voie", strength: "Force" };

export const PLACE_LABEL: Record<Place, string> = { home: "Maison", gym: "Salle", outdoor: "Dehors" };

export const PAIN_PLACE_LABEL: Record<PainPlace, string> = { fingers: "Doigts", elbow: "Coude", shoulder: "Épaule", hip: "Hanche", other: "Autre" };

/** A pain place after « douleur », as in « douleur aux doigts ». */
export const PAIN_PLACE_AT: Record<PainPlace, string> = { fingers: "aux doigts", elbow: "au coude", shoulder: "à l'épaule", hip: "à la hanche", other: "ailleurs" };

/** How the page words the pain rule {@link removesHangs} decides for a flag at `where`: the warning before it is logged, and what it does while it holds. */
export function painRule(where: PainPlace): { warning: string; effect: string } {
	const at = `Douleur ${PAIN_PLACE_AT[where]} à ${PAIN_FLAG_LEVEL} ou plus`;
	return removesHangs(where)
		? { warning: `${at} : la poutre sera retirée ${PAIN_FLAG_DAYS} jours.`, effect: "Poutre et suspensions retirées" }
		: { warning: `${at} : elle sera signalée ${PAIN_FLAG_DAYS} jours.`, effect: "À surveiller" };
}

/** Under a hang a pain flag removed: `retiré · douleur aux doigts`. */
export const REMOVED_TEXT = `retiré · douleur ${PAIN_PLACES.filter(removesHangs).map(where => PAIN_PLACE_AT[where]).join(" ou ")}`;

export const CLIMB_LABEL: Record<ClimbKind, string> = { boulder: "Bloc", route: "Voie" };

/** A kind of climb's best, as a record or a progress card names it. */
export const BEST_CLIMB_LABEL: Record<ClimbKind, string> = { boulder: "Meilleur bloc", route: "Meilleure voie" };

/** The hold colors of the Arkose gyms, which tag a boulder and never a workout: the word a climb keeps, its label, and the dot that draws it. */
export const ARKOSE_COLORS = [
	{ value: "vert", label: "Vert", dot: "green" },
	{ value: "bleu", label: "Bleu", dot: "blue" },
	{ value: "rouge", label: "Rouge", dot: "red" },
	{ value: "noir", label: "Noir", dot: "#262626" },
	{ value: "violet", label: "Violet", dot: "violet" },
	{ value: "blanc", label: "Blanc", dot: "#e5e5e5" },
] as const satisfies readonly { value: string; label: string; dot: string }[];

/** The Arkose color a climb is tagged with; `undefined` for none, or for a word the agent wrote that the list lacks. */
export const arkoseColor = (value: string | null) => ARKOSE_COLORS.find(color => color.value === value);

const SHORT_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const LONG_DATE = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const DAY_OF_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric" });
const DAY_MONTH = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

const local = (date: string): Date => new Date(`${date}T00:00`);

/** `2026-12-08` as `8 déc.` */
export const shortDate = (date: string): string => SHORT_DATE.format(local(date));
/** `2026-12-15` as `mardi 15 décembre`. */
export const longDate = (date: string): string => LONG_DATE.format(local(date));
/** `2026-12-15` as `Mar`. */
export const weekdayShort = (date: string): string => {
	const word = WEEKDAY.format(local(date)).replace(".", "");
	return word.charAt(0).toUpperCase() + word.slice(1);
};
/** `2026-12-15` as `15`. */
export const dayOfMonth = (date: string): string => DAY_OF_MONTH.format(local(date));

/** The week `monday` starts, as `Semaine du 14 au 20 déc.` */
export function weekTitle(monday: string): string {
	const sunday = addDays(monday, 6);
	const from = monday.slice(5, 7) === sunday.slice(5, 7) ? dayOfMonth(monday) : DAY_MONTH.format(local(monday));
	return `Semaine du ${from} au ${shortDate(sunday)}`;
}

/** Minutes as the day list shows them: `25 min`, `≈ 2 h`, `≈ 1 h 30`. */
export function duration(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const rest = minutes % 60;
	return `≈ ${Math.floor(minutes / 60)} h${rest ? ` ${rest}` : ""}`;
}

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** A value with its unit, French style: `113,3 kg`. */
export const amount = (value: number, unit: string): string => `${NUMBER.format(value)} ${unit}`.trim();

/** A difference with its sign: `+7 kg`, `−1,5 kg`. */
export const signedAmount = (delta: number, unit: string): string => `${delta >= 0 ? "+" : "−"}${amount(Math.abs(delta), unit)}`;

/** Kilograms added to the body: `+15 kg`, `−5 kg` with a pulley, `poids du corps` at zero. */
export const signedKg = (kg: number): string => (kg === 0 ? "poids du corps" : signedAmount(kg, "kg"));

/** The load an exercise shows: the kilograms, « charge à tester » when its rule lacks a measurement, nothing when it takes no load. */
export function loadText(exercise: Exercise, load: Load | null): string | null {
	if (load) return signedKg(load.kg);
	return exercise.load ? "charge à tester" : null;
}

/** Where a load comes from, under the exercise: the last log, or the test its rule read; nothing for a fixed load. */
export function loadSource(load: Load | null): string | null {
	if (!load) return null;
	if (load.from === "log") return `Dernière fois ${signedKg(load.kg)} · ${shortDate(load.date)}`;
	return load.measuredAt ? `D'après le test du ${shortDate(load.measuredAt)}` : null;
}

const seconds = (sec: number): string => (sec >= 60 && sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);

/** An exercise's sets, reps or hold, and rest: `5 × 10 s · 3 min de repos`. */
export function dose(exercise: Exercise): string {
	const { sets, reps, holdSec, restSec } = exercise;
	const each = reps !== null ? String(reps) : holdSec !== null ? seconds(holdSec) : null;
	const parts = [sets !== null && each !== null ? `${sets} × ${each}` : sets !== null ? `${sets} séries` : each];
	if (restSec !== null) parts.push(`${seconds(restSec)} de repos`);
	return parts.filter(part => part !== null).join(" · ");
}

/** The exercises `exercise` opens as, such as « Mobilité hanche »'s three, else itself; a key the plan lacks drops. */
export function opening(plan: Plan, exercise: Exercise): Exercise[] {
	if (exercise.opensAs.length === 0) return [exercise];
	const all = exercisesOf(plan);
	return exercise.opensAs.flatMap(key => all.find(other => other.key === key && other.opensAs.length === 0) ?? []);
}

/** The exercises of `items` that have a demo, each opened as {@link opening} gives it, in order. */
export const demosOf = (plan: Plan, items: Exercise[]): Exercise[] => items.flatMap(item => opening(plan, item)).filter(exercise => exercise.demo !== null);

/** A workout's blocks as the day shows them: each row with where its first demo sits in `demos`, `null` for none. */
export interface WorkoutDemos {
	demos: Exercise[];
	blocks: { title: string; rows: { item: PlannedExercise; at: number | null }[] }[];
}

/** The demos of a workout, every block in order, and its blocks with each row's place among them. */
export function workoutDemos(plan: Plan, workout: PlannedWorkout): WorkoutDemos {
	const demos: Exercise[] = [];
	const blocks = workout.blocks.map(({ title, items }) => ({
		title,
		rows: items.map(item => {
			const own = demosOf(plan, [item.exercise]);
			const at = own.length > 0 ? demos.length : null;
			demos.push(...own);
			return { item, at };
		}),
	}));
	return { demos, blocks };
}

/** Where a phase's week falls: its number, the phase's count of weeks, and whether it is a deload week. */
export function phaseWeek(phase: Phase, date: string): { week: number; weeks: number; deload: boolean } {
	const first = mondayOf(phase.start);
	return {
		week: daysApart(first, mondayOf(date)) / 7 + 1,
		weeks: Math.ceil((daysApart(first, phase.end) + 1) / 7),
		deload: phase.deloadMondays.includes(mondayOf(date)),
	};
}

/** A phase's week as the page's header and the day list show it: `transition · semaine 2 sur 3 · allégée`. */
export function phaseLabel(phase: Phase, date: string): string {
	const { week, weeks, deload } = phaseWeek(phase, date);
	return `${phase.name} · semaine ${week} sur ${weeks}${deload ? " · allégée" : ""}`;
}

/** One day as the day list shows it. */
export interface DaySummary {
	title: string;
	/** `null` on a rest day. */
	kind: Workout["kind"] | null;
	/** `option · ≈ 2 h`, `≈ 2 h · +15 kg`, `≈ 2 h · poutre retirée`. */
	detail: string;
	/** Every workout not optional is logged done, and there is at least one. */
	done: boolean;
}

export function daySummary(day: PlannedDay): DaySummary {
	if (day.workouts.length === 0) return { title: "Repos", kind: null, detail: "", done: false };
	const required = day.workouts.filter(({ optional }) => !optional);
	const main = required.length ? required : day.workouts;
	const longest = main.reduce((best, workout) => (workout.minutes > best.minutes ? workout : best));
	const items = main.flatMap(({ blocks }) => blocks.flatMap(block => block.items));
	const removed = items.some(item => item.removed);
	const load = items.find(item => item.load && !item.removed)?.load;
	const optional = main.every(workout => workout.optional);
	const detail = [optional ? "option" : null, duration(main.reduce((sum, { minutes }) => sum + minutes, 0)), removed ? "poutre retirée" : load ? signedKg(load.kg) : null];
	return {
		title: main.map(({ name }) => name).join(" + "),
		kind: longest.kind,
		detail: detail.filter(part => part !== null).join(" · "),
		done: main.every(workout => workout.optional || workout.log?.status === "done") && main.some(workout => workout.log?.status === "done"),
	};
}

/** A test of a metric on a test day: the exercise whose key is the metric's id, and the bodyweight its loads subtract. */
export interface TestOf {
	exercise: Exercise;
	metric: Metric;
	/** The bodyweight, as {@link bodyweightOf} finds it. */
	bodyweight: Metric | null;
}

/** The test `workout` holds, as {@link testedMetric} finds it, `null` when it holds none. */
export function testOf(state: SportState, workout: PlannedWorkout): TestOf | null {
	const planned = workoutOf(state.plan, workout.id);
	const tested = planned ? testedMetric(state, planned) : null;
	return tested && { ...tested, bodyweight: bodyweightOf(state) };
}

/** A record a save beat, with the best before it. */
export interface Beaten {
	label: string;
	now: string;
	/** `null` for a first. */
	was: string | null;
}

/** One record as the progress table and the summary word it, keyed by what it measures. */
export interface RecordRow {
	key: string;
	label: string;
	value: string;
	/** The day it was first reached. */
	date: string;
}

const metricRow = (metric: string): string => `metric-${metric}`;
const loadRow = (key: string): string => `load-${key}`;

/** The records of `best`, each worded: metrics, then the hardest grade of each kind of climb, then loads. */
export function recordRows(state: SportState, best: SportRecords): RecordRow[] {
	return [
		...best.metrics.map(({ metric, value, at }) => {
			const found = metricOf(state, metric);
			return { key: metricRow(metric), label: found?.label ?? metric, value: amount(value, found?.unit ?? ""), date: at };
		}),
		...CLIMB_KINDS.flatMap(kind => {
			const grade = best.grades[kind];
			return grade ? [{ key: kind, label: BEST_CLIMB_LABEL[kind], value: grade.grade, date: grade.date }] : [];
		}),
		...best.loads.map(({ key, kg, date }) => ({ key: loadRow(key), label: exerciseName(state.plan, key), value: signedKg(kg), date })),
	];
}

/** The records `after` holds that beat `before`'s: a metric measured anew, a harder grade, or a heavier load. */
export function beaten(state: SportState, before: SportRecords, after: SportRecords): Beaten[] {
	const improved = new Set<string>([
		...after.metrics
			.filter(best => {
				const old = before.metrics.find(({ metric }) => metric === best.metric);
				return !old || old.value !== best.value || old.at !== best.at;
			})
			.map(({ metric }) => metricRow(metric)),
		...CLIMB_KINDS.filter(kind => {
			const best = after.grades[kind];
			return best !== null && before.grades[kind]?.grade !== best.grade;
		}),
		...after.loads
			.filter(best => {
				const old = before.loads.find(({ key }) => key === best.key);
				return !old || old.kg < best.kg;
			})
			.map(({ key }) => loadRow(key)),
	]);
	const was = new Map(recordRows(state, before).map(row => [row.key, row.value]));
	return recordRows(state, after)
		.filter(row => improved.has(row.key))
		.map(row => ({ label: row.label, now: row.value, was: was.get(row.key) ?? null }));
}

/** What the Fait dialog logs: a planned workout of `date`, or a free session when `workout` is `null`; `log` is the one it edits. */
export interface LogTarget {
	date: string;
	workout: PlannedWorkout | null;
	log: WorkoutLog | null;
}

/** What a save sums up: the log, the minutes its workout planned, the records it beat, and the max a test measured. */
export interface Saved {
	log: WorkoutLog;
	minutes: number | null;
	beaten: Beaten[];
	test: { metric: Metric; value: number; was: Measurement | null } | null;
}

/** The change that puts `value` for `metric` on `date`: an edit of that day's measurement when there is one, else a new one. */
export function measurementChange(state: SportState, metric: string, date: string, value: number): SportChange {
	const existing = state.measurements.find(row => row.metric === metric && row.at === date);
	return existing ? { op: "edit-measurement", measurement: { ...existing, value } } : { op: "add-measurement", measurement: { id: crypto.randomUUID(), metric, value, at: date, note: "", addedBy: null } };
}

/** What the Fait dialog read for a done session: its log, and on a test day the max and the bodyweight typed. */
export interface LogFields {
	log: WorkoutLog;
	max: number | null;
	weight: number | null;
}

/** The changes a done session saves in one write, and what its summary shows; the tested metric's record is left out, since the test's own line words it. */
export function logSave(state: SportState, { date, workout, log: editing }: LogTarget, { log, max, weight }: LogFields): { changes: SportChange[]; saved: Saved } {
	const test = workout && testOf(state, workout);
	const changes: SportChange[] = [{ op: editing ? "edit-log" : "add-log", log }];
	if (test && max !== null) changes.push(measurementChange(state, test.metric.id, date, max));
	if (test?.bodyweight && weight !== null) changes.push(measurementChange(state, test.bodyweight.id, date, weight));
	const after = changes.reduce(applySport, state);
	return {
		changes,
		saved: {
			log,
			minutes: workout?.minutes ?? null,
			beaten: beaten(after, records(state), records(after)).filter(({ label }) => label !== test?.metric.label),
			test: test && max !== null ? { metric: test.metric, value: max, was: measured(state, test.metric.id).findLast(({ at }) => at < date) ?? null } : null,
		},
	};
}

/** The metric of `state` whose id is `id`, `null` for none. */
export const metricOf = (state: SportState, id: string | null): Metric | null => state.metrics.find(metric => metric.id === id) ?? null;

/** The workout of `plan` whose id is `id`, `null` for none, such as a free session's. */
export const workoutOf = (plan: Plan | null, id: string | null): Workout | null => plan?.workouts.find(workout => workout.id === id) ?? null;

/** The name of the exercise of `plan` whose key is `key`, the key itself when the plan has none. */
export const exerciseName = (plan: Plan | null, key: string): string => (plan ? exercisesOf(plan) : []).find(exercise => exercise.key === key)?.name ?? key;

/** The bodyweight's metric, as {@link bodyweightMetric} names it. */
export const bodyweightOf = (state: SportState): Metric | null => metricOf(state, bodyweightMetric(state.plan));

/** The measurements of `metric`, oldest first. */
export const measured = (state: SportState, metric: string): Measurement[] => state.measurements.filter(row => row.metric === metric).sort((a, b) => a.at.localeCompare(b.at));

/** The hardest of `climbs`, `null` for none. */
export const hardest = (climbs: Climb[]): Climb | null => climbs.reduce<Climb | null>((best, climb) => (!best || gradeRank(climb.grade) > gradeRank(best.grade) ? climb : best), null);

/** The sends of a session as its summary shows them: `2 · 7b+`, `aucune`. */
export function sendsText(climbs: Climb[]): string {
	const top = hardest(climbs);
	return top ? `${climbs.length} · ${top.grade}` : "aucune";
}

/** A log as the journal's row shows it: `+17 kg · 7b+ · effort 8 · ⚠ doigts 4/10`, or `pas faite`. */
export function logDetail(log: WorkoutLog): string {
	if (log.status === "skipped") return "pas faite";
	const kgs = Object.values(log.loads);
	const parts = [
		kgs.length ? signedKg(Math.max(...kgs)) : null,
		hardest(log.climbs)?.grade ?? null,
		log.rpe === null ? null : `effort ${log.rpe}`,
		log.pain && log.pain.level > 0 ? `⚠ ${PAIN_PLACE_LABEL[log.pain.where].toLowerCase()} ${log.pain.level}/10` : null,
	];
	return parts.filter(part => part !== null).join(" · ");
}

/** The ids of the logs that first reached a record of `best`: a heaviest load or a hardest grade. */
export const recordLogs = (best: SportRecords): Set<string> => new Set([...best.loads.map(({ logId }) => logId), ...CLIMB_KINDS.flatMap(kind => best.grades[kind]?.logId ?? [])]);

/** One week of the journal: its logs, newest first, how many were done, and the minutes the done ones planned. */
export interface JournalWeek {
	monday: string;
	logs: WorkoutLog[];
	done: number;
	minutes: number;
}

/** The journal's weeks, newest first. */
export function journalWeeks(state: SportState): JournalWeek[] {
	const weeks = new Map<string, JournalWeek>();
	for (const log of [...state.log].sort((a, b) => b.date.localeCompare(a.date))) {
		const monday = mondayOf(log.date);
		const week = weeks.get(monday) ?? { monday, logs: [], done: 0, minutes: 0 };
		weeks.set(monday, week);
		week.logs.push(log);
		if (log.status !== "done") continue;
		week.done += 1;
		week.minutes += workoutOf(state.plan, log.workout)?.minutes ?? 0;
	}
	return [...weeks.values()];
}

/** The first override day from `today` whose workout tests `metric`, as {@link testedMetric} finds it, `null` when none is planned. */
export function nextTest(state: SportState, metric: string, today: string): string | null {
	const tests = new Set(state.plan?.workouts.flatMap(workout => (testedMetric(state, workout)?.metric.id === metric ? [workout.id] : [])));
	const days = state.plan?.overrides.filter(({ date, slots }) => date >= today && slots.some(slot => tests.has(slot.workout))).map(({ date }) => date) ?? [];
	return days.sort()[0] ?? null;
}
