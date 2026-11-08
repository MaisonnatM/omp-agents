/** The Sport module's sample state and builders, for its tests: the climbing plan from 16 November 2026 to the February tests. */
import { type Exercise, type Measurement, type Phase, type SportState, type WeekSlots, type Workout, type WorkoutLog } from "./shared/sport";

export const exercise = (key: string, name: string, fields: Partial<Exercise> = {}): Exercise => ({
	key,
	name,
	sets: null,
	reps: null,
	holdSec: null,
	restSec: null,
	load: null,
	note: "",
	demo: null,
	opensAs: [],
	hang: false,
	perSide: false,
	...fields,
});

export const log = (id: string, date: string, fields: Partial<WorkoutLog> = {}): WorkoutLog => ({
	id,
	date,
	workout: null,
	title: id,
	status: "done",
	rpe: null,
	pain: null,
	loads: {},
	climbs: [],
	note: "",
	addedBy: null,
	...fields,
});

export const measurement = (id: string, metric: string, value: number, at: string): Measurement => ({ id, metric, value, at, note: "", addedBy: null });

export const SEMI = exercise("semi", "Semi-arquée", { sets: 5, holdSec: 10, restSec: 180, hang: true, load: { kind: "of-max", metric: "max", fraction: 0.87, offsetKg: 0, less: "bodyweight" }, demo: { youtubeId: "3IdQnBtnGjQ", by: "Lattice", cues: ["Épaules engagées", "Poignets neutres", "Pas de rebond"], caution: null } });
export const OPEN = exercise("open", "Main ouverte", { sets: 5, holdSec: 10, restSec: 180, hang: true, load: { kind: "of-max", metric: "max", fraction: 0.87, offsetKg: -5, less: "bodyweight" }, demo: { youtubeId: "HBa-ilEp4Os", by: "Lattice", cues: ["Trois doigts", "Bras tendus", "Lâcher propre"], caution: "Pas de rebond" } });
export const PULLS = exercise("tractions", "Tractions lestées", { sets: 3, reps: 3, restSec: 180, load: { kind: "fixed", kg: 35 } });
export const ABRAHANGS = exercise("abrahangs", "Abrahangs", { sets: 10, holdSec: 10, hang: true });

const workout = (id: string, name: string, kind: Workout["kind"], place: Workout["place"], minutes: number, ...blocks: [string, Exercise[]][]): Workout => ({ id, name, kind, place, minutes, blocks: blocks.map(([title, items]) => ({ title, items })) });

const WORKOUTS: Workout[] = [
	workout("hanche", "Mobilité hanche", "hip", "home", 15, ["Routine", [exercise("mobilite", "Mobilité hanche", { opensAs: ["h1", "h2", "h3"] })]]),
	workout("mardi", "Semi-arquée et bloc max", "hangboard", "gym", 120, ["Chauffe", [exercise("chauffe", "Suspensions progressives", { hang: true })]], ["Poutre", [SEMI]], ["Bloc", [exercise("limit", "Blocs à vue max")]]),
	workout("mercredi", "Abrahangs", "hangboard", "home", 20, ["Poutre", [ABRAHANGS]]),
	workout("jeudi", "Volume", "boulder", "gym", 90, ["Continuité", [exercise("continuite", "4×4")]], ["Gainage", [exercise("gainage", "Gainage")]]),
	workout("samedi", "Main ouverte et projet", "hangboard", "gym", 150, ["Poutre", [OPEN]], ["Projet", [exercise("projet", "Projet")]], ["Tirage", [PULLS]]),
	workout("voie", "Voie", "route", "gym", 120, ["Voie", [exercise("voie", "Voies")]]),
	workout("test", "Test du max", "hangboard", "home", 45, ["Test", [exercise("max", "Max 10 s", { hang: true })]]),
];

export const slots = (...ids: string[]) => ids.map(workout => ({ workout, optional: workout === "voie" }));
const WEEK: WeekSlots = { mon: slots("hanche"), tue: slots("mardi"), wed: slots("hanche", "mercredi"), thu: slots("jeudi"), fri: slots("hanche"), sat: slots("samedi"), sun: slots("voie") };
const DELOAD: WeekSlots = { mon: slots("hanche"), tue: [], wed: slots("hanche"), thu: slots("jeudi"), fri: slots("hanche"), sat: [], sun: [] };
const phase = (id: string, start: string, end: string, deloadMondays: string[]): Phase => ({ id, name: id, start, end, week: WEEK, deloadWeek: DELOAD, deloadMondays });

/** The plan from 16 November 2026 to the February tests, with the August test: a 112 kg total max at 82 kg. */
export const STATE: SportState = {
	v: 1,
	metrics: [
		{ id: "max", label: "Max total", unit: "kg", better: "higher" },
		{ id: "bodyweight", label: "Poids", unit: "kg", better: "lower" },
	],
	measurements: [measurement("m1", "max", 112, "2026-08-26"), measurement("m2", "bodyweight", 82, "2026-08-26")],
	targets: [
		{ id: "t1", label: "Max", by: "2027-02-07", kind: "metric", metric: "max", value: 119 },
		{ id: "t2", label: "Bloc", by: null, kind: "boulder", grade: "8a" },
	],
	plan: {
		title: "Grimpe novembre 2026 à janvier 2027",
		habits: [
			{ label: "Créatine 3 à 5 g", routine: null },
			{ label: "Étirements 10 min", routine: "etirements" },
		],
		routines: [
			{ id: "etirements", name: "Étirements", minutes: 10, items: ["s1", "s2", "s3", "s4", "s5"].map(key => exercise(key, key)) },
			{ id: "hanche", name: "Mobilité hanche", minutes: 15, items: ["h1", "h2", "h3"].map(key => exercise(key, key)) },
		],
		workouts: WORKOUTS,
		phases: [phase("transition", "2026-11-16", "2026-12-06", ["2026-11-30"]), phase("phase-1", "2026-12-07", "2027-01-03", ["2026-12-21"]), phase("phase-2", "2027-01-04", "2027-01-31", ["2027-01-25"])],
		overrides: [{ date: "2026-12-29", slots: slots("test") }],
	},
	log: [],
	checks: [],
};

export const withLogs = (state: SportState, ...logs: WorkoutLog[]): SportState => ({ ...state, log: [...state.log, ...logs].toSorted((a, b) => a.date.localeCompare(b.date)) });
export const withMeasurements = (state: SportState, ...added: Measurement[]): SportState => ({ ...state, measurements: [...state.measurements, ...added].toSorted((a, b) => a.at.localeCompare(b.at)) });
