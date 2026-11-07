import { describe, expect, test } from "bun:test";
import { EMPTY_SPORT, type WorkoutLog } from "./shared/sport";
import { MAX_SPORT_ID, parseSportChange, parseSportState } from "./sport-parse";

const LOG = { id: "l1", date: "2026-11-17", workout: "mardi" };
const READ_LOG: WorkoutLog = { id: "l1", date: "2026-11-17", workout: "mardi", title: "", status: "done", rpe: null, pain: null, loads: {}, climbs: [], note: "", addedBy: null };

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
			load: { kind: "of-max", metric: "max", fraction: 0.87, offsetKg: 0 },
			note: "",
			demo: null,
			opensAs: null,
			hang: true,
		});
		expect(state?.plan?.phases[0]?.week).toEqual({ mon: [], tue: [{ workout: "mardi", optional: false }], wed: [], thu: [], fri: [], sat: [], sun: [] });
		expect(state && "extra" in state).toBe(false);
	});

	test("refuses a newer version or any wrong part", () => {
		for (const value of [
			null,
			[],
			{ v: 2 },
			{ v: "1" },
			{ log: [{ ...LOG, date: "2026-11-31" }] },
			{ log: [LOG, LOG] },
			{ log: [{ ...LOG, rpe: 11 }] },
			{ log: [{ ...LOG, pain: { level: 4, where: "knee" } }] },
			{ log: [{ ...LOG, loads: { semi: "15" } }] },
			{ log: [{ ...LOG, climbs: [{ kind: "boulder", grade: "7d" }] }] },
			{ log: [{ ...LOG, climbs: [{ kind: "boulder", grade: "7a", attempts: 0 }] }] },
			{ measurements: [{ id: "a", metric: "max", value: "112", at: "2026-08-26" }] },
			{ metrics: [{ id: "max", label: "Max", better: "more" }] },
			{ targets: [{ id: "t", label: "Bloc", kind: "boulder", grade: "8a", by: "soon" }] },
			{ targets: [{ id: "t", label: "Max", kind: "metric", value: 119 }] },
			{ plan: "plan" },
		]) {
			expect(parseSportState(value)).toBeNull();
		}
	});

	test("refuses a plan whose names point nowhere or whose phases overlap", () => {
		expect(parseSportState({ plan: plan() })).not.toBeNull();
		for (const fields of [
			{ phases: [{ id: "p1", name: "T", start: "2026-11-16", end: "2026-12-06", week: { tue: [{ workout: "jeudi" }] } }] },
			{ habits: [{ label: "Hanche", routine: "dos" }] },
			{ routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon", opensAs: ["h9"] }] }] },
			{ phases: [{ id: "p1", name: "T", start: "2026-12-06", end: "2026-11-16" }] },
			{
				phases: [
					{ id: "p1", name: "T", start: "2026-11-16", end: "2026-12-06" },
					{ id: "p2", name: "P1", start: "2026-12-06", end: "2027-01-03" },
				],
			},
			{
				phases: [
					{ id: "p1", name: "T", start: "2026-11-16", end: "2026-12-06" },
					{ id: "p1", name: "P1", start: "2026-12-07", end: "2027-01-03" },
				],
			},
			{ phases: [{ id: "p1", name: "T", start: "2026-11-16", end: "2026-12-06", deloadMondays: ["2026-12-01"] }] },
			{ phases: [{ id: "p1", name: "T", start: "2026-11-16", end: "2026-12-06", deloadMondays: ["2026-12-07"] }] },
			{
				overrides: [
					{ date: "2026-12-29", slots: [] },
					{ date: "2026-12-29", slots: [] },
				],
			},
			{ workouts: [{ id: "mardi", name: "Mardi", place: "beach", blocks: [] }] },
		]) {
			expect(parseSportState({ plan: plan(fields) })).toBeNull();
		}
	});

	test("refuses a wrong exercise", () => {
		const withItem = (item: Record<string, unknown>) => ({ plan: plan({ routines: [{ id: "hanche", name: "Hanche", items: [{ key: "h1", name: "Pigeon", ...item }] }] }) });
		expect(parseSportState(withItem({ demo: { youtubeId: "3IdQnBtnGjQ", cues: ["a", "b", "c"] } }))).not.toBeNull();
		for (const item of [
			{ load: { kind: "of-max", metric: "max", fraction: 1.2 } },
			{ load: { kind: "of-max", metric: "max", fraction: 0 } },
			{ load: { kind: "fixed", kg: "35" } },
			{ load: { kind: "percent" } },
			{ demo: { youtubeId: "short", cues: ["a", "b", "c"] } },
			{ demo: { youtubeId: "3IdQnBtnGjQ", cues: ["a", "b"] } },
			{ sets: -1 },
			{ hang: "yes" },
			{ key: "x".repeat(MAX_SPORT_ID + 1) },
		]) {
			expect(parseSportState(withItem(item))).toBeNull();
		}
	});
});

describe("parseSportChange", () => {
	test("reads each change whole", () => {
		expect(parseSportChange({ op: "add-log", log: LOG })).toEqual({ op: "add-log", log: READ_LOG });
		expect(parseSportChange({ op: "edit-log", log: LOG })).toEqual({ op: "edit-log", log: READ_LOG });
		expect(parseSportChange({ op: "restore-log", log: LOG, index: 2 })).toEqual({ op: "restore-log", log: READ_LOG, index: 2 });
		expect(parseSportChange({ op: "remove-log", id: "l1" })).toEqual({ op: "remove-log", id: "l1" });
		expect(parseSportChange({ op: "add-measurement", measurement: { id: "m", metric: "max", value: 117, at: "2026-11-17" } })).toMatchObject({ op: "add-measurement", measurement: { id: "m", note: "" } });
		expect(parseSportChange({ op: "remove-measurement", id: "m" })).toEqual({ op: "remove-measurement", id: "m" });
		expect(parseSportChange({ op: "set-plan", plan: null })).toEqual({ op: "set-plan", plan: null });
		expect(parseSportChange({ op: "set-plan", plan: plan() })).toMatchObject({ op: "set-plan", plan: { title: "" } });
		expect(parseSportChange({ op: "set-targets", targets: [{ id: "t", label: "Bloc", kind: "boulder", grade: "8a" }] })).toEqual({ op: "set-targets", targets: [{ id: "t", label: "Bloc", by: null, kind: "boulder", grade: "8a" }] });
		expect(parseSportChange({ op: "set-metrics", metrics: [{ id: "max", label: "Max" }] })).toEqual({ op: "set-metrics", metrics: [{ id: "max", label: "Max", unit: "", better: "higher" }] });
	});

	test("refuses an unknown op or a wrong part", () => {
		for (const value of [
			null,
			{ op: "drop" },
			{ op: "add-log" },
			{ op: "add-log", log: { ...LOG, status: "maybe" } },
			{ op: "restore-log", log: LOG },
			{ op: "restore-log", log: LOG, index: -1 },
			{ op: "restore-measurement", measurement: { id: "m", metric: "max", value: 117, at: "2026-11-17" }, index: 1.5 },
			{ op: "remove-log", id: "" },
			{ op: "set-plan" },
			{ op: "set-plan", plan: plan({ habits: [{ label: "", routine: null }] }) },
			{ op: "set-targets", targets: "t" },
			{ op: "set-metrics", metrics: [{ id: "max", label: "Max" }, { id: "max", label: "Max" }] },
		]) {
			expect(parseSportChange(value)).toBeNull();
		}
	});
});
