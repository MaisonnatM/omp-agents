import { describe, expect, test } from "bun:test";
import { EMPTY_SPORT, type Measurement, type Plan, type SportChange, type SportState, type WorkoutLog } from "./shared/sport";
import { applySport } from "./sport";

const log = (id: string, date: string, fields: Partial<WorkoutLog> = {}): WorkoutLog => ({
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
const measurement = (id: string, at: string, value = 112): Measurement => ({ id, metric: "max", value, at, note: "", addedBy: null });
const after = (state: SportState, ...changes: SportChange[]): SportState => changes.reduce(applySport, state);
const logIds = ({ log }: SportState): string => log.map(({ id }) => id).join(" ");
const measurementIds = ({ measurements }: SportState): string => measurements.map(({ id }) => id).join(" ");

const PLAN: Plan = { title: "Grimpe", habits: [], routines: [], workouts: [], phases: [], overrides: [] };

describe("applySport", () => {
	test("sets the plan, the targets, and the metrics, and changes nothing when they are the same", () => {
		const state = after(
			EMPTY_SPORT,
			{ op: "set-plan", plan: PLAN },
			{ op: "set-targets", targets: [{ id: "max", label: "Max", by: "2027-02-07", kind: "metric", metric: "max", value: 119 }] },
			{ op: "set-metrics", metrics: [{ id: "max", label: "Max", unit: "kg", better: "higher" }] },
		);
		expect(state.plan).toEqual(PLAN);
		expect(state.targets.map(({ id }) => id)).toEqual(["max"]);
		expect(state.metrics.map(({ id }) => id)).toEqual(["max"]);
		expect(applySport(state, { op: "set-plan", plan: structuredClone(PLAN) })).toBe(state);
		expect(applySport(state, { op: "set-targets", targets: structuredClone(state.targets) })).toBe(state);
		expect(applySport(state, { op: "set-metrics", metrics: structuredClone(state.metrics) })).toBe(state);
		expect(applySport(state, { op: "set-plan", plan: null }).plan).toBeNull();
	});

	test("keeps the log ordered by date, a day's logs in the order they came", () => {
		const state = after(EMPTY_SPORT, ...[log("sat", "2026-11-21"), log("tue", "2026-11-17"), log("thu", "2026-11-19"), log("tue2", "2026-11-17")].map(entry => ({ op: "add-log" as const, log: entry })));
		expect(logIds(state)).toBe("tue tue2 thu sat");
	});

	test("adds a log once", () => {
		const state = after(EMPTY_SPORT, { op: "add-log", log: log("a", "2026-11-17") });
		expect(applySport(state, { op: "add-log", log: log("a", "2026-11-18", { title: "other" }) })).toBe(state);
	});

	test("an edit replaces the log and moves it when its date changes", () => {
		const state = after(EMPTY_SPORT, ...[log("a", "2026-11-17"), log("b", "2026-11-19"), log("c", "2026-11-21")].map(entry => ({ op: "add-log" as const, log: entry })));
		const edited = applySport(state, { op: "edit-log", log: log("a", "2026-11-20", { rpe: 8 }) });
		expect(logIds(edited)).toBe("b a c");
		expect(edited.log[1]).toMatchObject({ date: "2026-11-20", rpe: 8 });
		expect(applySport(state, { op: "edit-log", log: log("b", "2026-11-19", { rpe: 6 }) }).log[1]?.rpe).toBe(6);
		expect(applySport(state, { op: "edit-log", log: log("b", "2026-11-19") })).toBe(state);
		expect(applySport(state, { op: "edit-log", log: log("z", "2026-11-19") })).toBe(state);
	});

	test("removes a log and restores it at its index", () => {
		const state = after(EMPTY_SPORT, ...[log("a", "2026-11-17"), log("b", "2026-11-17"), log("c", "2026-11-17")].map(entry => ({ op: "add-log" as const, log: entry })));
		const removed = applySport(state, { op: "remove-log", id: "b" });
		expect(logIds(removed)).toBe("a c");
		expect(applySport(removed, { op: "remove-log", id: "b" })).toBe(removed);
		const restored = applySport(removed, { op: "restore-log", log: log("b", "2026-11-17"), index: 1 });
		expect(logIds(restored)).toBe("a b c");
		expect(applySport(restored, { op: "restore-log", log: log("b", "2026-11-17"), index: 0 })).toBe(restored);
	});

	test("a restore whose index no longer fits its date goes where its date puts it", () => {
		const state = after(EMPTY_SPORT, ...[log("a", "2026-11-17"), log("c", "2026-11-21")].map(entry => ({ op: "add-log" as const, log: entry })));
		expect(logIds(applySport(state, { op: "restore-log", log: log("b", "2026-11-19"), index: 0 }))).toBe("a b c");
		expect(logIds(applySport(state, { op: "restore-log", log: log("d", "2026-11-25"), index: 99 }))).toBe("a c d");
	});

	test("keeps measurements ordered by date, removes one, and restores it at its index", () => {
		const state = after(
			EMPTY_SPORT,
			{ op: "add-measurement", measurement: measurement("nov", "2026-11-17", 117) },
			{ op: "add-measurement", measurement: measurement("aug", "2026-08-26") },
			{ op: "add-measurement", measurement: measurement("aug", "2026-08-27") },
		);
		expect(measurementIds(state)).toBe("aug nov");
		const removed = applySport(state, { op: "remove-measurement", id: "aug" });
		expect(measurementIds(removed)).toBe("nov");
		expect(applySport(removed, { op: "remove-measurement", id: "aug" })).toBe(removed);
		const restored = applySport(removed, { op: "restore-measurement", measurement: measurement("aug", "2026-08-26"), index: 0 });
		expect(restored.measurements).toEqual(state.measurements);
		expect(applySport(restored, { op: "restore-measurement", measurement: measurement("aug", "2026-08-26"), index: 0 })).toBe(restored);
	});
});
