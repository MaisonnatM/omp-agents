/**
 * Reading the Sport module's state and its changes from untyped JSON: `sport.json` and the `sport-changes` messages of
 * the page and the agent. A field left out reads as its default, so a file from an older version still reads, and fields
 * the module does not know drop. The file is held to shapes and types alone, so a rule tightened later never refuses
 * data already saved; a change is also held to the length and range limits and to a plan whose names point somewhere.
 * A wrong field refuses the whole state or change, and a change's refusal names the field and the rule it broke.
 */
import { isBoolean, isDay, isNonEmpty, isNumber, isObject, isSafeInteger, isString, nullable, oneOf, type Parsed, recordOf } from "./json";
import { DAY_KEYS, weekdayOf } from "./shared/days";
import {
	CLIMB_KINDS,
	type Climb,
	type Demo,
	type Exercise,
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
	type RoutineCheck,
	type Slot,
	SPORT_VERSION,
	type SportChange,
	type SportState,
	type Target,
	type WeekSlots,
	type Workout,
	WORKOUT_KINDS,
	type WorkoutLog,
} from "./shared/sport";

/** The longest id, short text, and note a change may carry, and the most items any of its lists may hold. */
export const MAX_SPORT_ID = 200;
export const MAX_SPORT_TEXT = 200;
export const MAX_SPORT_NOTE = 4000;
export const MAX_SPORT_ITEMS = 200;

/** A check a field must pass, and how its refusal ends. */
interface Rule<T> {
	is: (value: unknown) => value is T;
	must: string;
}

/** Thrown inside the parse with the path of the wrong field and its rule, and caught where the parse starts. */
class Refused extends Error {}

function refuse(path: string, must: string): never {
	throw new Refused(`${path} ${must}`);
}

const field = <T>(value: unknown, path: string, rule: Rule<T>): T => (rule.is(value) ? value : refuse(path, rule.must));

const orNull = <T>(rule: Rule<T>): Rule<T | null> => ({ is: nullable(rule.is), must: `${rule.must}, or null` });

const choice = <const T extends string>(values: readonly T[]): Rule<T> => ({ is: oneOf(values), must: `must be one of ${values.join(", ")}` });

const wholeFrom = (min: number, max = Number.MAX_SAFE_INTEGER): Rule<number> => ({
	is: (value): value is number => isSafeInteger(value) && value >= min && value <= max,
	must: max === Number.MAX_SAFE_INTEGER ? `must be a whole number from ${min}` : `must be a whole number from ${min} to ${max}`,
});

const textUpTo = (max: number): Rule<string> => ({ is: (value): value is string => isString(value) && value.length <= max, must: `must be a string of at most ${max} characters` });

const STRING: Rule<string> = { is: isString, must: "must be a string" };
const NUMBER: Rule<number> = { is: isNumber, must: "must be a number" };
const BOOLEAN: Rule<boolean> = { is: isBoolean, must: "must be true or false" };
const DAY: Rule<string> = { is: isDay, must: "must be a YYYY-MM-DD day" };
const GRADE: Rule<(typeof FRENCH_GRADES)[number]> = { is: oneOf(FRENCH_GRADES), must: "must be a French grade such as 7a+" };
const PLACE = choice(PLACES);
const CLIMB_KIND = choice(CLIMB_KINDS);
const PAIN_PLACE = choice(PAIN_PLACES);
const WORKOUT_KIND = choice(WORKOUT_KINDS);
const TARGET_KIND = choice(["metric", ...CLIMB_KINDS]);
const SENT_ID: Rule<string> = { is: (value): value is string => isNonEmpty(value) && value.length <= MAX_SPORT_ID, must: `must be 1 to ${MAX_SPORT_ID} characters` };

/** What the fields of a state or a change must be, by kind of field. */
interface Rules {
	id: Rule<string>;
	name: Rule<string>;
	text: Rule<string>;
	note: Rule<string>;
	count: Rule<number>;
	fraction: Rule<number>;
	youtubeId: Rule<string>;
	rpe: Rule<number>;
	painLevel: Rule<number>;
	attempts: Rule<number>;
	loads: Rule<Record<string, number>>;
	items: number;
	/** Whether an `of-max` load rule must name its `less`: a rule written before `less` existed subtracted the bodyweight, and would read as subtracting nothing. */
	namesLess: boolean;
}

