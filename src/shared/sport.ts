/** The Sport module's state, which `sport.json` holds and the server alone writes, and the changes the page and the agent send. */
import type { DayKey } from "./days";

export const SPORT_VERSION = 1;

/** French climbing grades, easiest first, one table for boulders and routes. */
export const FRENCH_GRADES = [
	"4", "4+",
	"5a", "5a+", "5b", "5b+", "5c", "5c+",
	"6a", "6a+", "6b", "6b+", "6c", "6c+",
	"7a", "7a+", "7b", "7b+", "7c", "7c+",
	"8a", "8a+", "8b", "8b+", "8c", "8c+",
	"9a",
] as const;

export type FrenchGrade = (typeof FRENCH_GRADES)[number];

export const PLACES = ["home", "gym", "outdoor"] as const;
export type Place = (typeof PLACES)[number];

export const PAIN_PLACES = ["fingers", "elbow", "shoulder", "hip", "other"] as const;
export type PainPlace = (typeof PAIN_PLACES)[number];

export const CLIMB_KINDS = ["boulder", "route"] as const;
export type ClimbKind = (typeof CLIMB_KINDS)[number];

/** Something the user measures, such as the finger max or the bodyweight, and which way is better. */
export interface Metric {
	id: string;
	label: string;
	unit: string;
	better: "higher" | "lower";
}

/** One dated value of a metric, such as a 117 kg max tested on 17 November. */
export interface Measurement {
	id: string;
	metric: string;
	value: number;
	/** `YYYY-MM-DD`. */
	at: string;
	note: string;
	/** The session id of the agent that added it, `null` when the user did. */
	addedBy: string | null;
}

/** A result the user trains toward: a metric's value, or a grade sent in boulder or route, by a day or open-ended. */
export type Target = { id: string; label: string; by: string | null } & ({ kind: "metric"; metric: string; value: number } | { kind: ClimbKind; grade: FrenchGrade });

/**
 * The kilograms an exercise calls for: a share of a metric's last value, less the last value of `less` when it names a
 * metric such as the bodyweight, plus an offset; or a fixed load.
 */
export type LoadRule = { kind: "of-max"; metric: string; fraction: number; offsetKg: number; less: string | null } | { kind: "fixed"; kg: number };

/** A video that shows an exercise, with three cues to watch for. */
export interface Demo {
	/** 11 characters. */
	youtubeId: string;
	by: string;
	cues: [string, string, string];
	caution: string | null;
}

export interface Exercise {
	/** The same key names the same exercise across workouts and logs. */
	key: string;
	name: string;
	sets: number | null;
	reps: number | null;
	holdSec: number | null;
	restSec: number | null;
	load: LoadRule | null;
	note: string;
	demo: Demo | null;
	/** The exercises this one opens as, such as a hip routine's three stretches, by key. */
	opensAs: string[];
	/** A hang on the fingers, which a finger pain flag removes. */
	hang: boolean;
}

export interface Workout {
	id: string;
	name: string;
	place: Place;
	minutes: number;
	blocks: { title: string; items: Exercise[] }[];
}

/** A short sequence of exercises, such as the hip mobility or the evening stretches, that a habit or a workout points to. */
export interface Routine {
	id: string;
	name: string;
	minutes: number;
	items: Exercise[];
}

/** A daily reminder, such as creatine or stretching, with the routine it opens. */
export interface Habit {
	label: string;
	routine: string | null;
}

export interface Slot {
	workout: string;
	optional: boolean;
}

export type WeekSlots = Record<DayKey, Slot[]>;

/** A stretch of the plan, start and end included, with its standard week and the lighter week its deload Mondays start. */
export interface Phase {
	id: string;
	name: string;
	start: string;
	end: string;
	week: WeekSlots;
	deloadWeek: WeekSlots;
	deloadMondays: string[];
}

/** The workouts of one day, which replace that day's phase slots. */
export interface Override {
	date: string;
	slots: Slot[];
}

export interface Plan {
	title: string;
	habits: Habit[];
	routines: Routine[];
	workouts: Workout[];
	phases: Phase[];
	overrides: Override[];
}

export interface Pain {
	/** 0 to 10. */
	level: number;
	where: PainPlace;
}

/** A boulder or route sent. */
export interface Climb {
	kind: ClimbKind;
	grade: FrenchGrade;
	color: string | null;
	kilter: boolean;
	attempts: number | null;
}

/** What the user did on a day, planned or not. */
export interface WorkoutLog {
	id: string;
	date: string;
	workout: string | null;
	title: string;
	status: "done" | "skipped";
	/** 1 to 10. */
	rpe: number | null;
	pain: Pain | null;
	/** Kilograms added per exercise key. */
	loads: Record<string, number>;
	climbs: Climb[];
	note: string;
	addedBy: string | null;
}

export interface SportState {
	v: typeof SPORT_VERSION;
	metrics: Metric[];
	measurements: Measurement[];
	targets: Target[];
	plan: Plan | null;
	/** Oldest first. */
	log: WorkoutLog[];
}

export const EMPTY_SPORT: SportState = { v: SPORT_VERSION, metrics: [], measurements: [], targets: [], plan: null, log: [] };

/** One change to the state; a restore puts an item back at the index it was removed from. */
export type SportChange =
	| { op: "set-plan"; plan: Plan | null }
	| { op: "set-targets"; targets: Target[] }
	| { op: "set-metrics"; metrics: Metric[] }
	| { op: "add-measurement"; measurement: Measurement }
	| { op: "edit-measurement"; measurement: Measurement }
	| { op: "remove-measurement"; id: string }
	| { op: "restore-measurement"; measurement: Measurement; index: number }
	| { op: "add-log"; log: WorkoutLog }
	| { op: "edit-log"; log: WorkoutLog }
	| { op: "remove-log"; id: string }
	| { op: "restore-log"; log: WorkoutLog; index: number };

/** Every exercise of `plan`'s workouts and routines. */
export const exercisesOf = (plan: Plan): Exercise[] => [...plan.workouts.flatMap(({ blocks }) => blocks.flatMap(({ items }) => items)), ...plan.routines.flatMap(({ items }) => items)];

/** `grade`'s place in {@link FRENCH_GRADES}, higher for harder. */
export const gradeRank = (grade: FrenchGrade): number => FRENCH_GRADES.indexOf(grade);
