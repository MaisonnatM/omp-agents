import { describe, expect, test } from "bun:test";
import { earlyRuns, type RunTurn, type TurnOf } from "./routine-health";
import type { Routine, RoutineRun } from "./routines";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 10 * 24 * HOUR;
const WORKSPACE = "/work/webapp";

/** An hourly command routine with nothing overdue, as of {@link NOW}. */
const routine = (fields: Partial<Routine> = {}): Routine => ({
	id: "r1",
	workspace: WORKSPACE,
	name: "Digest",
	schedules: [{ kind: "every", minutes: 60 }],
	triggers: [],
	task: { kind: "command", command: "make digest" },
	enabled: true,
	machine: null,
	createdAt: 0,
	scheduledAt: NOW - 10 * MINUTE,
	runs: [],
	...fields,
});

/** A command run claimed `hoursAgo` hours before {@link NOW} that took `ms` and exited with `code`. */
const command = (hoursAgo: number, ms = 10 * MINUTE, code = 0): RoutineRun => {
	const at = NOW - hoursAgo * HOUR;
	return { at, outcome: { kind: "command", run: { phase: "exited", code, output: "", startedAt: at, endedAt: at + ms } }, errors: [], triggeredBy: [] };
};

/** A prompt run claimed `hoursAgo` hours before {@link NOW}, posted as Board task #1. */
const posted = (hoursAgo: number): RoutineRun => ({ at: NOW - hoursAgo * HOUR, outcome: { kind: "posted", task: 1 }, errors: [], triggeredBy: [] });

/** Hourly runs 2 to 6 hours ago, each taking ten minutes. */
const usual = (): RoutineRun[] => [2, 3, 4, 5, 6].map(hoursAgo => command(hoursAgo));

const noTurn: TurnOf = () => null;
const turn = (fields: Partial<RunTurn> = {}): TurnOf => () => ({ replied: true, quiet: false, failed: false, ms: 5 * MINUTE, usage: { tokens: 0, cost: 0 }, ...fields });