const STORED: Rules = {
	id: STRING,
	name: STRING,
	text: STRING,
	note: STRING,
	count: NUMBER,
	fraction: NUMBER,
	youtubeId: STRING,
	rpe: NUMBER,
	painLevel: NUMBER,
	attempts: NUMBER,
	loads: { is: recordOf(isNumber), must: "must map exercise keys to numbers" },
	items: Number.POSITIVE_INFINITY,
	namesLess: false,
};

const SENT: Rules = {
	id: SENT_ID,
	name: { is: (value): value is string => isNonEmpty(value) && value.length <= MAX_SPORT_TEXT, must: `must be 1 to ${MAX_SPORT_TEXT} characters` },
	text: textUpTo(MAX_SPORT_TEXT),
	note: textUpTo(MAX_SPORT_NOTE),
	count: wholeFrom(0),
	fraction: { is: (value): value is number => isNumber(value) && value > 0 && value <= 1, must: "must be above 0 and at most 1" },
	youtubeId: { is: (value): value is string => isString(value) && /^[\w-]{11}$/.test(value), must: "must be 11 characters" },
	rpe: wholeFrom(1, 10),
	painLevel: wholeFrom(0, 10),
	attempts: wholeFrom(1),
	loads: {
		is: (value): value is Record<string, number> => recordOf(isNumber)(value) && Object.keys(value).length <= MAX_SPORT_ITEMS && Object.keys(value).every(SENT_ID.is),
		must: `must map up to ${MAX_SPORT_ITEMS} exercise keys of 1 to ${MAX_SPORT_ID} characters to numbers`,
	},
	items: MAX_SPORT_ITEMS,
	namesLess: true,
};

type Parse<T> = (value: unknown, path: string, rules: Rules) => T;

const ruled =
	<T>(rule: Rule<T>): Parse<T> =>
	(value, path) =>
		field(value, path, rule);

const pathTo = (path: string, key: string): string => (path ? `${path}.${key}` : key);

function listOf<T>(value: unknown, path: string, rules: Rules, parse: Parse<T>): T[] {
	if (!Array.isArray(value)) refuse(path, "must be a list");
	if (value.length > rules.items) refuse(path, `must hold at most ${rules.items} items`);
	return value.map((item, i) => parse(item, `${path}[${i}]`, rules));
}

/** The fields of the object at `path`, each read under `rules` and refused with its own path. */
function fieldsOf(value: unknown, path: string, rules: Rules) {
	if (!isObject(value) || Array.isArray(value)) refuse(path || "the value", "must be an object");
	const object = value;
	return {
		/** The field through `rule`, `fallback` when it is left out. */
		one: <T>(key: string, rule: Rule<T>, fallback?: T): T => field(object[key] === undefined ? fallback : object[key], pathTo(path, key), rule),
		/** The field through `rule`, refused with `leftOut` when it is left out. */
		required: <T>(key: string, rule: Rule<T>, leftOut: string): T => (object[key] === undefined ? refuse(pathTo(path, key), leftOut) : field(object[key], pathTo(path, key), rule)),
		/** The object at `key`, read from `fallback` when it is left out. */
		nested: <T>(key: string, parse: Parse<T>, fallback?: unknown): T => parse(object[key] === undefined ? fallback : object[key], pathTo(path, key), rules),
		/** The object at `key`, `null` when it is left out or null. */
		maybe: <T>(key: string, parse: Parse<T>): T | null => (object[key] == null ? null : parse(object[key], pathTo(path, key), rules)),
		/** The list at `key`, empty when it is left out. */
		list: <T>(key: string, parse: Parse<T>): T[] => listOf(object[key] ?? [], pathTo(path, key), rules, parse),
	};
}

const parseLoadRule: Parse<LoadRule> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	const kind = read.one("kind", choice(["of-max", "fixed"]));
	if (kind === "fixed") return { kind, kg: read.one("kg", NUMBER) };
	const less = orNull(rules.id);
	return {
		kind,
		metric: read.one("metric", rules.id),
		fraction: read.one("fraction", rules.fraction),
		offsetKg: read.one("offsetKg", NUMBER, 0),
		less: rules.namesLess ? read.required("less", less, "is required; use null to subtract nothing") : read.one("less", less, null),
	};
};

