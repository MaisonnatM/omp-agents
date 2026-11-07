/**
 * Reading the Sport module's state and its changes from untyped JSON: `sport.json` and the page's `sport-change` messages.
 * A field left out reads as its default, so a file from an older version still reads; a field that is there but wrong
 * refuses the whole state or change, never a part of it. Fields the module does not know drop.
 */
import { isBoolean, isDay, isNonEmpty, isNumber, isObject, isSafeInteger, oneOf, parseAll } from "./json";
import { DAY_KEYS, weekdayOf } from "./shared/days";
import {
	CLIMB_KINDS,
	type Climb,
	type Demo,
	type Exercise,
	exercisesOf,
	FRENCH_GRADES,
	type Habit,
	type LoadRule,
	type Measurement,
	type Metric,
	type Override,
	PAIN_PLACES,
	type Pain,
	type Phase,
	PLACES,
	type Plan,
	type Routine,
	type Slot,
	SPORT_VERSION,
	type SportChange,
	type SportState,
	type Target,
	type WeekSlots,
	type Workout,
	type WorkoutLog,
} from "./shared/sport";

export const MAX_SPORT_ID = 200;

const isId = (value: unknown): value is string => isNonEmpty(value) && value.length <= MAX_SPORT_ID;
const isText = (value: unknown): value is string => typeof value === "string";
const isOptionalId = (value: unknown): value is string | null => value === null || isId(value);
const isCount = (value: unknown): value is number | null => value === null || (isSafeInteger(value) && value >= 0);
const isGrade = oneOf(FRENCH_GRADES);
const YOUTUBE_ID = /^[\w-]{11}$/;

const distinct = (ids: string[]): boolean => new Set(ids).size === ids.length;

function parseLoadRule(value: unknown): LoadRule | null {
	if (!isObject(value)) return null;
	if (value.kind === "fixed") return isNumber(value.kg) ? { kind: "fixed", kg: value.kg } : null;
	if (value.kind !== "of-max") return null;
	const { metric, fraction, offsetKg = 0, less = null } = value;
	return isId(metric) && isNumber(fraction) && fraction > 0 && fraction <= 1 && isNumber(offsetKg) && isOptionalId(less) ? { kind: "of-max", metric, fraction, offsetKg, less } : null;
}

function parseDemo(value: unknown): Demo | null {
	if (!isObject(value)) return null;
	const { youtubeId, by = "", cues, caution = null } = value;
	if (typeof youtubeId !== "string" || !YOUTUBE_ID.test(youtubeId) || !isText(by) || !(caution === null || isText(caution))) return null;
	if (!Array.isArray(cues) || cues.length !== 3 || !cues.every(isText)) return null;
	const [first, second, third] = cues;
	return { youtubeId, by, cues: [first, second, third], caution };
}

function parseExercise(value: unknown): Exercise | null {
	if (!isObject(value)) return null;
	const { key, name, sets = null, reps = null, holdSec = null, restSec = null, note = "", opensAs = [], hang = false } = value;
	if (!isId(key) || !isText(name) || !isText(note) || !isBoolean(hang)) return null;
	if (!isCount(sets) || !isCount(reps) || !isCount(holdSec) || !isCount(restSec)) return null;
	if (!(Array.isArray(opensAs) && opensAs.every(isId))) return null;
	const load = value.load == null ? null : parseLoadRule(value.load);
	const demo = value.demo == null ? null : parseDemo(value.demo);
	if ((value.load != null && !load) || (value.demo != null && !demo)) return null;
	return { key, name, sets, reps, holdSec, restSec, load, note, demo, opensAs, hang };
}

function parseSlot(value: unknown): Slot | null {
	if (!isObject(value)) return null;
	const { workout, optional = false } = value;
	return isId(workout) && isBoolean(optional) ? { workout, optional } : null;
}

function parseWeekSlots(value: unknown): WeekSlots | null {
	if (!isObject(value)) return null;
	const week: Partial<WeekSlots> = {};
	for (const day of DAY_KEYS) {
		const slots = parseAll(value[day] ?? [], parseSlot);
		if (!slots) return null;
		week[day] = slots;
	}
	return week as WeekSlots;
}

const NO_WEEK: WeekSlots = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };

function parsePhase(value: unknown): Phase | null {
	if (!isObject(value)) return null;
	const { id, name, start, end, deloadMondays = [] } = value;
	if (!isId(id) || !isText(name) || !isDay(start) || !isDay(end) || start > end) return null;
	const week = parseWeekSlots(value.week ?? NO_WEEK);
	const deloadWeek = parseWeekSlots(value.deloadWeek ?? NO_WEEK);
	if (!week || !deloadWeek || !Array.isArray(deloadMondays)) return null;
	if (!deloadMondays.every((day): day is string => isDay(day) && weekdayOf(day) === "mon" && day >= start && day <= end)) return null;
	return { id, name, start, end, week, deloadWeek, deloadMondays };
}

