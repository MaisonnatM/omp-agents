import { describe, expect, test } from "bun:test";
import { EMPTY_SPORT } from "./shared/sport";
import { log } from "./sport-fixtures";
import { MAX_SPORT_ID, MAX_SPORT_ITEMS, MAX_SPORT_NOTE, MAX_SPORT_TEXT, parseSportChange, parseSportState } from "./sport-parse";

const LOG = { id: "l1", date: "2026-11-17", workout: "mardi" };
const READ_LOG = log("l1", "2026-11-17", { workout: "mardi", title: "" });

const plan = (fields: Record<string, unknown> = {}) => ({
	workouts: [{ id: "mardi", name: "Mardi", place: "gym", blocks: [{ title: "Poutre", items: [{ key: "semi", name: "Semi", hang: true, load: { kind: "of-max", metric: "max", fraction: 0.87 } }] }] }],
	routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon" }] }],
	habits: [{ label: "Hanche", routine: "hanche" }],
	phases: [{ id: "p1", name: "Transition", start: "2026-11-16", end: "2026-12-06", week: { tue: [{ workout: "mardi" }] }, deloadMondays: ["2026-11-30"] }],
	...fields,
});

describe("parseSportState", () => {
	test("reads an empty object, or one with no version, as an empty state of this version", () => {
		expect(parseSportState({})).toEqual(EMPTY_SPORT);
		expect(parseSportState({ v: 0 })).toEqual(EMPTY_SPORT);
	});

	test("fills the defaults, drops unknown fields, and orders the log and the measurements by date", () => {
		const state = parseSportState({
			v: 1,
			extra: true,
			measurements: [
				{ id: "b", metric: "max", value: 117, at: "2026-11-17" },
				{ id: "a", metric: "max", value: 112, at: "2026-08-26", extra: 1 },
			],
			log: [{ ...LOG, id: "l2", date: "2026-11-21" }, LOG],
			plan: plan(),
		});
		expect(state?.measurements).toEqual([
			{ id: "a", metric: "max", value: 112, at: "2026-08-26", note: "", addedBy: null },
			{ id: "b", metric: "max", value: 117, at: "2026-11-17", note: "", addedBy: null },
		]);
		expect(state?.log.map(({ id }) => id)).toEqual(["l1", "l2"]);
		expect(state?.log[0]).toEqual(READ_LOG);
		expect(state?.plan?.workouts[0]?.blocks[0]?.items[0]).toEqual({
			key: "semi",
			name: "Semi",
			sets: null,
			reps: null,
			holdSec: null,
			restSec: null,
			load: { kind: "of-max", metric: "max", fraction: 0.87, offsetKg: 0, less: null },
			note: "",
			demo: null,
			opensAs: [],
			hang: true,
		});
		expect(state?.plan?.phases[0]?.week).toEqual({ mon: [], tue: [{ workout: "mardi", optional: false }], wed: [], thu: [], fri: [], sat: [], sun: [] });
		expect(state && "extra" in state).toBe(false);
	});

	test("refuses a newer version or a field of the wrong shape or type", () => {
		for (const value of [
			null,
			[],
			{ v: 2 },
			{ v: "1" },
			{ log: [{ ...LOG, date: "2026-11-31" }] },
			{ log: [{ ...LOG, rpe: "hard" }] },
			{ log: [{ ...LOG, pain: { level: 4, where: "knee" } }] },
			{ log: [{ ...LOG, loads: { semi: "15" } }] },
			{ log: [{ ...LOG, climbs: [{ kind: "boulder", grade: "7d" }] }] },
			{ measurements: [{ id: "a", metric: "max", value: "112", at: "2026-08-26" }] },
			{ metrics: [{ id: "max", label: "Max", better: "more" }] },
			{ targets: [{ id: "t", label: "Bloc", kind: "boulder", grade: "8a", by: "soon" }] },
			{ targets: [{ id: "t", label: "Max", kind: "metric", value: 119 }] },
			{ plan: "plan" },
			{ plan: plan({ workouts: [{ id: "mardi", name: "Mardi", place: "beach", blocks: [] }] }) },
			{ plan: plan({ routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon", load: { kind: "percent" } }] }] }) },
		]) {
			expect(parseSportState(value)).toBeNull();
		}
	});

	test("keeps saved data a change would no longer pass, so a tightened rule never loses it", () => {
		const long = "x".repeat(MAX_SPORT_NOTE + 1);
		const state = parseSportState({
			log: [{ ...LOG, note: long, rpe: 11 }, LOG],
			measurements: [{ id: "a", metric: "max", value: 112, at: "2026-08-26", note: long }],
			plan: plan({
				phases: [{ id: "p1", name: "", start: "2026-12-06", end: "2026-11-16", week: { tue: [{ workout: "jeudi" }] }, deloadMondays: ["2026-12-01"] }],
				routines: [{ id: "hanche", name: "Hanche", items: [{ key: "x".repeat(MAX_SPORT_ID + 1), name: "Pigeon", sets: -1, opensAs: ["h9"], demo: { youtubeId: "short", cues: ["a", "b", "c"] } }] }],
			}),
		});
		expect(state?.log.map(({ id, rpe }) => `${id} ${rpe}`)).toEqual(["l1 11", "l1 null"]);
		expect(state?.measurements[0]?.note).toBe(long);
		expect(state?.plan?.phases[0]?.week.tue).toEqual([{ workout: "jeudi", optional: false }]);
		expect(state?.plan?.routines[0]?.items[0]?.demo?.youtubeId).toBe("short");
	});
});

describe("parseSportChange", () => {
	const refusal = (value: unknown): string | null => {
		const parsed = parseSportChange(value);
		return "error" in parsed ? parsed.error : null;
	};
	const withItem = (item: Record<string, unknown>) => ({ op: "set-plan", plan: plan({ routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon", ...item }] }] }) });

	test("reads each change whole", () => {
		expect(parseSportChange({ op: "add-log", log: LOG })).toEqual({ ok: { op: "add-log", log: READ_LOG } });
		expect(parseSportChange({ op: "edit-log", log: LOG })).toEqual({ ok: { op: "edit-log", log: READ_LOG } });
		expect(parseSportChange({ op: "restore-log", log: LOG, index: 2 })).toEqual({ ok: { op: "restore-log", log: READ_LOG, index: 2 } });
		expect(parseSportChange({ op: "remove-log", id: "l1" })).toEqual({ ok: { op: "remove-log", id: "l1" } });
		expect(parseSportChange({ op: "add-measurement", measurement: { id: "m", metric: "max", value: 117, at: "2026-11-17" } })).toMatchObject({ ok: { op: "add-measurement", measurement: { id: "m", note: "" } } });
		expect(parseSportChange({ op: "edit-measurement", measurement: { id: "m", metric: "max", value: 118, at: "2026-11-17" } })).toMatchObject({ ok: { op: "edit-measurement", measurement: { id: "m", value: 118 } } });
		expect(parseSportChange({ op: "remove-measurement", id: "m" })).toEqual({ ok: { op: "remove-measurement", id: "m" } });
		expect(parseSportChange({ op: "set-plan", plan: null })).toEqual({ ok: { op: "set-plan", plan: null } });
		expect(parseSportChange({ op: "set-plan", plan: plan() })).toMatchObject({ ok: { op: "set-plan", plan: { title: "" } } });
		expect(parseSportChange(withItem({ demo: { youtubeId: "3IdQnBtnGjQ", cues: ["a", "b", "c"] } }))).toMatchObject({ ok: { op: "set-plan" } });
		expect(parseSportChange({ op: "set-targets", targets: [{ id: "t", label: "Bloc", kind: "boulder", grade: "8a" }] })).toEqual({ ok: { op: "set-targets", targets: [{ id: "t", label: "Bloc", by: null, kind: "boulder", grade: "8a" }] } });
		expect(parseSportChange({ op: "set-metrics", metrics: [{ id: "max", label: "Max" }] })).toEqual({ ok: { op: "set-metrics", metrics: [{ id: "max", label: "Max", unit: "", better: "higher" }] } });
	});

	test("refuses an unknown op or a wrong part with the path of the field and the rule it broke", () => {
		expect(refusal(null)).toBe("the value must be an object");
		expect(refusal({ op: "drop" })).toBe("op must name a Sport change");
		expect(refusal({ op: "add-log" })).toBe("log must be an object");
		expect(refusal({ op: "add-log", log: { ...LOG, status: "maybe" } })).toBe("log.status must be one of done, skipped");
		expect(refusal({ op: "add-log", log: { ...LOG, rpe: 11 } })).toBe("log.rpe must be a whole number from 1 to 10, or null");
		expect(refusal({ op: "add-log", log: { ...LOG, note: "x".repeat(MAX_SPORT_NOTE + 1) } })).toBe(`log.note must be a string of at most ${MAX_SPORT_NOTE} characters`);
		expect(refusal({ op: "add-log", log: { ...LOG, climbs: [{ kind: "boulder", grade: "7a" }, { kind: "boulder", grade: "7a", attempts: 0 }] } })).toBe("log.climbs[1].attempts must be a whole number from 1, or null");
		expect(refusal({ op: "add-log", log: { ...LOG, loads: { ["x".repeat(MAX_SPORT_ID + 1)]: 15 } } })).toStartWith("log.loads must map");
		expect(refusal({ op: "restore-log", log: LOG })).toBe("index must be a whole number from 0");
		expect(refusal({ op: "restore-log", log: LOG, index: -1 })).toBe("index must be a whole number from 0");
		expect(refusal({ op: "restore-measurement", measurement: { id: "m", metric: "max", value: 117, at: "2026-11-17" }, index: 1.5 })).toBe("index must be a whole number from 0");
		expect(refusal({ op: "remove-log", id: "" })).toBe(`id must be 1 to ${MAX_SPORT_ID} characters`);
		expect(refusal({ op: "set-plan" })).toBe("plan must be an object");
		expect(refusal({ op: "set-targets", targets: "t" })).toBe("targets must be a list");
		expect(refusal({ op: "set-targets", targets: Array.from({ length: MAX_SPORT_ITEMS + 1 }, (_, i) => ({ id: `t${i}`, label: "Bloc", kind: "boulder", grade: "7a" })) })).toBe(`targets must hold at most ${MAX_SPORT_ITEMS} items`);
		expect(refusal({ op: "set-metrics", metrics: [{ id: "max", label: "Max" }, { id: "max", label: "Max" }] })).toBe("metrics must not repeat max");
	});

	test("refuses a wrong exercise", () => {
		expect(refusal(withItem({ load: { kind: "of-max", metric: "max", fraction: 1.2 } }))).toBe("plan.routines[0].items[0].load.fraction must be above 0 and at most 1");
		expect(refusal(withItem({ load: { kind: "of-max", metric: "max", fraction: 0 } }))).toBe("plan.routines[0].items[0].load.fraction must be above 0 and at most 1");
		expect(refusal(withItem({ load: { kind: "fixed", kg: "35" } }))).toBe("plan.routines[0].items[0].load.kg must be a number");
		expect(refusal(withItem({ load: { kind: "percent" } }))).toBe("plan.routines[0].items[0].load.kind must be one of of-max, fixed");
		expect(refusal(withItem({ load: { kind: "of-max", metric: "max", fraction: 0.8, less: "" } }))).toBe(`plan.routines[0].items[0].load.less must be 1 to ${MAX_SPORT_ID} characters, or null`);
		expect(refusal(withItem({ demo: { youtubeId: "short", cues: ["a", "b", "c"] } }))).toBe("plan.routines[0].items[0].demo.youtubeId must be 11 characters");
		expect(refusal(withItem({ demo: { youtubeId: "3IdQnBtnGjQ", cues: ["a", "b"] } }))).toBe("plan.routines[0].items[0].demo.cues must be 3 cues");
		expect(refusal(withItem({ sets: -1 }))).toBe("plan.routines[0].items[0].sets must be a whole number from 0, or null");
		expect(refusal(withItem({ hang: "yes" }))).toBe("plan.routines[0].items[0].hang must be true or false");
		expect(refusal(withItem({ name: "" }))).toBe(`plan.routines[0].items[0].name must be 1 to ${MAX_SPORT_TEXT} characters`);
		expect(refusal(withItem({ key: "x".repeat(MAX_SPORT_ID + 1) }))).toBe(`plan.routines[0].items[0].key must be 1 to ${MAX_SPORT_ID} characters`);
	});

	test("refuses a plan whose names point nowhere or whose dates disagree", () => {
		const refusalOf = (fields: Record<string, unknown>) => refusal({ op: "set-plan", plan: plan(fields) });
		const phase = (id: string, start: string, end: string, fields: Record<string, unknown> = {}) => ({ id, name: id, start, end, ...fields });
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06", { week: { tue: [{ workout: "jeudi" }] } })] })).toBe("plan.phases[0].week.tue[0].workout must name a workout of the plan");
		expect(refusalOf({ overrides: [{ date: "2026-12-29", slots: [{ workout: "test" }] }] })).toBe("plan.overrides[0].slots[0].workout must name a workout of the plan");
		expect(refusalOf({ habits: [{ label: "Hanche", routine: "dos" }] })).toBe("plan.habits[0].routine must name a routine of the plan");
		expect(refusalOf({ routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon", opensAs: ["h9"] }] }] })).toBe("plan.routines[0].items[0].opensAs[0] must name an exercise key of the plan");
		expect(refusalOf({ phases: [phase("p1", "2026-12-06", "2026-11-16")] })).toBe("plan.phases[0].end must not come before its start");
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06"), phase("p2", "2026-12-06", "2027-01-03")] })).toBe("plan.phases[0] must not overlap plan.phases[1]");
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06"), phase("p1", "2026-12-07", "2027-01-03")] })).toBe("plan.phases must not repeat p1");
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06", { deloadMondays: ["2026-12-01"] })] })).toBe("plan.phases[0].deloadMondays[0] must be a Monday within its phase");
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06", { deloadMondays: ["2026-12-07"] })] })).toBe("plan.phases[0].deloadMondays[0] must be a Monday within its phase");
		expect(refusalOf({ overrides: [{ date: "2026-12-29", slots: [] }, { date: "2026-12-29", slots: [] }] })).toBe("plan.overrides must not repeat 2026-12-29");
		expect(refusalOf({ phases: [phase("p1", "2026-11-16", "2026-12-06"), phase("p2", "2026-12-14", "2027-01-03")] })).toBeNull();
	});
});
