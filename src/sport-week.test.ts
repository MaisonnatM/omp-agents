import { afterEach, describe, expect, test } from "bun:test";
import { BODYWEIGHT, FRENCH_GRADES, gradeRank, mondayOf, type SportState } from "./shared/sport";
import { ABRAHANGS, log, measurement, OPEN, PULLS, SEMI, STATE, withLogs, withMeasurements } from "./sport-fixtures";
import { parseSportState } from "./sport-parse";
import { adherence, bestGrades, loadFor, painFlags, records, weekPlan } from "./sport-week";

/** Each exercise of the day's workouts, by key. */
function dayItems(state: SportState, date: string) {
	const day = weekPlan(state, mondayOf(date)).find(entry => entry.date === date)!;
	return Object.fromEntries(day.workouts.flatMap(({ blocks }) => blocks.flatMap(({ items }) => items.map(item => [item.exercise.key, item]))));
}

describe("weekPlan", () => {
	test("the week of 16 November gives +15 kg half crimp on Tuesday and +10 kg open hand on Saturday", () => {
		const week = weekPlan(STATE, "2026-11-16");
		expect(week.map(({ date, weekday }) => `${weekday} ${date}`)).toEqual(["mon 2026-11-16", "tue 2026-11-17", "wed 2026-11-18", "thu 2026-11-19", "fri 2026-11-20", "sat 2026-11-21", "sun 2026-11-22"]);
		expect(week.map(({ workouts }) => workouts.map(({ workout }) => workout.id).join("+"))).toEqual(["hanche", "mardi", "hanche+mercredi", "jeudi", "hanche", "samedi", "voie"]);
		expect(week[6]?.workouts[0]?.optional).toBe(true);
		expect(week.every(({ phase, deload }) => phase?.id === "transition" && !deload)).toBe(true);
		expect(dayItems(STATE, "2026-11-17").semi?.load).toBe(15);
		expect(dayItems(STATE, "2026-11-21").open?.load).toBe(10);
		expect(dayItems(STATE, "2026-11-21").tractions?.load).toBe(35);
	});

	test("takes the same Monday from any day of its week", () => {
		expect(weekPlan(STATE, "2026-11-22")[0]?.date).toBe("2026-11-16");
	});

	test("a deload week takes the phase's deload slots", () => {
		const week = weekPlan(STATE, "2026-11-30");
		expect(week.every(({ deload }) => deload)).toBe(true);
		expect(week.map(({ workouts }) => workouts.map(({ workout }) => workout.id).join("+"))).toEqual(["hanche", "", "hanche", "jeudi", "hanche", "", ""]);
		expect(weekPlan(STATE, "2026-12-07").some(({ deload }) => deload)).toBe(false);
	});

	test("a day outside the plan has no phase and no workout", () => {
		for (const monday of ["2026-11-09", "2027-02-01"]) {
			const week = weekPlan(STATE, monday);
			expect(week.every(({ phase, workouts }) => phase === null && workouts.length === 0)).toBe(true);
		}
		expect(weekPlan({ ...STATE, plan: null }, "2026-11-16").every(({ workouts }) => workouts.length === 0)).toBe(true);
	});

	test("a day's override replaces its phase slots", () => {
		const tuesday = weekPlan(STATE, "2026-12-28")[1]!;
		expect(tuesday).toMatchObject({ date: "2026-12-29", override: true, phase: { id: "phase-1" } });
		expect(tuesday.workouts.map(({ workout }) => workout.id)).toEqual(["test"]);
		expect(weekPlan(STATE, "2026-12-28")[5]?.override).toBe(false);
	});

	test("gives each workout the day's log of it", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi" }), log("l2", "2026-11-18", { workout: "mardi" }));
		const week = weekPlan(state, "2026-11-16");
		expect(week[1]?.workouts[0]?.log?.id).toBe("l1");
		expect(week[2]?.workouts.every(({ log }) => log === null)).toBe(true);
	});
});

