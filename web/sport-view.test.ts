import { describe, expect, test } from "bun:test";
import { exercise, log, measurement, SEMI, STATE, withLogs, withMeasurements } from "../src/sport-fixtures";
import type { Climb, FrenchGrade, Plan } from "../src/shared/sport";
import { dayPlan, loadFor, records } from "../src/sport-week";
import { amount, beaten, bodyweightOf, daySummary, demosOf, dose, effortWord, exerciseName, hardest, journalWeeks, loadSource, loadText, logDetail, logSave, measured, nextTest, opening, painRule, painWord, phaseLabel, recordLogs, recordRows, REMOVED_TEXT, sendsText, signedAmount, signedKg, testOf, weekTitle, workoutDemos, workoutOf } from "./sport-view";

const plan = STATE.plan!;
const demo = (youtubeId: string) => ({ youtubeId, by: "Lattice", cues: ["a", "b", "c"] as [string, string, string], caution: null });

describe("loads", () => {
	test("Tuesday 17 November calls for +15 kg on the semi-crimp, from the August test", () => {
		const day = dayPlan(STATE, "2026-11-17");
		const semi = day.workouts[0]!.blocks[1]!.items[0]!;
		expect(loadText(semi.exercise, semi.load)).toBe("+15 kg");
		expect(loadSource(semi.load)).toBe("D'après le test du 26 août");
		expect(daySummary(day)).toMatchObject({ title: "Semi-arquée et bloc max", detail: "≈ 2 h · +15 kg", done: false });
	});

	test("a load with no measurement for its rule is a load to test", () => {
		const state = { ...STATE, measurements: [] };
		expect(loadText(SEMI, loadFor(state, SEMI, "2026-11-17"))).toBe("charge à tester");
		expect(loadText(exercise("limit", "Blocs"), null)).toBeNull();
	});

	test("a logged load names the day it was lifted", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi", loads: { semi: 17 } }));
		expect(loadSource(loadFor(state, SEMI, "2026-11-24"))).toBe("Dernière fois +17 kg · 17 nov.");
	});
});

describe("days", () => {
	test("an optional workout says so", () => {
		expect(daySummary(dayPlan(STATE, "2026-11-22"))).toMatchObject({ title: "Voie", detail: "option · ≈ 2 h" });
	});

	test("a rest day has no workout", () => {
		expect(daySummary(dayPlan(STATE, "2026-12-01"))).toEqual({ title: "Repos", kind: null, detail: "", done: false });
	});

	test("a day is done once each workout not optional is logged done", () => {
		const state = withLogs(STATE, log("l1", "2026-11-18", { workout: "hanche" }));
		expect(daySummary(dayPlan(state, "2026-11-18")).done).toBe(false);
		expect(daySummary(dayPlan(withLogs(state, log("l2", "2026-11-18", { workout: "mercredi" })), "2026-11-18")).done).toBe(true);
	});

	test("a finger pain flag shows as a removed hangboard", () => {
		const state = withLogs(STATE, log("l1", "2026-11-16", { pain: { level: 4, where: "fingers" } }));
		expect(daySummary(dayPlan(state, "2026-11-17")).detail).toBe("≈ 2 h · poutre retirée");
	});

	test("weeks and phases read as the page heads them", () => {
		expect(weekTitle("2026-12-14")).toBe("Semaine du 14 au 20 déc.");
		expect(weekTitle("2026-11-30")).toBe("Semaine du 30 novembre au 6 déc.");
		expect(phaseLabel(plan.phases[0]!, "2026-12-01")).toBe("transition · semaine 3 sur 3 · allégée");
	});
});

describe("scales", () => {
	test("pain words", () => {
		expect([0, 1, 2, 3, 5, 6, 7, 8, 10].map(painWord)).toEqual(["Aucune", "Gêne légère", "Gêne légère", "Douleur nette", "Douleur nette", "Forte", "Forte", "Arrête", "Arrête"]);
	});

	test("effort words", () => {
		expect([1, 3, 4, 6, 7, 8, 9, 10].map(effortWord)).toEqual(["Facile", "Facile", "Modéré", "Modéré", "Dur", "Dur", "Très dur", "Maximal"]);
	});
});

