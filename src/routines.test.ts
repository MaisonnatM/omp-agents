import { afterAll, describe, expect, test } from "bun:test";
import { applyRoutine, isDue, nextRunAt } from "./routines";
import type { Routine, Schedule } from "./shared";

// Weekly slots are local wall-clock times; Paris has both DST changes in the dates below.
const savedTz = process.env.TZ;
process.env.TZ = "Europe/Paris";
afterAll(() => {
	if (savedTz === undefined) delete process.env.TZ;
	else process.env.TZ = savedTz;
});

const at = (iso: string): number => Date.parse(iso);
const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };
const daily: Schedule = { kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: { hour: 9, minute: 0 } };

const evening: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 18, minute: 0 } };

const spec: Omit<Routine, "runs" | "createdAt"> = {
	id: "r1",
	name: "Notes",
	cwd: "/work/webapp",
	schedules: [weekdays],
	task: { kind: "prompt", prompt: "Summarize yesterday's commits." },
	skill: null,
	enabled: true,
};

const routine = (fields: Partial<Routine>): Routine => ({ ...spec, createdAt: at("2026-10-01T08:00:00+02:00"), runs: [], ...fields });

describe("nextRunAt", () => {
	test("a weekday schedule rolls from Friday over the weekend to Monday", () => {
		expect(nextRunAt(weekdays, at("2026-10-09T10:00:00+02:00"))).toBe(at("2026-10-12T09:00:00+02:00"));
	});

	test("the slot at the exact minute counts as passed, and a second before it is next", () => {
		expect(nextRunAt(weekdays, at("2026-10-12T09:00:00+02:00"))).toBe(at("2026-10-13T09:00:00+02:00"));
		expect(nextRunAt(weekdays, at("2026-10-12T08:59:59+02:00"))).toBe(at("2026-10-12T09:00:00+02:00"));
	});

	test("9:00 stays 9:00 local when DST ends, 25 hours later", () => {
		const next = nextRunAt(daily, at("2026-10-24T09:00:00+02:00"));
		expect(next).toBe(at("2026-10-25T09:00:00+01:00"));
		expect((next - at("2026-10-24T09:00:00+02:00")) / 3_600_000).toBe(25);
	});

	test("9:00 stays 9:00 local when DST starts, 23 hours later", () => {
		const next = nextRunAt(daily, at("2027-03-27T09:00:00+01:00"));
		expect(next).toBe(at("2027-03-28T09:00:00+02:00"));
		expect((next - at("2027-03-27T09:00:00+01:00")) / 3_600_000).toBe(23);
	});

	test("an interval counts its minutes from the last run", () => {
		expect(nextRunAt({ kind: "every", minutes: 90 }, at("2026-10-12T09:00:00+02:00"))).toBe(at("2026-10-12T10:30:00+02:00"));
	});
});

describe("isDue", () => {
	const fridayRun = { at: at("2026-10-09T09:00:00+02:00"), queued: false, started: [], errors: [], command: null };

	test("slots missed over a weekend coalesce into one run, which is not due again once claimed", () => {
		const monday = at("2026-10-12T11:00:00+02:00");
		expect(isDue(routine({ runs: [fridayRun] }), monday)).toBe(true);
		const claimed = routine({ runs: [{ ...fridayRun, at: monday }, fridayRun] });
		expect(isDue(claimed, at("2026-10-12T11:01:00+02:00"))).toBe(false);
	});

	test("a routine that never ran counts from its creation, and a paused one is never due", () => {
		expect(isDue(routine({}), at("2026-10-01T09:00:00+02:00"))).toBe(true);
		expect(isDue(routine({}), at("2026-10-01T08:59:00+02:00"))).toBe(false);
		expect(isDue(routine({ enabled: false, runs: [fridayRun] }), at("2026-10-12T11:00:00+02:00"))).toBe(false);
	});

	test("the earliest schedule is the one that is due", () => {
		const both = routine({ schedules: [weekdays, evening], runs: [fridayRun] });
		expect(isDue(both, at("2026-10-09T17:59:00+02:00"))).toBe(false);
		expect(isDue(both, at("2026-10-09T18:00:00+02:00"))).toBe(true);
		expect(isDue(routine({ schedules: [weekdays, evening], runs: [{ ...fridayRun, at: at("2026-10-09T18:00:00+02:00") }] }), at("2026-10-09T18:01:00+02:00"))).toBe(false);
	});

	test("two intervals share the last run, so the shorter one wins", () => {
		const anchor = at("2026-10-09T09:00:00+02:00");
		const both = routine({
			schedules: [
				{ kind: "every", minutes: 90 },
				{ kind: "every", minutes: 60 },
			],
			runs: [{ ...fridayRun, at: anchor }],
		});
		expect(isDue(both, anchor + 60 * 60_000 - 1)).toBe(false);
		expect(isDue(both, anchor + 60 * 60_000)).toBe(true);
	});
});

describe("applyRoutine", () => {
	const now = at("2026-10-05T12:00:00+02:00");

	test("a new routine starts with no runs, created now", () => {
		expect(applyRoutine([], { op: "save", routine: spec }, now)).toEqual([{ ...spec, createdAt: now, runs: [] }]);
	});

	test("an edit keeps the routine's creation and runs", () => {
		const run = { at: at("2026-10-05T09:00:00+02:00"), queued: true, started: [], errors: [], command: null };
		const saved = routine({ runs: [run] });
		expect(applyRoutine([saved], { op: "save", routine: { ...spec, name: "Morning notes", schedules: [daily] } }, now)).toEqual([
			{ ...saved, name: "Morning notes", schedules: [daily] },
		]);
	});

	test("remove and enable change only what they name, and return the same list when nothing changes", () => {
		const list = [routine({}), routine({ id: "r2" })];
		expect(applyRoutine(list, { op: "remove", id: "r1" }, now).map(({ id }) => id)).toEqual(["r2"]);
		expect(applyRoutine(list, { op: "enable", id: "r2", enabled: false }, now).map(({ enabled }) => enabled)).toEqual([true, false]);
		expect(applyRoutine(list, { op: "remove", id: "gone" }, now)).toBe(list);
		expect(applyRoutine(list, { op: "enable", id: "r1", enabled: true }, now)).toBe(list);
	});
});