describe("loadFor", () => {
	test("a new max and bodyweight give Tuesday 24 November +19 kg", () => {
		const state = withMeasurements(STATE, measurement("m3", "max", 117, "2026-11-17"), measurement("m4", BODYWEIGHT, 82.5, "2026-11-17"));
		expect(loadFor(state, SEMI, "2026-11-24")).toBe(19);
		expect(loadFor(state, SEMI, "2026-11-16")).toBe(15);
	});

	test("a logged load beats the rule the next week", () => {
		const state = withLogs(STATE, log("l1", "2026-11-21", { workout: "samedi", loads: { open: 13 } }));
		expect(loadFor(state, OPEN, "2026-11-28")).toBe(13);
		expect(dayItems(state, "2026-11-28").open?.load).toBe(13);
		expect(loadFor(state, OPEN, "2026-11-21")).toBe(10);
		expect(loadFor(state, SEMI, "2026-11-28")).toBe(15);
	});

	test("a newer measurement of the rule's metric brings the rule back", () => {
		const state = withMeasurements(withLogs(STATE, log("l1", "2026-11-21", { loads: { open: 13 } })), measurement("m3", "max", 117, "2026-11-25"));
		expect(loadFor(state, OPEN, "2026-11-24")).toBe(13);
		expect(loadFor(state, OPEN, "2026-11-28")).toBe(15);
		expect(loadFor(withMeasurements(state, measurement("m4", BODYWEIGHT, 83, "2026-11-26")), OPEN, "2026-11-24")).toBe(13);
	});

	test("a new phase brings the rule back, also for an exercise without one", () => {
		const state = withLogs(STATE, log("l1", "2026-12-05", { loads: { open: 13, abrahangs: 4 } }));
		expect(loadFor(state, OPEN, "2026-12-06")).toBe(13);
		expect(loadFor(state, ABRAHANGS, "2026-12-06")).toBe(4);
		expect(loadFor(state, OPEN, "2026-12-12")).toBe(10);
		expect(loadFor(state, ABRAHANGS, "2026-12-12")).toBeNull();
		expect(loadFor(state, OPEN, "2027-02-06")).toBe(10);
	});

	test("an unknown max or bodyweight gives an unknown load", () => {
		expect(loadFor({ ...STATE, measurements: [] }, SEMI, "2026-11-17")).toBeNull();
		expect(loadFor({ ...STATE, measurements: STATE.measurements.filter(({ metric }) => metric !== BODYWEIGHT) }, SEMI, "2026-11-17")).toBeNull();
		expect(loadFor(STATE, SEMI, "2026-08-25")).toBeNull();
		expect(dayItems({ ...STATE, measurements: [] }, "2026-11-17").semi?.load).toBeNull();
		expect(loadFor({ ...STATE, measurements: [] }, PULLS, "2026-11-17")).toBe(35);
	});
});

describe("painFlags", () => {
	test("a finger pain of 3 or more removes the hangs for the next 7 days", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { workout: "mardi", pain: { level: 4, where: "fingers" } }));
		expect(painFlags(state, "2026-11-21")).toEqual([{ logId: "l1", date: "2026-11-17", level: 4, where: "fingers", until: "2026-11-24" }]);
		expect(dayItems(state, "2026-11-17").semi?.removed).toBe(false);
		expect(dayItems(state, "2026-11-18").abrahangs?.removed).toBe(true);
		expect(dayItems(state, "2026-11-21").open?.removed).toBe(true);
		expect(dayItems(state, "2026-11-21").tractions?.removed).toBe(false);
		expect(dayItems(state, "2026-11-24").semi?.removed).toBe(true);
		expect(dayItems(state, "2026-11-25").abrahangs?.removed).toBe(false);
		expect(painFlags(state, "2026-11-25")).toEqual([]);
	});

	test("an elbow pain flags but keeps the hangs, and a pain under 3 does not flag", () => {
		const state = withLogs(STATE, log("l1", "2026-11-17", { pain: { level: 5, where: "elbow" } }), log("l2", "2026-11-18", { pain: { level: 2, where: "fingers" } }));
		expect(painFlags(state, "2026-11-21").map(({ where }) => where)).toEqual(["elbow"]);
		expect(dayItems(state, "2026-11-21").open?.removed).toBe(false);
	});
});