describe("demos", () => {
	const withDemos: Plan = { ...plan, routines: plan.routines.map(routine => (routine.id === "hanche" ? { ...routine, items: routine.items.map((item, i) => ({ ...item, demo: demo(`hip-video-${i}`) })) } : routine)) };
	const mobilite = withDemos.workouts.find(({ id }) => id === "hanche")!.blocks[0]!.items[0]!;

	test("« Mobilité hanche » opens as its three demos", () => {
		expect(opening(withDemos, mobilite).map(({ key }) => key)).toEqual(["h1", "h2", "h3"]);
		expect(demosOf(withDemos, [mobilite]).map(({ key }) => key)).toEqual(["h1", "h2", "h3"]);
	});

	test("a climb has no demo, and an exercise opens as itself", () => {
		expect(demosOf(withDemos, [exercise("limit", "Blocs"), SEMI]).map(({ key }) => key)).toEqual(["semi"]);
	});

	test("a workout's rows point at their first demo among the workout's, in block order", () => {
		const mardi = dayPlan(STATE, "2026-11-17").workouts[0]!;
		const chauffe = mardi.blocks[0]!.items[0]!;
		const workout = { ...mardi, blocks: [{ title: "Hanche", items: [{ ...chauffe, exercise: mobilite }] }, ...mardi.blocks] };
		const { demos, blocks } = workoutDemos(withDemos, workout);
		expect(demos.map(({ key }) => key)).toEqual(["h1", "h2", "h3", "semi"]);
		expect(blocks.map(({ title, rows }) => [title, rows.map(({ item, at }) => [item.exercise.key, at])])).toEqual([
			["Hanche", [["mobilite", 0]]],
			["Chauffe", [["chauffe", null]]],
			["Poutre", [["semi", 3]]],
			["Bloc", [["limit", null]]],
		]);
	});

	test("a dose reads sets, hold, side, and rest", () => {
		expect(dose(SEMI)).toBe("5 × 10 s · 3 min de repos");
		expect(dose(exercise("pulls", "Tractions", { sets: 3, reps: 3 }))).toBe("3 × 3");
		expect(dose(exercise("s1", "Ischios", { sets: 2, holdSec: 45, perSide: true }))).toBe("2 × 45 s par côté");
	});
});

describe("tests and records", () => {
	test("the test day tests the max, which its loads read less the bodyweight", () => {
		const test = testOf(STATE, dayPlan(STATE, "2026-12-29").workouts[0]!);
		expect(test?.exercise.key).toBe("max");
		expect(test?.metric.id).toBe("max");
		expect(test?.bodyweight?.id).toBe("bodyweight");
		expect(testOf(STATE, dayPlan(STATE, "2026-11-17").workouts[0]!)).toBeNull();
	});

	test("a new max and a heavier load are records beaten, with the best before", () => {
		const before = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi", loads: { semi: 15 } }));
		const after = withMeasurements(withLogs(before, log("l2", "2026-11-24", { workout: "mardi", loads: { semi: 17 }, climbs: [{ kind: "boulder", grade: "7a+", color: "noir", kilter: false, attempts: null }] })), measurement("m3", "max", 117, "2026-11-24"));
		expect(beaten(after, records(before), records(after))).toEqual([
			{ label: "Max total", now: "117 kg", was: "112 kg" },
			{ label: "Meilleur bloc", now: "7a+", was: null },
			{ label: "Semi-arquée", now: "+17 kg", was: "+15 kg" },
		]);
	});

	test("a harder route is the best route beaten, and the records table words it the same", () => {
		const route = (grade: FrenchGrade): Climb => ({ kind: "route", grade, color: null, kilter: false, attempts: null });
		const before = withLogs(STATE, log("l1", "2026-11-22", { climbs: [route("7a")] }));
		const after = withLogs(before, log("l2", "2026-11-29", { climbs: [route("7b")] }));
		expect(beaten(after, records(before), records(after))).toEqual([{ label: "Meilleure voie", now: "7b", was: "7a" }]);
		expect(recordRows(after, records(after)).find(({ key }) => key === "route")).toEqual({ key: "route", label: "Meilleure voie", value: "7b", date: "2026-11-29" });
	});
});