function parseWorkout(value: unknown): Workout | null {
	if (!isObject(value)) return null;
	const { id, name, place, minutes = 0 } = value;
	if (!isId(id) || !isText(name) || !oneOf(PLACES)(place) || !isCount(minutes) || minutes === null) return null;
	const blocks = parseAll(value.blocks ?? [], block => {
		if (!isObject(block)) return null;
		const { title = "" } = block;
		const items = parseAll(block.items ?? [], parseExercise);
		return isText(title) && items ? { title, items } : null;
	});
	return blocks && { id, name, place, minutes, blocks };
}

function parseRoutine(value: unknown): Routine | null {
	if (!isObject(value)) return null;
	const { id, name, minutes = 0 } = value;
	const items = parseAll(value.items ?? [], parseExercise);
	return isId(id) && isText(name) && isCount(minutes) && minutes !== null && items ? { id, name, minutes, items } : null;
}

function parseHabit(value: unknown): Habit | null {
	if (!isObject(value)) return null;
	const { label, routine = null } = value;
	return isNonEmpty(label) && isOptionalId(routine) ? { label, routine } : null;
}

function parseOverride(value: unknown): Override | null {
	if (!isObject(value)) return null;
	const { date } = value;
	const slots = parseAll(value.slots ?? [], parseSlot);
	return isDay(date) && slots ? { date, slots } : null;
}

/**
 * A plan whose every name points somewhere: slots at workouts, habits at routines, `opensAs` at exercises, and ids, phase
 * spans, and override days that do not overlap.
 */
function parsePlan(value: unknown): Plan | null {
	if (!isObject(value)) return null;
	const { title = "" } = value;
	const habits = parseAll(value.habits ?? [], parseHabit);
	const routines = parseAll(value.routines ?? [], parseRoutine);
	const workouts = parseAll(value.workouts ?? [], parseWorkout);
	const phases = parseAll(value.phases ?? [], parsePhase);
	const overrides = parseAll(value.overrides ?? [], parseOverride);
	if (!isText(title) || !habits || !routines || !workouts || !phases || !overrides) return null;
	if (!distinct(workouts.map(({ id }) => id)) || !distinct(routines.map(({ id }) => id)) || !distinct(phases.map(({ id }) => id)) || !distinct(overrides.map(({ date }) => date))) return null;
	const byStart = phases.toSorted((a, b) => a.start.localeCompare(b.start));
	if (byStart.some((phase, i) => i > 0 && phase.start <= byStart[i - 1]!.end)) return null;
	const workoutIds = new Set(workouts.map(({ id }) => id));
	const slots = [...phases.flatMap(({ week, deloadWeek }) => DAY_KEYS.flatMap(day => [...week[day], ...deloadWeek[day]])), ...overrides.flatMap(({ slots }) => slots)];
	if (!slots.every(({ workout }) => workoutIds.has(workout))) return null;
	const routineIds = new Set(routines.map(({ id }) => id));
	if (!habits.every(({ routine }) => routine === null || routineIds.has(routine))) return null;
	const exercises = exercisesOf({ title, habits, routines, workouts, phases, overrides });
	const keys = new Set(exercises.map(({ key }) => key));
	if (!exercises.every(({ opensAs }) => opensAs.every(key => keys.has(key)))) return null;
	return { title, habits, routines, workouts, phases, overrides };
}

function parseMetric(value: unknown): Metric | null {
	if (!isObject(value)) return null;
	const { id, label, unit = "", better = "higher" } = value;
	return isId(id) && isText(label) && isText(unit) && (better === "higher" || better === "lower") ? { id, label, unit, better } : null;
}

function parseMeasurement(value: unknown): Measurement | null {
	if (!isObject(value)) return null;
	const { id, metric, value: measured, at, note = "", addedBy = null } = value;
	return isId(id) && isId(metric) && isNumber(measured) && isDay(at) && isText(note) && isOptionalId(addedBy) ? { id, metric, value: measured, at, note, addedBy } : null;
}

function parseTarget(value: unknown): Target | null {
	if (!isObject(value)) return null;
	const { id, label, by = null, kind } = value;
	if (!isId(id) || !isText(label) || !(by === null || isDay(by))) return null;
	if (kind === "metric") return isId(value.metric) && isNumber(value.value) ? { id, label, by, kind, metric: value.metric, value: value.value } : null;
	return oneOf(CLIMB_KINDS)(kind) && isGrade(value.grade) ? { id, label, by, kind, grade: value.grade } : null;
}