describe("earlyRuns", () => {
	test("routines whose runs exited 0, on time, and as long as usual find nothing", () => {
		expect(earlyRuns([routine({ runs: usual() }), routine({ id: "r2", enabled: false, scheduledAt: 0 })], NOW, noTurn)).toEqual([]);
	});

	test("a command that exited non-zero, a run with errors, and a run that failed to start each errored", () => {
		const runs = usual();
		runs[0] = command(2, 10 * MINUTE, 1);
		runs[1] = { ...command(3), errors: ["The run could not be posted to the Board: The Board is full."] };
		runs[2] = { ...command(4), outcome: { kind: "failed" } };
		expect(earlyRuns([routine({ runs })], NOW, noTurn).map(({ at, exit }) => ({ hoursAgo: (NOW - at) / HOUR, exit }))).toEqual([
			{ hoursAgo: 4, exit: "errored" },
			{ hoursAgo: 3, exit: "errored" },
			{ hoursAgo: 2, exit: "errored" },
		]);
	});

	test("a run far shorter than the routine's usual one ended early, once enough other runs show what usual is", () => {
		const short = command(2, MINUTE);
		expect(earlyRuns([routine({ runs: [short, ...usual().slice(1)] })], NOW, noTurn)).toEqual([{ workspace: WORKSPACE, routineId: "r1", name: "Digest", at: short.at, exit: "short" }]);
		expect(earlyRuns([routine({ runs: [short, command(3), command(4)] })], NOW, noTurn)).toEqual([]);
	});

	test("a prompt run whose session's turn ended with no reply is listed, one marked done quietly is not, and one a provider's error ended errored", () => {
		const prompt = routine({ task: { kind: "prompt", prompt: "Summarize the inbox." }, runs: [posted(2)] });
		expect(earlyRuns([prompt], NOW, turn({ replied: false }))).toEqual([{ workspace: WORKSPACE, routineId: "r1", name: "Digest", at: NOW - 2 * HOUR, exit: "no-reply" }]);
		expect(earlyRuns([prompt], NOW, turn({ replied: false, quiet: true }))).toEqual([]);
		expect(earlyRuns([prompt], NOW, turn({ replied: false, failed: true })).map(({ exit }) => exit)).toEqual(["errored"]);
		expect(earlyRuns([prompt], NOW, turn())).toEqual([]);
	});

	test("a run claimed an hour or more after its slot, a run still queued an hour on, and an overdue slot with no run each missed their schedule", () => {
		const late = command(2);
		const queued: RoutineRun = { at: NOW - 3 * HOUR, outcome: { kind: "queued" }, errors: [], triggeredBy: [] };
		expect(earlyRuns([routine({ runs: [late, command(5)] })], NOW, noTurn).map(({ at, exit }) => ({ at, exit }))).toEqual([{ at: late.at, exit: "missed" }]);
		expect(earlyRuns([routine({ runs: [queued] })], NOW, noTurn).map(({ exit }) => exit)).toEqual(["missed"]);
		const overdue = routine({ scheduledAt: NOW - 3 * HOUR });
		expect(earlyRuns([overdue], NOW, noTurn)).toEqual([{ workspace: WORKSPACE, routineId: "r1", name: "Digest", at: NOW - 2 * HOUR, exit: "missed" }]);
		expect(earlyRuns([{ ...overdue, enabled: false }, { ...overdue, machine: { id: "m2", name: "Laptop" } }], NOW, noTurn)).toEqual([]);
	});

	test("a triggered run claimed long after the last scheduled one did not miss its schedule", () => {
		const triggered: RoutineRun = { ...command(2), triggeredBy: [{ kind: "pull-request", title: "acme/webapp#1", detail: "Checks failed", url: null }] };
		expect(earlyRuns([routine({ runs: [triggered, command(9)] })], NOW, noTurn)).toEqual([]);
	});

	test("only runs claimed within the day before the last half hour are judged, oldest first across routines", () => {
		const fresh = command(0.25, MINUTE, 1);
		const old = command(25, MINUTE, 1);
		const other = routine({ id: "r2", name: "Prune", runs: [command(5, MINUTE, 1)] });
		expect(earlyRuns([routine({ runs: [fresh, command(2, MINUTE, 1), old] }), other], NOW, noTurn).map(({ routineId, at }) => ({ routineId, hoursAgo: (NOW - at) / HOUR }))).toEqual([
			{ routineId: "r2", hoursAgo: 5 },
			{ routineId: "r1", hoursAgo: 2 },
		]);
	});

	test("a command whose routine posts only its failures hands off by exiting non-zero, which is no error unless the run errored otherwise", () => {
		const handOff = { ...command(2, 10 * MINUTE, 1), errors: ["Exited with code 1."] };
		const failures = routine({ task: { kind: "command", command: "check", post: "failures" }, runs: [handOff, ...usual().slice(1)] });
		expect(earlyRuns([failures], NOW, noTurn)).toEqual([]);
		expect(earlyRuns([{ ...failures, task: { kind: "command", command: "check" } }], NOW, noTurn).map(({ exit }) => exit)).toEqual(["errored"]);
		const alsoFailed = { ...failures, runs: [{ ...handOff, errors: [...handOff.errors, "The run could not be posted to the Board: The Board is full."] }, ...usual().slice(1)] };
		expect(earlyRuns([alsoFailed], NOW, noTurn).map(({ exit }) => exit)).toEqual(["errored"]);
	});

	test("a run late only by the time the Mac slept did not miss its schedule, and an overdue slot the Mac slept through is not listed", () => {
		const late = command(2);
		const sleptAll = () => 2 * HOUR;
		expect(earlyRuns([routine({ runs: [late, command(5)] })], NOW, noTurn, sleptAll)).toEqual([]);
		expect(earlyRuns([routine({ runs: [late, command(5)] })], NOW, noTurn, () => HOUR)).toEqual([{ workspace: WORKSPACE, routineId: "r1", name: "Digest", at: late.at, exit: "missed" }]);
		expect(earlyRuns([routine({ scheduledAt: NOW - 3 * HOUR })], NOW, noTurn, sleptAll)).toEqual([]);
	});
});