describe("journal and progress", () => {
	const climb = (grade: FrenchGrade): Climb => ({ kind: "boulder", grade, color: null, kilter: false, attempts: null });

	test("an amount reads the French way", () => {
		expect(amount(113.3, "kg")).toBe("113,3 kg");
		expect(amount(5, "")).toBe("5");
	});

	test("a difference reads with its sign, and a load of zero is the bodyweight alone", () => {
		expect(signedAmount(1.5, "kg")).toBe("+1,5 kg");
		expect(signedAmount(-2, "kg")).toBe("−2 kg");
		expect(signedKg(-5)).toBe("−5 kg");
		expect(signedKg(0)).toBe("poids du corps");
	});

	test("an exercise reads by its name, or its key when the plan has none, and a log finds its workout", () => {
		expect(exerciseName(plan, "semi")).toBe("Semi-arquée");
		expect(exerciseName(null, "semi")).toBe("semi");
		expect(workoutOf(plan, "mardi")?.minutes).toBe(120);
		expect(workoutOf(plan, null)).toBeNull();
	});

	test("the bodyweight is the metric a max rule subtracts, and measurements come oldest first", () => {
		expect(bodyweightOf(STATE)?.id).toBe("bodyweight");
		expect(bodyweightOf({ ...STATE, plan: null })).toBeNull();
		const state = withMeasurements(STATE, measurement("m4", "bodyweight", 80, "2026-12-01"), measurement("m3", "bodyweight", 81, "2026-11-01"));
		expect(measured(state, "bodyweight").map(({ value }) => value)).toEqual([82, 81, 80]);
	});

	test("a session's sends read their count and the hardest grade", () => {
		expect(hardest([climb("6c"), climb("7b+"), climb("7a")])?.grade).toBe("7b+");
		expect(sendsText([climb("6c"), climb("7b+")])).toBe("2 · 7b+");
		expect(sendsText([])).toBe("aucune");
	});

	test("a journal row reads the heaviest load, the hardest grade, the effort, and the pain", () => {
		expect(logDetail(log("l1", "2026-11-17", { loads: { semi: 15, open: 10 }, climbs: [climb("7b+")], rpe: 8, pain: { level: 4, where: "fingers" } }))).toBe("+15 kg · 7b+ · effort 8 · ⚠ doigts 4/10");
		expect(logDetail(log("l2", "2026-11-17", { status: "skipped", rpe: 8 }))).toBe("pas faite");
		expect(logDetail(log("l3", "2026-11-17"))).toBe("");
	});

	test("only the log that first reached a record is marked", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi", loads: { semi: 15 } }), log("l2", "2026-11-24", { workout: "mardi", loads: { semi: 17 }, climbs: [climb("7a")] }), log("l3", "2026-12-01", { workout: "mardi", loads: { semi: 16 } }));
		expect([...recordLogs(records(state))]).toEqual(["l2"]);
	});

	test("the journal groups logs by week, newest first, and counts the done ones and their planned minutes", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi" }), log("l2", "2026-11-19", { workout: "jeudi" }), log("l3", "2026-11-24", { workout: "mardi", status: "skipped" }));
		expect(journalWeeks(state).map(({ monday, logs, done, minutes }) => ({ monday, logs: logs.map(({ id }) => id), done, minutes }))).toEqual([
			{ monday: "2026-11-23", logs: ["l3"], done: 0, minutes: 0 },
			{ monday: "2026-11-16", logs: ["l2", "l1"], done: 2, minutes: 210 },
		]);
	});

	test("the next test is the first override day from today that tests the metric", () => {
		expect(nextTest(STATE, "max", "2026-11-17")).toBe("2026-12-29");
		expect(nextTest(STATE, "max", "2026-12-30")).toBeNull();
		expect(nextTest(STATE, "bodyweight", "2026-11-17")).toBeNull();
	});

	test("a finger pain words the hangs removed, any other pain words it watched", () => {
		expect(painRule("fingers")).toEqual({ warning: "Douleur aux doigts à 3 ou plus : la poutre sera retirée 7 jours.", effect: "Poutre et suspensions retirées" });
		expect(painRule("elbow")).toEqual({ warning: "Douleur au coude à 3 ou plus : elle sera signalée 7 jours.", effect: "À surveiller" });
		expect(REMOVED_TEXT).toBe("retiré · douleur aux doigts");
	});
});

describe("a Fait save", () => {
	const max = STATE.metrics[0]!;
	const testDay = dayPlan(STATE, "2026-12-29").workouts[0]!;

	test("a plain day saves its log alone, and sums up the load it beat", () => {
		const done = log("n1", "2026-11-17", { workout: "mardi", loads: { semi: 20 } });
		const { changes, saved } = logSave(STATE, { date: "2026-11-17", workout: dayPlan(STATE, "2026-11-17").workouts[0]!, log: null }, { log: done, max: null, weight: null });
		expect(changes).toEqual([{ op: "add-log", log: done }]);
		expect(saved).toEqual({ log: done, minutes: 120, beaten: [{ label: "Semi-arquée", now: "+20 kg", was: null }], test: null });
	});

	test("a test day saves its log, the new max, and the weigh-in in one batch, and leaves the max out of the records it beat", () => {
		const done = log("t1", "2026-12-29", { workout: "test" });
		const { changes, saved } = logSave(STATE, { date: "2026-12-29", workout: testDay, log: null }, { log: done, max: 118, weight: 81 });
		expect(changes).toEqual([
			{ op: "add-log", log: done },
			{ op: "add-measurement", measurement: { id: expect.any(String), metric: "max", value: 118, at: "2026-12-29", note: "", addedBy: null } },
			{ op: "add-measurement", measurement: { id: expect.any(String), metric: "bodyweight", value: 81, at: "2026-12-29", note: "", addedBy: null } },
		]);
		expect(saved.test).toEqual({ metric: max, value: 118, was: STATE.measurements[0]! });
		expect(saved.beaten.map(({ label }) => label)).not.toContain(max.label);
	});

	test("an edit replaces the log and that day's measurements rather than adding to them", () => {
		const existing = log("t1", "2026-12-29", { workout: "test" });
		const tested = measurement("m3", "max", 115, "2026-12-29");
		const weighed = measurement("m4", "bodyweight", 82, "2026-12-29");
		const state = withMeasurements(withLogs(STATE, existing), tested, weighed);
		const done = { ...existing, note: "Mieux" };
		const { changes, saved } = logSave(state, { date: "2026-12-29", workout: testDay, log: existing }, { log: done, max: 118, weight: 81 });
		expect(changes).toEqual([
			{ op: "edit-log", log: done },
			{ op: "edit-measurement", measurement: { ...tested, value: 118 } },
			{ op: "edit-measurement", measurement: { ...weighed, value: 81 } },
		]);
		expect(saved.test).toEqual({ metric: max, value: 118, was: STATE.measurements[0]! });
	});
});
