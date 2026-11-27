import { describe, expect, test } from "bun:test";
import { erroredRuns, type RunTurn, type TurnOf } from "./routine-health";
import type { Routine, RoutineRun } from "./routines";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 10 * 24 * HOUR;
const WORKSPACE = "/work/webapp";

/** An hourly command routine, as of {@link NOW}. */
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

describe("erroredRuns", () => {
	test("a command that exited non-zero, a run with errors, and a run that failed to start each errored", () => {
		const runs = usual();
		runs[0] = command(2, 10 * MINUTE, 1);
		runs[1] = { ...command(3), errors: ["The run could not be posted to the Board: The Board is full."] };
		runs[2] = { ...command(4), outcome: { kind: "failed" } };
		expect(erroredRuns([routine({ runs })], NOW, noTurn).map(({ at }) => (NOW - at) / HOUR)).toEqual([4, 3, 2]);
	});

	test("a run far shorter than usual, a run claimed hours late, an overdue slot, and a still-queued run are not listed", () => {
		const queued: RoutineRun = { at: NOW - 3 * HOUR, outcome: { kind: "queued" }, errors: [], triggeredBy: [] };
		expect(erroredRuns([routine({ runs: [command(2, MINUTE), ...usual().slice(1)] })], NOW, noTurn)).toEqual([]);
		expect(erroredRuns([routine({ scheduledAt: NOW - 9 * HOUR, runs: [command(2), command(9)] })], NOW, noTurn)).toEqual([]);
		expect(erroredRuns([routine({ runs: [queued] })], NOW, noTurn)).toEqual([]);
	});

	test("a prompt run is listed only when a provider's error ended its session's turn, not when the session ended with no reply", () => {
		const prompt = routine({ task: { kind: "prompt", prompt: "Summarize the inbox." }, runs: [posted(2)] });
		expect(erroredRuns([prompt], NOW, turn({ replied: false, failed: true }))).toEqual([{ workspace: WORKSPACE, routineId: "r1", name: "Digest", at: NOW - 2 * HOUR }]);
		expect(erroredRuns([prompt], NOW, turn({ replied: false }))).toEqual([]);
		expect(erroredRuns([prompt], NOW, turn())).toEqual([]);
		expect(erroredRuns([prompt], NOW, noTurn)).toEqual([]);
	});

	test("only runs claimed within the day before the last half hour are judged, oldest first across routines", () => {
		const fresh = command(0.25, MINUTE, 1);
		const old = command(25, MINUTE, 1);
		const other = routine({ id: "r2", name: "Prune", runs: [command(5, MINUTE, 1)] });
		expect(erroredRuns([routine({ runs: [fresh, command(2, MINUTE, 1), old] }), other], NOW, noTurn).map(({ routineId, at }) => ({ routineId, hoursAgo: (NOW - at) / HOUR }))).toEqual([
			{ routineId: "r2", hoursAgo: 5 },
			{ routineId: "r1", hoursAgo: 2 },
		]);
	});

	test("a command whose routine posts only its failures hands off by exiting non-zero, which is no error unless the run errored otherwise", () => {
		const handOff = { ...command(2, 10 * MINUTE, 1), errors: ["Exited with code 1."] };
		const failures = routine({ task: { kind: "command", command: "check", post: "failures" }, runs: [handOff, ...usual().slice(1)] });
		expect(erroredRuns([failures], NOW, noTurn)).toEqual([]);
		expect(erroredRuns([{ ...failures, task: { kind: "command", command: "check" } }], NOW, noTurn)).toHaveLength(1);
		const alsoFailed = { ...failures, runs: [{ ...handOff, errors: [...handOff.errors, "The run could not be posted to the Board: The Board is full."] }, ...usual().slice(1)] };
		expect(erroredRuns([alsoFailed], NOW, noTurn)).toHaveLength(1);
	});
});
