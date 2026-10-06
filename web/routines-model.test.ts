import { describe, expect, test } from "bun:test";
import type { Routine, RoutineRun, Schedule, Weekday } from "../src/shared";
import { draftOf, lastRunWords, newDraft, nextRunWords, runWords, type RoutineDraft, schedulesWords, scheduleWords, specOf, taskWords, whenWords } from "./routines-model";

// Local times, so the expected words hold in any time zone. Oct 5 2026 is a Monday.
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();

const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };

const routine = (fields: Partial<Routine>): Routine => ({
	id: "r1",
	name: "Morning notes",
	cwd: "~/code/webapp",
	schedules: [weekdays],
	task: { kind: "prompt", prompt: "Summarize yesterday's commits." },
	skill: null,
	enabled: true,
	createdAt: at(5, 10),
	runs: [],
	...fields,
});

const run = (fields: Partial<RoutineRun>): RoutineRun => ({ at: at(5, 9), queued: false, started: [], errors: [], command: null, ...fields });

describe("schedule words", () => {
	test("an interval reads in its largest whole unit", () => {
		expect(scheduleWords({ kind: "every", minutes: 360 })).toBe("Every 6 hours");
		expect(scheduleWords({ kind: "every", minutes: 90 })).toBe("Every 90 minutes");
		expect(scheduleWords({ kind: "every", minutes: 2880 })).toBe("Every 2 days");
		expect(scheduleWords({ kind: "every", minutes: 1440 })).toBe("Every day");
		expect(scheduleWords({ kind: "every", minutes: 60 })).toBe("Every hour");
		expect(scheduleWords({ kind: "every", minutes: 1 })).toBe("Every minute");
	});

	test("weekly days read as a preset when they match one, else Monday first, whatever order they were saved in", () => {
		const weekly = (days: Weekday[], hour: number, minute: number) => scheduleWords({ kind: "weekly", days, time: { hour, minute } });
		expect(weekly([5, 1, 2, 3, 4], 9, 0)).toBe("Weekdays at 9:00");
		expect(weekly([0, 1, 2, 3, 4, 5, 6], 9, 0)).toBe("Every day at 9:00");
		expect(weekly([0, 6], 10, 5)).toBe("Weekends at 10:05");
		expect(weekly([3, 1], 18, 30)).toBe("Mon, Wed at 18:30");
		expect(weekly([0, 1], 7, 0)).toBe("Mon, Sun at 7:00");
	});
});

describe("task words", () => {
	test("a prompt task names its first line with text", () => {
		expect(taskWords({ kind: "prompt", prompt: "\n  Summarize yesterday's commits.  \nThen list open questions." })).toBe("Summarize yesterday's commits.");
	});

	test("several schedules read in the order they were saved", () => {
		expect(schedulesWords([weekdays, { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 18, minute: 0 } }])).toBe("Weekdays at 9:00, Weekdays at 18:00");
	});
});

describe("next run", () => {
	test("a weekly routine runs at its next slot after its last run, named by day", () => {
		const now = at(5, 10);
		expect(nextRunWords(routine({ runs: [run({ at: at(5, 9) })] }), now)).toBe("Tomorrow at 9:00");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [1, 5], time: { hour: 18, minute: 30 } }] }), now)).toBe("Today at 18:30");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [5], time: { hour: 9, minute: 0 } }] }), now)).toBe("Fri at 9:00");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }] }), now)).toBe("Oct 12 at 9:00");
	});

	test("an interval counts from the last run, else from when the routine was made", () => {
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 1440 }] }), at(5, 11))).toBe("Tomorrow at 10:00");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 360 }], runs: [run({ at: at(5, 11, 15) })] }), at(5, 12))).toBe("Today at 17:15");
	});

	test("two schedules name the sooner one", () => {
		const both = routine({
			schedules: [weekdays, { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 18, minute: 0 } }],
			runs: [run({ at: at(5, 9) })],
		});
		expect(nextRunWords(both, at(5, 10))).toBe("Today at 18:00");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 90 }, { kind: "every", minutes: 60 }] }), at(5, 10))).toBe("Today at 11:00");
	});

	test("a paused routine says so, and one whose slot passed is due now", () => {
		expect(nextRunWords(routine({ enabled: false }), at(5, 10))).toBe("Paused");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 60 }] }), at(5, 11))).toBe("Due now");
	});

	test("a date past the week names its month", () => {
		expect(whenWords(at(25, 9), at(5, 10))).toBe("Oct 25 at 9:00");
	});
});

describe("last run", () => {
	const started = { label: "acme/webapp#7", instanceId: "7c51", sessionId: "01a0" };

	test("names the sessions it started and its errors, or that it waits its turn", () => {
		expect(runWords(run({ started: [started], errors: ["GitHub timed out", "No such directory"] }))).toBe("1 session started, 2 errors");
		expect(runWords(run({ started: [started, started] }))).toBe("2 sessions started");
		expect(runWords(run({ errors: ["GitHub timed out"] }))).toBe("1 error");
		expect(runWords(run({ queued: true }))).toBe("Queued");
	});

	test("a run that started nothing says so, and a routine never run says so", () => {
		expect(runWords(run({}))).toBe("Nothing started");
		expect(lastRunWords(routine({}))).toBe("Not run yet");
		expect(lastRunWords(routine({ runs: [run({ started: [started] }), run({ errors: ["old"] })] }))).toBe("1 session started");
	});
});

