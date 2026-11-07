/** How the Sport page words and colors what `src/sport-week.ts` computes: scale words, workout colors, loads, doses, and the exercises a demo opens. */
import { addDays, daysBetween, mondayOf } from "../src/shared/days";
import { type Climb, type ClimbKind, type Exercise, exercisesOf, gradeRank, type Measurement, type Metric, type PainPlace, type Phase, type Place, type Plan, type SportState, type Workout, type WorkoutLog } from "../src/shared/sport";
import type { Load, PlannedDay, PlannedWorkout, SportRecords } from "../src/sport-week";

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

export const CLIMB_LABEL: Record<ClimbKind, string> = { boulder: "Bloc", route: "Voie" };

/** The hold colors of the Arkose gyms, which tag a boulder and never a workout, each with the dot that draws it. */
export const ARKOSE_COLORS: Record<string, string> = { vert: "green", bleu: "blue", rouge: "red", noir: "#262626", violet: "violet", blanc: "#e5e5e5" };

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

/** Kilograms added to the body: `+15 kg`, `−5 kg` with a pulley, `poids du corps` at zero. */
export function signedKg(kg: number): string {
	if (kg === 0) return "poids du corps";
	return kg > 0 ? `+${amount(kg, "kg")}` : `−${amount(-kg, "kg")}`;
}

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

/** The demos of a workout, every block in order. */
export const workoutDemos = (plan: Plan, workout: PlannedWorkout): Exercise[] => demosOf(plan, workout.blocks.flatMap(({ items }) => items.map(({ exercise }) => exercise)));

/** Where a phase's week falls: its number, the phase's count of weeks, and whether it is a deload week. */
export function phaseWeek(phase: Phase, date: string): { week: number; weeks: number; deload: boolean } {
	const first = mondayOf(phase.start);
	return {
		week: (daysBetween(first, mondayOf(date)).length - 1) / 7 + 1,
		weeks: Math.ceil(daysBetween(first, phase.end).length / 7),
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

/** The test `workout` holds, `null` when none of its exercises is keyed by a metric. */
export function testOf(state: SportState, workout: PlannedWorkout): TestOf | null {
	for (const { items } of workout.blocks) {
		for (const { exercise } of items) {
			const metric = state.metrics.find(({ id }) => id === exercise.key);
			if (metric) return { exercise, metric, bodyweight: bodyweightOf(state) };
		}
	}
	return null;
}

/** A record a save beat, with the best before it. */
export interface Beaten {
	label: string;
	now: string;
	/** `null` for a first. */
	was: string | null;
}

/** The records `after` holds that beat `before`'s: metrics, loads, and grades, each worded. */
export function beaten(state: SportState, before: SportRecords, after: SportRecords): Beaten[] {
	const out: Beaten[] = [];
	for (const best of after.metrics) {
		const old = before.metrics.find(({ metric }) => metric === best.metric);
		if (old?.value === best.value && old.at === best.at) continue;
		const metric = state.metrics.find(({ id }) => id === best.metric);
		out.push({ label: metric?.label ?? best.metric, now: amount(best.value, metric?.unit ?? ""), was: old ? amount(old.value, metric?.unit ?? "") : null });
	}
	const names = state.plan ? exercisesOf(state.plan) : [];
	for (const best of after.loads) {
		const old = before.loads.find(({ key }) => key === best.key);
		if (old && old.kg >= best.kg) continue;
		out.push({ label: names.find(({ key }) => key === best.key)?.name ?? best.key, now: signedKg(best.kg), was: old ? signedKg(old.kg) : null });
	}
	for (const kind of ["boulder", "route"] as const) {
		const best = after.grades[kind];
		const old = before.grades[kind];
		if (!best || (old && old.grade === best.grade)) continue;
		out.push({ label: `Meilleur ${CLIMB_LABEL[kind].toLowerCase()}`, now: best.grade, was: old?.grade ?? null });
	}
	return out;
}

/** The bodyweight: the metric an of-max load rule subtracts, `null` when no rule subtracts one. */
export function bodyweightOf(state: SportState): Metric | null {
	const rule = state.plan ? exercisesOf(state.plan).find(({ load }) => load?.kind === "of-max" && load.less !== null)?.load : undefined;
	return rule?.kind === "of-max" ? (state.metrics.find(({ id }) => id === rule.less) ?? null) : null;
}

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

/** The ids of the logs that reached a record of `best` first: a heaviest load or a hardest grade. */
export function recordLogs(state: SportState, best: SportRecords): Set<string> {
	const ids = new Set<string>();
	for (const log of state.log) {
		if (log.status !== "done") continue;
		const load = best.loads.some(({ key, kg, date }) => date === log.date && log.loads[key] === kg);
		const grade = log.climbs.some(({ kind, grade }) => best.grades[kind]?.date === log.date && best.grades[kind]?.grade === grade);
		if (load || grade) ids.add(log.id);
	}
	return ids;
}

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
		week.minutes += state.plan?.workouts.find(({ id }) => id === log.workout)?.minutes ?? 0;
	}
	return [...weeks.values()];
}

/** The first day from `today` on whose override tests `metric`, `null` when none is planned. */
export function nextTest(state: SportState, metric: string, today: string): string | null {
	const plan = state.plan;
	if (!plan) return null;
	const tests = (workout: string): boolean => plan.workouts.some(({ id, blocks }) => id === workout && blocks.some(({ items }) => items.some(({ key }) => key === metric)));
	const days = plan.overrides.filter(({ date, slots }) => date >= today && slots.some(slot => tests(slot.workout))).map(({ date }) => date);
	return days.sort()[0] ?? null;
}