const parseDemo: Parse<Demo> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	const youtubeId = read.one("youtubeId", rules.youtubeId);
	const [first, second, third, ...more] = read.list("cues", ruled(rules.text));
	if (first === undefined || second === undefined || third === undefined || more.length > 0) refuse(pathTo(path, "cues"), "must be 3 cues");
	return { youtubeId, by: read.one("by", rules.text, ""), cues: [first, second, third], caution: read.one("caution", orNull(rules.note), null) };
};

const parseExercise: Parse<Exercise> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	const count = orNull(rules.count);
	return {
		key: read.one("key", rules.id),
		name: read.one("name", rules.name),
		sets: read.one("sets", count, null),
		reps: read.one("reps", count, null),
		holdSec: read.one("holdSec", count, null),
		restSec: read.one("restSec", count, null),
		load: read.maybe("load", parseLoadRule),
		note: read.one("note", rules.note, ""),
		demo: read.maybe("demo", parseDemo),
		opensAs: read.list("opensAs", ruled(rules.id)),
		hang: read.one("hang", BOOLEAN, false),
	};
};

const parseSlot: Parse<Slot> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { workout: read.one("workout", rules.id), optional: read.one("optional", BOOLEAN, false) };
};

const parseWeekSlots: Parse<WeekSlots> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { mon: read.list("mon", parseSlot), tue: read.list("tue", parseSlot), wed: read.list("wed", parseSlot), thu: read.list("thu", parseSlot), fri: read.list("fri", parseSlot), sat: read.list("sat", parseSlot), sun: read.list("sun", parseSlot) };
};

const parsePhase: Parse<Phase> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		id: read.one("id", rules.id),
		name: read.one("name", rules.name),
		start: read.one("start", DAY),
		end: read.one("end", DAY),
		week: read.nested("week", parseWeekSlots, {}),
		deloadWeek: read.nested("deloadWeek", parseWeekSlots, {}),
		deloadMondays: read.list("deloadMondays", ruled(DAY)),
	};
};

const parseBlock: Parse<Workout["blocks"][number]> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { title: read.one("title", rules.text, ""), items: read.list("items", parseExercise) };
};

const parseWorkout: Parse<Workout> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		id: read.one("id", rules.id),
		name: read.one("name", rules.name),
		kind: read.one("kind", WORKOUT_KIND),
		place: read.one("place", PLACE),
		minutes: read.one("minutes", rules.count, 0),
		blocks: read.list("blocks", parseBlock),
	};
};

const parseRoutine: Parse<Routine> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { id: read.one("id", rules.id), name: read.one("name", rules.name), minutes: read.one("minutes", rules.count, 0), items: read.list("items", parseExercise) };
};

const parseHabit: Parse<Habit> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { label: read.one("label", rules.name), routine: read.one("routine", orNull(rules.id), null) };
};

const parseOverride: Parse<Override> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { date: read.one("date", DAY), slots: read.list("slots", parseSlot) };
};

const parsePlan: Parse<Plan> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		title: read.one("title", rules.text, ""),
		habits: read.list("habits", parseHabit),
		routines: read.list("routines", parseRoutine),
		workouts: read.list("workouts", parseWorkout),
		phases: read.list("phases", parsePhase),
		overrides: read.list("overrides", parseOverride),
	};
};

const parseMetric: Parse<Metric> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { id: read.one("id", rules.id), label: read.one("label", rules.name), unit: read.one("unit", rules.text, ""), better: read.one("better", choice(["higher", "lower"]), "higher") };
};

const parseMeasurement: Parse<Measurement> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		id: read.one("id", rules.id),
		metric: read.one("metric", rules.id),
		value: read.one("value", NUMBER),
		at: read.one("at", DAY),
		note: read.one("note", rules.note, ""),
		addedBy: read.one("addedBy", orNull(rules.id), null),
	};
};

