import { describe, expect, test } from "bun:test";
import { exercise } from "../src/sport-fixtures";
import { advance, CHANGE_SEC, freshCue, PREPARE_SEC, startHold, startRun, timerNote, timerSteps } from "./sport-timer";

const shape = (items: Parameters<typeof timerSteps>[0]) => timerSteps(items).map(({ kind, sec, hold }) => [kind, sec, hold.item.key, hold.set, hold.side, kind === "hold" && hold.last]);

describe("timerSteps", () => {
	test("a per-side item holds each set left then right, changing side in between, and ends on its last hold", () => {
		const items = [exercise("s1", "Ischios", { sets: 2, holdSec: 45, perSide: true }), exercise("s5", "Pectoraux", { sets: 1, holdSec: 45 })];
		expect(shape(items)).toEqual([
			["prepare", PREPARE_SEC, "s1", 1, "gauche", false],
			["hold", 45, "s1", 1, "gauche", false],
			["side", CHANGE_SEC, "s1", 1, "droit", false],
			["hold", 45, "s1", 1, "droit", false],
			["next", CHANGE_SEC, "s1", 2, "gauche", false],
			["hold", 45, "s1", 2, "gauche", false],
			["side", CHANGE_SEC, "s1", 2, "droit", false],
			["hold", 45, "s1", 2, "droit", true],
			["next", CHANGE_SEC, "s5", 1, null, false],
			["hold", 45, "s5", 1, null, true],
		]);
	});

	test("an item's rest replaces the transition after each of its sets, but not the change of side", () => {
		const items = [exercise("p", "Planche", { sets: 2, holdSec: 30, restSec: 60, perSide: true }), exercise("q", "Pont", { holdSec: 20 })];
		expect(shape(items).map(([kind, sec]) => [kind, sec])).toEqual([
			["prepare", PREPARE_SEC],
			["hold", 30],
			["side", CHANGE_SEC],
			["hold", 30],
			["rest", 60],
			["hold", 30],
			["side", CHANGE_SEC],
			["hold", 30],
			["rest", 60],
			["hold", 20],
		]);
	});

	test("the stretching routine's holds come to 600 s", () => {
		const items = [
			exercise("s1", "Ischios", { sets: 2, holdSec: 45, perSide: true }),
			exercise("s2", "Adducteurs", { sets: 2, holdSec: 45, perSide: true }),
			exercise("s3", "Fléchisseurs", { sets: 1, holdSec: 45, perSide: true }),
			exercise("s4", "Chevilles", { sets: 1, holdSec: 30, perSide: true }),
			exercise("s5", "Pectoraux", { sets: 2, holdSec: 45 }),
		];
		const holds = timerSteps(items).filter(({ kind }) => kind === "hold");
		expect(holds).toHaveLength(14);
		expect(holds.reduce((sum, { sec }) => sum + (sec ?? 0), 0)).toBe(600);
	});

	test("a set of reps waits for the user, and the clock runs every timed step before it out, however late it looks", () => {
		const steps = timerSteps([exercise("a", "Gainage", { holdSec: 30 }), exercise("b", "Pompes", { sets: 1, reps: 10 })]);
		expect(steps.map(({ kind, sec }) => [kind, sec])).toEqual([["prepare", PREPARE_SEC], ["hold", 30], ["next", CHANGE_SEC], ["hold", null]]);
		const { run, ended } = advance(steps, startRun(steps, 0), 600_000);
		expect(ended.map(({ kind }) => kind)).toEqual(["prepare", "hold", "next"]);
		expect(run).toEqual({ at: 3, ran: 0, since: (PREPARE_SEC + 30 + CHANGE_SEC) * 1000 });
	});

	test("a run starts on the first hold of the first unticked item, after getting ready in place of the step before it", () => {
		const items = [exercise("a", "Ischios", { holdSec: 45, perSide: true }), exercise("b", "Adducteurs", { holdSec: 45, perSide: true }), exercise("c", "Pectoraux", { holdSec: 45 })];
		expect(startHold(items, [])).toBe(0);
		expect(startHold(items, ["a"])).toBe(2);
		expect(startHold(items, ["a", "c"])).toBe(2);
		expect(startHold(items, ["b"])).toBe(0);
		expect(startHold(items, ["a", "b"])).toBe(4);
		expect(startHold(items, ["a", "b", "c"])).toBe(0);
		const steps = timerSteps(items, 2);
		expect(steps.map(({ kind, hold }) => [kind, hold.index])).toEqual([
			["hold", 0],
			["side", 1],
			["hold", 1],
			["prepare", 2],
			["hold", 2],
			["side", 3],
			["hold", 3],
			["next", 4],
			["hold", 4],
		]);
		expect(startRun(steps, 7)).toEqual({ at: 3, ran: 0, since: 7 });
		expect(startRun(timerSteps(items), 7).at).toBe(0);
	});
});

describe("the hold's text", () => {
	test("a per-side note drops its « Par côté », and a cue the note already says is left out", () => {
		expect(timerNote("Par côté, genou au sol.", true)).toBe("Genou au sol.");
		expect(timerNote("Par côté, genou au sol.", false)).toBe("Par côté, genou au sol.");
		expect(timerNote("", true)).toBeNull();
		expect(freshCue("Genou au sol", "Genou au sol, dos droit.")).toBeNull();
		expect(freshCue("Pousse le bassin", "Genou au sol.")).toBe("Pousse le bassin");
	});
});
