import { describe, expect, test } from "bun:test";
import type { CommandRun, Routine, RoutineRun, Schedule, Weekday } from "../src/routines";
import type { BotId } from "../src/shared/bots";
import {
	CADENCES,
	type Cadence,
	cadenceOf,
	countdownWords,
	draftOf,
	durationWords,
	newDraft,
	nextRunWords,
	pastRunWords,
	runCountWords,
	runDuration,
	runHealth,
	runSlots,
	runWords,
	type RoutineDraft,
	scheduleOfCadence,
	scheduleWords,
	schedulesWords,
	specOf,
	specWithSchedule,
	startsWords,
	taskWords,
	whenWords,
	withCadence,
} from "./routines-model";

// Local times, so the expected words hold in any time zone. Oct 5 2026 is a Monday.
const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();

const weekdays: Schedule = { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } };

const scout = "scout" as BotId;

/** A routine whose runs a schedule started, unless `fields` says otherwise. */
const routine = (fields: Partial<Routine>): Routine => ({
	id: "r1",
	botId: scout,
	name: "Morning notes",
	schedules: [weekdays],
	triggers: [],
	task: { kind: "prompt", prompt: "Summarize yesterday's commits." },
	enabled: true,
	createdAt: at(5, 10),
	runs: [],
	scheduledAt: fields.runs?.[0]?.at ?? null,
	...fields,
});

const run = (fields: Partial<RoutineRun>): RoutineRun => ({ at: at(5, 9), outcome: { kind: "pending", queued: false }, errors: [], triggeredBy: [], ...fields });

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

	test("several schedules read in the order they were saved, then the triggers", () => {
		expect(startsWords({ schedules: [weekdays, { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 18, minute: 0 } }], triggers: [] })).toBe("Weekdays at 9:00, Weekdays at 18:00");
		expect(startsWords({ schedules: [weekdays], triggers: [{ kind: "pull-request" }] })).toBe("Weekdays at 9:00, When a pull request waits on you");
	});
});

describe("next run", () => {
	test("a weekly routine counts down to its next slot after its last run", () => {
		const now = at(5, 10);
		expect(nextRunWords(routine({ runs: [run({ at: at(5, 9) })] }), now)).toBe("Next run in 23 h");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [1, 5], time: { hour: 18, minute: 30 } }] }), now)).toBe("Next run in 8 h 30 min");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [5], time: { hour: 9, minute: 0 } }] }), now)).toBe("Next run in 3 d 23 h");
		expect(nextRunWords(routine({ schedules: [{ kind: "weekly", days: [1], time: { hour: 9, minute: 0 } }] }), now)).toBe("Next run in 6 d 23 h");
	});

	test("a triggered run does not move the next slot, and a routine with only triggers runs on one", () => {
		const triggered = run({ at: at(5, 11), triggeredBy: [{ kind: "slack", title: "Bo wrote to you", detail: "Lunch?", url: null }] });
		expect(nextRunWords(routine({ runs: [triggered], scheduledAt: at(5, 9) }), at(5, 12))).toBe("Next run in 21 h");
		expect(nextRunWords(routine({ schedules: [], triggers: [{ kind: "slack" }] }), at(5, 12))).toBe("On a trigger");
	});

	test("an interval counts from the last run, else from when the routine was made", () => {
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 1440 }] }), at(5, 11))).toBe("Next run in 23 h");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 360 }], runs: [run({ at: at(5, 11, 15) })] }), at(5, 12))).toBe("Next run in 5 h 15 min");
	});

	test("two schedules count down to the sooner one", () => {
		const both = routine({
			schedules: [weekdays, { kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 18, minute: 0 } }],
			runs: [run({ at: at(5, 9) })],
		});
		expect(nextRunWords(both, at(5, 10))).toBe("Next run in 8 h");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 90 }, { kind: "every", minutes: 60 }] }), at(5, 10))).toBe("Next run in 1 h");
	});

	test("a paused routine says so, and one whose slot passed is due now", () => {
		expect(nextRunWords(routine({ enabled: false }), at(5, 10))).toBe("Paused");
		expect(nextRunWords(routine({ schedules: [{ kind: "every", minutes: 60 }] }), at(5, 11))).toBe("Due now");
	});

	test("a date past the week names its month", () => {
		expect(whenWords(at(25, 9), at(5, 10))).toBe("Oct 25 at 9:00");
	});

	test("a row's schedules read in the order they were saved, or say a trigger starts it", () => {
		expect(schedulesWords({ schedules: [weekdays, { kind: "every", minutes: 60 }] })).toBe("Weekdays at 9:00, Every hour");
		expect(schedulesWords({ schedules: [] })).toBe("On a trigger");
	});
});