function parsePain(value: unknown): Pain | null {
	if (!isObject(value)) return null;
	const { level, where } = value;
	return isSafeInteger(level) && level >= 0 && level <= 10 && oneOf(PAIN_PLACES)(where) ? { level, where } : null;
}

function parseClimb(value: unknown): Climb | null {
	if (!isObject(value)) return null;
	const { kind, grade, color = null, kilter = false, attempts = null } = value;
	if (!oneOf(CLIMB_KINDS)(kind) || !isGrade(grade) || !(color === null || isText(color)) || !isBoolean(kilter)) return null;
	return attempts === null || (isSafeInteger(attempts) && attempts >= 1) ? { kind, grade, color, kilter, attempts } : null;
}

function parseLog(value: unknown): WorkoutLog | null {
	if (!isObject(value)) return null;
	const { id, date, workout = null, title = "", status = "done", rpe = null, loads = {}, note = "", addedBy = null } = value;
	if (!isId(id) || !isDay(date) || !isOptionalId(workout) || !isText(title) || !(status === "done" || status === "skipped")) return null;
	if (!(rpe === null || (isSafeInteger(rpe) && rpe >= 1 && rpe <= 10)) || !isText(note) || !isOptionalId(addedBy)) return null;
	const kilos = isObject(loads) && !Array.isArray(loads) ? Object.entries(loads) : null;
	if (!kilos?.every((entry): entry is [string, number] => isId(entry[0]) && isNumber(entry[1]))) return null;
	const pain = value.pain == null ? null : parsePain(value.pain);
	const climbs = parseAll(value.climbs ?? [], parseClimb);
	if ((value.pain != null && !pain) || !climbs) return null;
	return { id, date, workout, title, status, rpe, pain, loads: Object.fromEntries(kilos), climbs, note, addedBy };
}

const isIndex = (value: unknown): value is number => isSafeInteger(value) && value >= 0;

/** What `sport.json` holds, the log and the measurements oldest first, `null` when it holds none or comes from a newer version. */
export function parseSportState(value: unknown): SportState | null {
	if (!isObject(value) || Array.isArray(value)) return null;
	const { v = SPORT_VERSION } = value;
	if (!isSafeInteger(v) || v > SPORT_VERSION) return null;
	const metrics = parseAll(value.metrics ?? [], parseMetric);
	const measurements = parseAll(value.measurements ?? [], parseMeasurement);
	const targets = parseAll(value.targets ?? [], parseTarget);
	const plan = value.plan == null ? null : parsePlan(value.plan);
	const log = parseAll(value.log ?? [], parseLog);
	if (!metrics || !measurements || !targets || (value.plan != null && !plan) || !log) return null;
	if (!distinct(metrics.map(({ id }) => id)) || !distinct(measurements.map(({ id }) => id)) || !distinct(targets.map(({ id }) => id)) || !distinct(log.map(({ id }) => id))) return null;
	return {
		v: SPORT_VERSION,
		metrics,
		measurements: measurements.toSorted((a, b) => a.at.localeCompare(b.at)),
		targets,
		plan,
		log: log.toSorted((a, b) => a.date.localeCompare(b.date)),
	};
}

/** One change from the page, whole, or `null` when any part of it is wrong. */
export function parseSportChange(value: unknown): SportChange | null {
	if (!isObject(value)) return null;
	const { op, id, index } = value;
	switch (op) {
		case "set-plan": {
			if (value.plan === null) return { op, plan: null };
			const plan = parsePlan(value.plan);
			return plan && { op, plan };
		}
		case "set-targets": {
			const targets = parseAll(value.targets, parseTarget);
			return targets && distinct(targets.map(({ id }) => id)) ? { op, targets } : null;
		}
		case "set-metrics": {
			const metrics = parseAll(value.metrics, parseMetric);
			return metrics && distinct(metrics.map(({ id }) => id)) ? { op, metrics } : null;
		}
		case "add-measurement":
		case "edit-measurement": {
			const measurement = parseMeasurement(value.measurement);
			return measurement && { op, measurement };
		}
		case "restore-measurement": {
			const measurement = parseMeasurement(value.measurement);
			return measurement && isIndex(index) ? { op, measurement, index } : null;
		}
		case "add-log":
		case "edit-log": {
			const log = parseLog(value.log);
			return log && { op, log };
		}
		case "restore-log": {
			const log = parseLog(value.log);
			return log && isIndex(index) ? { op, log, index } : null;
		}
		case "remove-measurement":
		case "remove-log":
			return isId(id) ? { op, id } : null;
		default:
			return null;
	}
}