describe("grades", () => {
	test("orders the grades from 6a to 8a+ with the + grades between", () => {
		const from = FRENCH_GRADES.indexOf("6a");
		expect(FRENCH_GRADES.slice(from, FRENCH_GRADES.indexOf("8a+") + 1)).toEqual(["6a", "6a+", "6b", "6b+", "6c", "6c+", "7a", "7a+", "7b", "7b+", "7c", "7c+", "8a", "8a+"]);
		expect(gradeRank("7b+")).toBeGreaterThan(gradeRank("7b"));
		expect(gradeRank("7c")).toBeGreaterThan(gradeRank("7b+"));
	});

	test("bestGrades gives each week's hardest boulder and route", () => {
		const climb = (kind: "boulder" | "route", grade: (typeof FRENCH_GRADES)[number]) => ({ kind, grade, color: null, kilter: false, attempts: null });
		const state = withLogs(
			STATE,
			log("l1", "2026-11-17", { climbs: [climb("boulder", "7b"), climb("boulder", "7a+"), climb("route", "6c+")] }),
			log("l2", "2026-11-21", { climbs: [climb("boulder", "7b+")] }),
			log("l3", "2026-12-01", { climbs: [climb("route", "7c")] }),
		);
		expect(bestGrades(state, "2026-11-16", "2026-12-06")).toEqual([
			{ monday: "2026-11-16", boulder: "7b+", route: "6c+" },
			{ monday: "2026-11-23", boulder: null, route: null },
			{ monday: "2026-11-30", boulder: null, route: "7c" },
		]);
		expect(records(state).grades).toEqual({ boulder: { grade: "7b+", date: "2026-11-21" }, route: { grade: "7c", date: "2026-12-01" } });
	});
});

describe("records", () => {
	test("keeps the best of each metric by its direction and the heaviest load of each exercise, first reached", () => {
		const state = withLogs(
			withMeasurements(STATE, measurement("m3", "max", 117, "2026-11-17"), measurement("m4", BODYWEIGHT, 82.5, "2026-11-17"), measurement("m5", "max", 117, "2026-12-29")),
			log("l1", "2026-11-21", { loads: { open: 13, tractions: 35 } }),
			log("l2", "2026-11-28", { loads: { open: 13, tractions: 37.5 } }),
		);
		expect(records(state)).toEqual({
			metrics: [
				{ metric: "max", value: 117, at: "2026-11-17" },
				{ metric: BODYWEIGHT, value: 82, at: "2026-08-26" },
			],
			loads: [
				{ key: "open", kg: 13, date: "2026-11-21" },
				{ key: "tractions", kg: 37.5, date: "2026-11-28" },
			],
			grades: { boulder: null, route: null },
		});
	});
});

describe("adherence", () => {
	test("counts the planned workouts done, an optional one only once done", () => {
		const state = withLogs(
			STATE,
			log("l1", "2026-11-17", { workout: "mardi" }),
			log("l2", "2026-11-18", { workout: "hanche" }),
			log("l3", "2026-11-21", { workout: "samedi", status: "skipped" }),
			log("l4", "2026-11-22", { workout: "voie" }),
		);
		expect(adherence(state, "2026-11-16", "2026-11-22")).toEqual({ planned: 8, done: 3, ratio: 3 / 8 });
		expect(adherence(STATE, "2026-11-16", "2026-11-22")).toEqual({ planned: 7, done: 0, ratio: 0 });
		expect(adherence(STATE, "2027-02-01", "2027-02-07")).toEqual({ planned: 0, done: 0, ratio: null });
	});
});

describe("days", () => {
	const zone = process.env.TZ;
	afterEach(() => {
		process.env.TZ = zone;
	});

	test.each(["Pacific/Kiritimati", "America/Los_Angeles", "Pacific/Pago_Pago"])("a Monday stays a Monday in %s", tz => {
		process.env.TZ = tz;
		expect(weekPlan(STATE, "2026-11-16").map(({ date }) => date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
		expect(mondayOf("2026-11-01")).toBe("2026-10-26");
		expect(mondayOf("2027-03-28")).toBe("2027-03-22");
		expect(dayItems(STATE, "2026-11-17").semi?.load).toBe(15);
	});
});

test("the plan reads back from sport.json as written", () => {
	expect(parseSportState(JSON.parse(JSON.stringify(STATE)))).toEqual(STATE);
});