describe("countdown", () => {
	const now = at(5, 10);
	const later = (seconds: number) => countdownWords(now + seconds * 1000, now);

	test("reads in its largest unit and the next one's remainder", () => {
		expect(later(3 * 86_400 + 9 * 3600 + 20 * 60)).toBe("in 3 d 9 h");
		expect(later(2 * 3600 + 14 * 60 + 50)).toBe("in 2 h 14 min");
		expect(later(14 * 60 + 30)).toBe("in 14 min 30 s");
		expect(later(30)).toBe("in 30 s");
	});

	test("drops a remainder of 0, and never reads less than a second", () => {
		expect(later(3600)).toBe("in 1 h");
		expect(later(2 * 86_400 + 30 * 60)).toBe("in 2 d");
		expect(later(59)).toBe("in 59 s");
		expect(later(0.2)).toBe("in 1 s");
		expect(later(-5)).toBe("in 1 s");
	});

	test("counts a part second up, so the last half second of an hour still reads an hour", () => {
		expect(later(3599.5)).toBe("in 1 h");
		expect(later(3599)).toBe("in 59 min 59 s");
	});

	test("a run's duration reads the same way, under a second as such", () => {
		expect(durationWords(300)).toBe("under 1 s");
		expect(durationWords(3000)).toBe("3 s");
		expect(durationWords(65_000)).toBe("1 min 5 s");
	});
});

describe("past run", () => {
	test("names today and yesterday, else the day and the date, in local time", () => {
		const now = at(16, 18);
		expect(pastRunWords(at(16, 6), now)).toBe("today 6:00");
		expect(pastRunWords(at(15, 9), now)).toBe("yesterday 9:00");
		expect(pastRunWords(at(15, 0), now)).toBe("yesterday 0:00");
		expect(pastRunWords(at(14, 23, 59), now)).toBe("Wed 14 Oct, 23:59");
		expect(pastRunWords(at(16, 16), at(18, 10))).toBe("Fri 16 Oct, 16:00");
	});
});

describe("last run", () => {
	const sent = { kind: "sent", sessionId: "01a0" } as const;

	test("says it went to the Bot, and names its errors, or that it waits its turn", () => {
		expect(runWords(run({ outcome: sent, errors: ["GitHub timed out", "No such directory"] }))).toBe("Sent to the Bot, 2 errors");
		expect(runWords(run({ errors: ["GitHub timed out"] }))).toBe("1 error");
		expect(runWords(run({ outcome: { kind: "pending", queued: true } }))).toBe("Queued");
	});

	test("a run that sent nothing says so", () => {
		expect(runWords(run({}))).toBe("Nothing sent");
	});
});

describe("command runs", () => {
	const window = { startedAt: at(5, 9), endedAt: at(5, 9) + 3000 };

	test("a command task reads as its first line after a prompt sign", () => {
		expect(taskWords({ kind: "command", command: "\n  git fetch --prune  \ngit worktree prune" })).toBe("$ git fetch --prune");
	});

	test("a run reads as how its command stands", () => {
		expect(runWords(run({}))).toBe("Nothing sent");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "running", startedAt: at(5, 9) } } }))).toBe("Running…");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "exited", code: 0, output: "", ...window } } }))).toBe("Succeeded");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "exited", code: 3, output: "", ...window } }, errors: ["Exited with code 3."] }))).toBe("Failed (exit 3)");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "stopped", reason: "time-limit", output: "", ...window } } }))).toBe("Stopped at the time limit");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "stopped", reason: "dashboard", output: "", ...window } } }))).toBe("Stopped with the dashboard");
		expect(runWords(run({ outcome: { kind: "command", run: { phase: "failed", error: "/gone is not a directory.", ...window } } }))).toBe("Could not start");
	});

	test("a run that ran nothing because the last command still ran counts its error", () => {
		expect(runWords(run({ errors: ["The last run's command is still running."] }))).toBe("1 error");
	});

	test("a run's health fails on any error or an unsuccessful command, runs while its command does, and waits while pending", () => {
		const command = (commandRun: CommandRun) => runHealth(run({ outcome: { kind: "command", run: commandRun } }));
		expect(command({ phase: "exited", code: 0, output: "", ...window })).toBe("ok");
		expect(command({ phase: "exited", code: 3, output: "", ...window })).toBe("failed");
		expect(command({ phase: "stopped", reason: "dashboard", output: "", ...window })).toBe("failed");
		expect(command({ phase: "running", startedAt: at(5, 9) })).toBe("running");
		expect(runHealth(run({ outcome: { kind: "sent", sessionId: "s" } }))).toBe("ok");
		expect(runHealth(run({ outcome: { kind: "sent", sessionId: "s" }, errors: ["late"] }))).toBe("failed");
		expect(runHealth(run({ outcome: { kind: "pending", queued: true } }))).toBe("waiting");
	});
});