const parseTarget: Parse<Target> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	const target = { id: read.one("id", rules.id), label: read.one("label", rules.name), by: read.one("by", orNull(DAY), null) };
	const kind = read.one("kind", TARGET_KIND);
	if (kind === "metric") return { ...target, kind, metric: read.one("metric", rules.id), value: read.one("value", NUMBER) };
	return { ...target, kind, grade: read.one("grade", GRADE) };
};

const parsePain: Parse<Pain> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { level: read.one("level", rules.painLevel), where: read.one("where", PAIN_PLACE) };
};

const parseClimb: Parse<Climb> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		kind: read.one("kind", CLIMB_KIND),
		grade: read.one("grade", GRADE),
		color: read.one("color", orNull(rules.text), null),
		kilter: read.one("kilter", BOOLEAN, false),
		attempts: read.one("attempts", orNull(rules.attempts), null),
	};
};

const parseLog: Parse<WorkoutLog> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return {
		id: read.one("id", rules.id),
		date: read.one("date", DAY),
		workout: read.one("workout", orNull(rules.id), null),
		title: read.one("title", rules.text, ""),
		status: read.one("status", choice(["done", "skipped"]), "done"),
		rpe: read.one("rpe", orNull(rules.rpe), null),
		pain: read.maybe("pain", parsePain),
		loads: read.one("loads", rules.loads, {}),
		climbs: read.list("climbs", parseClimb),
		note: read.one("note", rules.note, ""),
		addedBy: read.one("addedBy", orNull(rules.id), null),
	};
};

const parseCheck: Parse<RoutineCheck> = (value, path, rules) => {
	const read = fieldsOf(value, path, rules);
	return { date: read.one("date", DAY), routine: read.one("routine", rules.id), items: read.list("items", ruled(rules.id)) };
};

function unique<T>(items: T[], path: string, idOf: (item: T) => string): void {
	const seen = new Set<string>();
	for (const item of items) {
		const id = idOf(item);
		if (seen.has(id)) refuse(path, `must not repeat ${id}`);
		seen.add(id);
	}
}

const parseMetrics: Parse<Metric[]> = (list, path, rules) => {
	const metrics = listOf(list, path, rules, parseMetric);
	unique(metrics, path, ({ id }) => id);
	return metrics;
};

/**
 * Refuses a sent plan whose names point nowhere or whose dates disagree: a slot naming no workout, a habit no routine,
 * an `opensAs` no exercise key, a repeated id or override day, a phase that ends before it starts or overlaps another,
 * or a deload Monday that is not a Monday of its phase.
 */
function checkPlan({ habits, routines, workouts, phases, overrides }: Plan): void {
	unique(workouts, "plan.workouts", ({ id }) => id);
	unique(routines, "plan.routines", ({ id }) => id);
	unique(phases, "plan.phases", ({ id }) => id);
	unique(overrides, "plan.overrides", ({ date }) => date);
	const workoutIds = new Set(workouts.map(({ id }) => id));
	const checkSlots = (slots: Slot[], path: string) => slots.forEach(({ workout }, i) => workoutIds.has(workout) || refuse(`${path}[${i}].workout`, "must name a workout of the plan"));
	phases.forEach(({ start, end, week, deloadWeek, deloadMondays }, i) => {
		const path = `plan.phases[${i}]`;
		if (start > end) refuse(`${path}.end`, "must not come before its start");
		const overlapped = phases.findIndex((other, j) => j !== i && other.start <= end && start <= other.end);
		if (overlapped >= 0) refuse(path, `must not overlap plan.phases[${overlapped}]`);
		deloadMondays.forEach((day, k) => (weekdayOf(day) === "mon" && start <= day && day <= end) || refuse(`${path}.deloadMondays[${k}]`, "must be a Monday within its phase"));
		for (const day of DAY_KEYS) {
			checkSlots(week[day], `${path}.week.${day}`);
			checkSlots(deloadWeek[day], `${path}.deloadWeek.${day}`);
		}
	});
	overrides.forEach(({ slots }, i) => checkSlots(slots, `plan.overrides[${i}].slots`));
	const routineIds = new Set(routines.map(({ id }) => id));
	habits.forEach(({ routine }, i) => routine === null || routineIds.has(routine) || refuse(`plan.habits[${i}].routine`, "must name a routine of the plan"));
	const exercises: [Exercise, string][] = [
		...workouts.flatMap(({ blocks }, w) => blocks.flatMap(({ items }, b) => items.map((item, i): [Exercise, string] => [item, `plan.workouts[${w}].blocks[${b}].items[${i}]`]))),
		...routines.flatMap(({ items }, r) => items.map((item, i): [Exercise, string] => [item, `plan.routines[${r}].items[${i}]`])),
	];
	const keys = new Set(exercises.map(([{ key }]) => key));
	for (const [{ opensAs }, path] of exercises) opensAs.forEach((key, k) => keys.has(key) || refuse(`${path}.opensAs[${k}]`, "must name an exercise key of the plan"));
}

