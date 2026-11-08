import { describe, expect, test } from "bun:test";
import { EMPTY_SPORT, type Measurement, type Metric, type Plan, type SportChange, type SportState } from "./shared/sport";
import { applySport, applySportChanges } from "./sport";
import { exercise, log, measurement } from "./sport-fixtures";

const max = (id: string, at: string, value = 112): Measurement => measurement(id, "max", value, at);
const after = (state: SportState, ...changes: SportChange[]): SportState => changes.reduce(applySport, state);
const logIds = ({ log }: SportState): string => log.map(({ id }) => id).join(" ");
const measurementIds = ({ measurements }: SportState): string => measurements.map(({ id }) => id).join(" ");

const PLAN: Plan = { title: "Grimpe", habits: [], routines: [], workouts: [], phases: [], overrides: [] };
const MAX_METRIC: Metric = { id: "max", label: "Max", unit: "kg", better: "higher" };
const WITH_MAX: SportState = { ...EMPTY_SPORT, metrics: [MAX_METRIC] };
const STRETCHED: Plan = { ...PLAN, routines: [{ id: "etirements", name: "Étirements", minutes: 10, items: ["s1", "s2", "s3"].map(key => exercise(key, key)) }] };
const tick = (date: string, ...items: string[]): SportChange => ({ op: "set-check", check: { date, routine: "etirements", items } });