describe("run strip", () => {
	const ok = (hour: number) => run({ at: at(5, hour), outcome: { kind: "sent", sessionId: "s" } });
	const failed = (hour: number) => run({ at: at(5, hour), errors: ["GitHub timed out"] });

	test("fills its 10 slots oldest first, so the latest run sits last and empty slots lead", () => {
		const runs = [ok(12), failed(11), ok(10)];
		expect(runSlots(runs)).toEqual([null, null, null, null, null, null, null, ok(10), failed(11), ok(12)]);
		expect(runSlots([])).toEqual(Array(10).fill(null));
	});

	test("keeps the 10 latest runs of more", () => {
		const runs = Array.from({ length: 12 }, (_, index) => ok(20 - index));
		expect(runSlots(runs).map(slot => slot && new Date(slot.at).getHours())).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
	});

	test("counts its runs by how they went, in one order", () => {
		expect(runCountWords([ok(12), failed(11), ok(10)])).toBe("2 succeeded, 1 failed");
		expect(runCountWords([run({}), failed(11)])).toBe("1 failed, 1 waiting");
		expect(runCountWords([])).toBe("No runs yet");
	});

	test("a command's run took from its start to its end, and a prompt's or a running command's has no duration", () => {
		expect(runDuration(run({ outcome: { kind: "command", run: { phase: "exited", code: 0, output: "", startedAt: at(5, 9), endedAt: at(5, 9) + 3000 } } }))).toBe(3000);
		expect(runDuration(run({ outcome: { kind: "command", run: { phase: "running", startedAt: at(5, 9) } } }))).toBeNull();
		expect(runDuration(ok(9))).toBeNull();
	});
});

describe("cadence", () => {
	const evening = { hour: 18, minute: 30 };

	test("each cadence makes one schedule", () => {
		const made = (cadence: Cadence) => scheduleOfCadence({ cadence, time: evening, day: 5 });
		expect(made("hourly")).toEqual({ kind: "every", minutes: 60 });
		expect(made("daily")).toEqual({ kind: "weekly", days: [1, 2, 3, 4, 5, 6, 0], time: evening });
		expect(made("weekdays")).toEqual({ kind: "weekly", days: [1, 2, 3, 4, 5], time: evening });
		expect(made("weekly")).toEqual({ kind: "weekly", days: [5], time: evening });
	});

	test("each cadence's schedule reads back as that cadence, its time, and its day", () => {
		for (const cadence of Object.keys(CADENCES) as Cadence[]) {
			const compact = { cadence, time: { hour: 9, minute: 0 }, day: 1 as const };
			expect(cadenceOf([scheduleOfCadence(compact)])).toEqual(compact);
		}
		expect(cadenceOf([{ kind: "weekly", days: [5], time: evening }])).toEqual({ cadence: "weekly", time: evening, day: 5 });
		expect(cadenceOf([{ kind: "weekly", days: [5, 4, 3, 2, 1], time: evening }])).toEqual({ cadence: "weekdays", time: evening, day: 1 });
	});

	test("any other schedules read as custom", () => {
		expect(cadenceOf([weekdays, { kind: "every", minutes: 60 }])).toBeNull();
		expect(cadenceOf([])).toBeNull();
		expect(cadenceOf([{ kind: "every", minutes: 120 }])).toBeNull();
		expect(cadenceOf([{ kind: "weekly", days: [1, 3], time: evening }])).toBeNull();
		expect(cadenceOf([{ kind: "weekly", days: [6, 0], time: evening }])).toBeNull();
	});

	test("switching cadence keeps the time and the day, and a custom routine starts at Monday 9:00", () => {
		expect(withCadence({ cadence: "daily", time: evening, day: 3 }, "hourly")).toEqual({ cadence: "hourly", time: evening, day: 3 });
		expect(withCadence(null, "weekly")).toEqual({ cadence: "weekly", time: { hour: 9, minute: 0 }, day: 1 });
	});

	test("saving a cadence replaces every schedule with its one and keeps the rest of the routine", () => {
		const custom = routine({ schedules: [weekdays, { kind: "every", minutes: 90 }], triggers: [{ kind: "slack" }], enabled: false, runs: [run({})] });
		expect(specWithSchedule(custom, { kind: "every", minutes: 60 })).toEqual({
			id: "r1",
			botId: scout,
			name: "Morning notes",
			enabled: false,
			task: { kind: "prompt", prompt: "Summarize yesterday's commits." },
			schedules: [{ kind: "every", minutes: 60 }],
			triggers: [{ kind: "slack" }],
		});
	});
});