describe("command runs", () => {
	const window = { startedAt: at(5, 9), endedAt: at(5, 9) + 3000 };

	test("a command task reads as its first line after a prompt sign", () => {
		expect(taskWords({ kind: "command", command: "\n  git fetch --prune  \ngit worktree prune" })).toBe("$ git fetch --prune");
	});

	test("a run reads as how its command stands", () => {
		expect(runWords(run({}))).toBe("Nothing started");
		expect(runWords(run({ command: { phase: "running", startedAt: at(5, 9) } }))).toBe("Running…");
		expect(runWords(run({ command: { phase: "exited", code: 0, output: "", ...window } }))).toBe("Succeeded");
		expect(runWords(run({ command: { phase: "exited", code: 3, output: "", ...window }, errors: ["Exited with code 3."] }))).toBe("Failed (exit 3)");
		expect(runWords(run({ command: { phase: "stopped", reason: "time-limit", output: "", ...window } }))).toBe("Stopped at the time limit");
		expect(runWords(run({ command: { phase: "stopped", reason: "dashboard", output: "", ...window } }))).toBe("Stopped with the dashboard");
		expect(runWords(run({ command: { phase: "failed", error: "/gone is not a directory.", ...window } }))).toBe("Could not start");
	});

	test("a run that ran nothing because the last command still ran counts its error", () => {
		expect(runWords(run({ errors: ["The last run's command is still running."] }))).toBe("1 error");
	});
});

describe("editor form", () => {
	test("a saved routine's form saves the same routine back", () => {
		const saved = routine({ schedules: [{ kind: "every", minutes: 360 }], task: { kind: "prompt", prompt: "Reply ok." }, skill: "poteto-mode", enabled: false });
		expect(draftOf(saved).schedules[0]).toMatchObject({ amount: "6", unit: "hours" });
		expect(draftOf(saved)).toMatchObject({ task: "prompt", prompt: "Reply ok." });
		expect(specOf(draftOf(saved))).toEqual({
			ok: {
				id: "r1",
				name: "Morning notes",
				cwd: "~/code/webapp",
				enabled: false,
				skill: "poteto-mode",
				task: { kind: "prompt", prompt: "Reply ok." },
				schedules: [{ kind: "every", minutes: 360 }],
			},
		});
	});

	test("a form saves weekly days Monday first and its time as typed, and says what to fix first", () => {
		const base = newDraft("r2", "/tmp", null);
		const draft: RoutineDraft = { ...base, name: " Standup ", prompt: "Hi", schedules: [{ ...base.schedules[0]!, days: [3, 1], time: "18:30" }] };
		expect(specOf(draft)).toEqual({
			ok: {
				id: "r2",
				name: "Standup",
				cwd: "/tmp",
				enabled: true,
				skill: null,
				task: { kind: "prompt", prompt: "Hi" },
				schedules: [{ kind: "weekly", days: [1, 3], time: { hour: 18, minute: 30 } }],
			},
		});
		expect(specOf({ ...draft, name: "" })).toEqual({ fix: "Name the routine." });
		expect(specOf({ ...draft, schedules: [{ ...draft.schedules[0]!, days: [] }] })).toEqual({ fix: "Pick at least one day." });
		expect(specOf({ ...draft, prompt: "  " })).toEqual({ fix: "Write the prompt the session starts with." });
		expect(specOf({ ...draft, schedules: [{ ...draft.schedules[0]!, kind: "every", amount: "0" }] })).toEqual({ fix: "Use a whole number of at least 1." });
		const evening = { ...draft.schedules[0]!, time: "18:00", days: [] as Weekday[] };
		expect(specOf({ ...draft, schedules: [...draft.schedules, evening] })).toEqual({ fix: "Schedule 2: Pick at least one day." });
	});

	test("a command form saves its command, trimmed, without a skill, and keeps the skill for another task", () => {
		const draft = { ...newDraft("r3", "~/code", "poteto-mode"), name: "Prune", task: "command" as const, command: "  git worktree prune\n" };
		expect(specOf(draft)).toEqual({
			ok: {
				id: "r3",
				name: "Prune",
				cwd: "~/code",
				enabled: true,
				skill: null,
				task: { kind: "command", command: "git worktree prune" },
				schedules: [{ kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } }],
			},
		});
		expect(specOf({ ...draft, command: " " })).toEqual({ fix: "Write the command to run." });
		expect(specOf({ ...draft, task: "prompt", prompt: "Hi" })).toMatchObject({ ok: { skill: "poteto-mode" } });
		const saved = routine({ task: { kind: "command", command: "git worktree prune" } });
		expect(specOf(draftOf(saved))).toMatchObject({ ok: { task: { kind: "command", command: "git worktree prune" } } });
	});
});