/** What `sport.json` holds, the log and the measurements oldest first, `null` when it holds none or comes from a newer version. */
export function parseSportState(value: unknown): SportState | null {
	try {
		const read = fieldsOf(value, "", STORED);
		read.one("v", wholeFrom(0, SPORT_VERSION), SPORT_VERSION);
		return {
			v: SPORT_VERSION,
			metrics: read.list("metrics", parseMetric),
			measurements: read.list("measurements", parseMeasurement).toSorted((a, b) => a.at.localeCompare(b.at)),
			targets: read.list("targets", parseTarget),
			plan: read.maybe("plan", parsePlan),
			log: read.list("log", parseLog).toSorted((a, b) => a.date.localeCompare(b.date)),
			checks: read.list("checks", parseCheck).toSorted((a, b) => a.date.localeCompare(b.date)),
		};
	} catch (err) {
		if (err instanceof Refused) return null;
		throw err;
	}
}

function readChange(value: unknown): SportChange {
	const read = fieldsOf(value, "", SENT);
	const index = () => read.one("index", wholeFrom(0));
	const op = read.one("op", STRING);
	switch (op) {
		case "set-plan": {
			const plan = read.nested("plan", (value, path, rules) => (value === null ? null : parsePlan(value, path, rules)));
			if (plan) checkPlan(plan);
			return { op, plan };
		}
		case "set-targets": {
			const targets = read.nested("targets", (list, path, rules) => listOf(list, path, rules, parseTarget));
			unique(targets, "targets", ({ id }) => id);
			return { op, targets };
		}
		case "set-metrics":
			return { op, metrics: read.nested("metrics", parseMetrics) };
		case "add-measurement":
		case "edit-measurement":
			return { op, measurement: read.nested("measurement", parseMeasurement) };
		case "restore-measurement":
			return { op, measurement: read.nested("measurement", parseMeasurement), index: index() };
		case "add-log":
		case "edit-log":
			return { op, log: read.nested("log", parseLog) };
		case "restore-log":
			return { op, log: read.nested("log", parseLog), index: index() };
		case "remove-measurement":
		case "remove-log":
			return { op, id: read.one("id", SENT_ID) };
		case "set-check":
			return { op, check: read.nested("check", parseCheck) };
		default:
			return refuse("op", "must name a Sport change");
	}
}

/** What `read` returns, or why it is refused: the path of the first wrong field and its rule. */
function parsing<T>(read: () => T): Parsed<T, { error: string }> {
	try {
		return { ok: read() };
	} catch (err) {
		if (err instanceof Refused) return { error: err.message };
		throw err;
	}
}

/** One change from the page or the agent, whole, or why it is refused. */
export const parseSportChange = (value: unknown): Parsed<SportChange, { error: string }> => parsing(() => readChange(value));

/** The metrics an agent's request adds or replaces by id, or why they are refused. */
export const parseSportMetrics = (value: unknown): Parsed<Metric[], { error: string }> => parsing(() => parseMetrics(value, "metrics", SENT));

/** The workout log an agent's edit leaves, its fields over the stored log, or why it is refused. */
export const parseSportLog = (value: unknown): Parsed<WorkoutLog, { error: string }> => parsing(() => parseLog(value, "log", SENT));

/** The measurement an agent's edit leaves, its fields over the stored one, or why it is refused. */
export const parseSportMeasurement = (value: unknown): Parsed<Measurement, { error: string }> => parsing(() => parseMeasurement(value, "measurement", SENT));