describe("editor form", () => {
	test("a saved routine's form saves the same routine back, to the same Bot", () => {
		const saved = routine({ schedules: [{ kind: "every", minutes: 360 }], task: { kind: "prompt", prompt: "Reply ok." }, enabled: false });
		expect(draftOf(saved).schedules[0]).toMatchObject({ amount: "6", unit: "hours" });
		expect(draftOf(saved)).toMatchObject({ botId: scout, task: "prompt", prompt: "Reply ok." });
		expect(specOf(draftOf(saved))).toEqual({
			ok: { id: "r1", botId: scout, name: "Morning notes", enabled: false, task: { kind: "prompt", prompt: "Reply ok." }, schedules: [{ kind: "every", minutes: 360 }], triggers: [] },
		});
	});

	test("a form saves weekly days Monday first and its time as typed, and says what to fix first", () => {
		const base = newDraft("r2", scout);
		const draft: RoutineDraft = { ...base, name: " Standup ", prompt: "Hi", schedules: [{ ...base.schedules[0]!, days: [3, 1], time: "18:30" }] };
		expect(specOf(draft)).toEqual({
			ok: { id: "r2", botId: scout, name: "Standup", enabled: true, task: { kind: "prompt", prompt: "Hi" }, schedules: [{ kind: "weekly", days: [1, 3], time: { hour: 18, minute: 30 } }], triggers: [] },
		});
		expect(specOf({ ...draft, name: "" })).toEqual({ fix: "Name the routine." });
		expect(specOf({ ...draft, schedules: [{ ...draft.schedules[0]!, days: [] }] })).toEqual({ fix: "Pick at least one day." });
		expect(specOf({ ...draft, prompt: "  " })).toEqual({ fix: "Write the message the Bot gets." });
		expect(specOf({ ...draft, schedules: [{ ...draft.schedules[0]!, kind: "every", amount: "0" }] })).toEqual({ fix: "Use a whole number of at least 1." });
		const evening = { ...draft.schedules[0]!, time: "18:00", days: [] as Weekday[] };
		expect(specOf({ ...draft, schedules: [...draft.schedules, evening] })).toEqual({ fix: "Schedule 2: Pick at least one day." });
	});

	test("a form with a trigger needs no schedule, saves its triggers in one order, and one with neither says to add one", () => {
		const draft: RoutineDraft = { ...newDraft("r4", scout), name: "Triage", prompt: "Triage it.", schedules: [], triggers: ["event", "slack"] };
		expect(specOf(draft)).toMatchObject({ ok: { schedules: [], triggers: [{ kind: "slack" }, { kind: "event" }] } });
		expect(draftOf(routine({ schedules: [], triggers: [{ kind: "event" }] })).triggers).toEqual(["event"]);
		expect(specOf({ ...draft, triggers: [] })).toEqual({ fix: "Add a schedule or a trigger." });
	});

	test("a command form saves its command, trimmed, and keeps the prompt typed for the other task", () => {
		const draft = { ...newDraft("r3", scout), name: "Prune", task: "command" as const, prompt: "Hi", command: "  git worktree prune\n" };
		expect(specOf(draft)).toEqual({
			ok: { id: "r3", botId: scout, name: "Prune", enabled: true, task: { kind: "command", command: "git worktree prune" }, schedules: [{ kind: "weekly", days: [1, 2, 3, 4, 5], time: { hour: 9, minute: 0 } }], triggers: [] },
		});
		expect(specOf({ ...draft, command: " " })).toEqual({ fix: "Write the command to run." });
		expect(specOf({ ...draft, task: "prompt" })).toMatchObject({ ok: { task: { kind: "prompt", prompt: "Hi" } } });
		const saved = routine({ task: { kind: "command", command: "git worktree prune" } });
		expect(specOf(draftOf(saved))).toMatchObject({ ok: { task: { kind: "command", command: "git worktree prune" } } });
	});
});