describe("applySport", () => {
	test("sets the plan, the targets, and the metrics, and changes nothing when they are the same", () => {
		const state = after(
			EMPTY_SPORT,
			{ op: "set-metrics", metrics: [MAX_METRIC] },
			{ op: "set-plan", plan: PLAN },
			{ op: "set-targets", targets: [{ id: "max", label: "Max", by: "2027-02-07", kind: "metric", metric: "max", value: 119 }] },
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
			WITH_MAX,
			{ op: "add-measurement", measurement: max("nov", "2026-11-17", 117) },
			{ op: "add-measurement", measurement: max("aug", "2026-08-26") },
			{ op: "add-measurement", measurement: max("aug", "2026-08-27") },
		);
		expect(measurementIds(state)).toBe("aug nov");
		const removed = applySport(state, { op: "remove-measurement", id: "aug" });
		expect(measurementIds(removed)).toBe("nov");
		expect(applySport(removed, { op: "remove-measurement", id: "aug" })).toBe(removed);
		const restored = applySport(removed, { op: "restore-measurement", measurement: max("aug", "2026-08-26"), index: 0 });
		expect(restored.measurements).toEqual(state.measurements);
		expect(applySport(restored, { op: "restore-measurement", measurement: max("aug", "2026-08-26"), index: 0 })).toBe(restored);
	});

	test("edits a measurement in place, moves it when its day changes, and changes nothing for an unknown id or the same value", () => {
		const state = after(WITH_MAX, { op: "add-measurement", measurement: max("aug", "2026-08-26") }, { op: "add-measurement", measurement: max("nov", "2026-11-17", 117) });
		const fixed = applySport(state, { op: "edit-measurement", measurement: max("nov", "2026-11-17", 118) });
		expect(fixed.measurements.map(({ value }) => value)).toEqual([112, 118]);
		expect(measurementIds(applySport(state, { op: "edit-measurement", measurement: max("aug", "2026-12-01") }))).toBe("nov aug");
		expect(applySport(state, { op: "edit-measurement", measurement: max("aug", "2026-08-26") })).toBe(state);
		expect(applySport(state, { op: "edit-measurement", measurement: max("sep", "2026-09-01") })).toBe(state);
	});

	test("refuses a change that names a metric the state does not hold, and a set-metrics that drops one still named", () => {
		const bodyweight: Metric = { id: "bodyweight", label: "Poids", unit: "kg", better: "lower" };
		const rule = { kind: "of-max" as const, metric: "max", fraction: 0.87, offsetKg: 0, less: "bodyweight" };
		const plan: Plan = { ...PLAN, workouts: [{ id: "mardi", name: "Mardi", kind: "hangboard", place: "gym", minutes: 60, blocks: [{ title: "Poutre", items: [{ ...exercise("semi", "Semi"), load: rule }] }] }] };
		expect(applySport(EMPTY_SPORT, { op: "add-measurement", measurement: max("aug", "2026-08-26") })).toBe(EMPTY_SPORT);
		expect(applySport(EMPTY_SPORT, { op: "set-targets", targets: [{ id: "t", label: "Max", by: null, kind: "metric", metric: "max", value: 119 }] })).toBe(EMPTY_SPORT);
		expect(applySport(WITH_MAX, { op: "set-plan", plan })).toBe(WITH_MAX);
		const state = after(WITH_MAX, { op: "set-metrics", metrics: [MAX_METRIC, bodyweight] }, { op: "set-plan", plan });
		expect(state.plan).toEqual(plan);
		expect(applySport(state, { op: "set-metrics", metrics: [MAX_METRIC] })).toBe(state);
		const measured = applySport(WITH_MAX, { op: "add-measurement", measurement: max("aug", "2026-08-26") });
		expect(applySport(measured, { op: "edit-measurement", measurement: measurement("aug", "poids", 82, "2026-08-26") })).toBe(measured);
		expect(applySport(measured, { op: "set-metrics", metrics: [bodyweight] })).toBe(measured);
		expect(applySport(WITH_MAX, { op: "set-metrics", metrics: [bodyweight] }).metrics).toEqual([bodyweight]);
	});

	test("sets a day's ticks of a routine in the routine's order, replaces them, and an empty list removes them", () => {
		const start = { ...EMPTY_SPORT, plan: STRETCHED };
		const ticked = after(start, tick("2026-11-17", "s3", "s1", "s3"), tick("2026-11-16", "s2"));
		expect(ticked.checks).toEqual([
			{ date: "2026-11-16", routine: "etirements", items: ["s2"] },
			{ date: "2026-11-17", routine: "etirements", items: ["s1", "s3"] },
		]);
		expect(applySport(ticked, tick("2026-11-17", "s1", "s3"))).toBe(ticked);
		expect(after(ticked, tick("2026-11-17", "s2", "s1")).checks[1]?.items).toEqual(["s1", "s2"]);
		expect(after(ticked, tick("2026-11-17")).checks.map(({ date }) => date)).toEqual(["2026-11-16"]);
		expect(applySport(start, tick("2026-11-17"))).toBe(start);
	});

	test("refuses ticks of a routine or an item the plan does not hold, with the path of the field", () => {
		const start = { ...EMPTY_SPORT, plan: STRETCHED };
		expect(applySportChanges(EMPTY_SPORT, [tick("2026-11-17", "s1")])).toEqual({ error: "check.routine must name a routine of the plan, not etirements" });
		expect(applySportChanges(start, [{ op: "set-check", check: { date: "2026-11-17", routine: "hanche", items: [] } }])).toEqual({ error: "check.routine must name a routine of the plan, not hanche" });
		expect(applySportChanges(start, [tick("2026-11-17", "s1", "h1")])).toEqual({ error: "check.items[1] must name an item of routine etirements, not h1" });
		expect(applySportChanges(start, [tick("17/11/2026", "s1")])).toEqual({ error: "check.date must be a YYYY-MM-DD day" });
	});
});

describe("applySportChanges", () => {
	test("applies every change in order, each checked against what the ones before it leave", () => {
		const changes: SportChange[] = [{ op: "set-metrics", metrics: [MAX_METRIC] }, { op: "add-measurement", measurement: max("aug", "2026-08-26") }, { op: "add-log", log: log("a", "2026-08-26") }];
		expect(applySportChanges(EMPTY_SPORT, changes)).toEqual({ ok: after(EMPTY_SPORT, ...changes) });
	});

	test("one refused change refuses the whole batch, with its reason", () => {
		const refused = applySportChanges(EMPTY_SPORT, [{ op: "add-log", log: log("a", "2026-08-26") }, { op: "add-measurement", measurement: max("aug", "2026-08-26") }]);
		expect(refused).toEqual({ error: expect.stringContaining("max") });
	});
});
