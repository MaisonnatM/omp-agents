/** The rules of routines: when one is due, and how a change edits the list. */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule =
	/** Every `minutes`, counted from the last run. The page offers minutes, hours, and days. */
	| { kind: "every"; minutes: number }
	/** At `time`, local wall-clock time, on each of `days` (0 is Sunday). Daily is all seven. */
	| { kind: "weekly"; days: Weekday[]; time: { hour: number; minute: number } };

/** One or more. A routine is due at the earliest. */
export type Schedules = [Schedule, ...Schedule[]];

export type RoutineTask =
	/** One session in `cwd` that takes `prompt`; with `pin`, the session is pinned once its turn finishes, in place of the routine's earlier sessions. */
	| { kind: "prompt"; prompt: string; pin: boolean }
	/** `command` through `sh -c` in the routine's cwd, with no omp session. */
	| { kind: "command"; command: string };

/** A run's command: `running` from its launch, saved before it can end, then how it ended. */
export type CommandRun =
	| { phase: "running"; startedAt: number }
	| { phase: "exited"; code: number; output: string; startedAt: number; endedAt: number }
	/** Killed at the time limit, or by a dashboard stop, which the next server records. */
	| { phase: "stopped"; reason: "time-limit" | "dashboard"; output: string; startedAt: number; endedAt: number }
	/** `sh` could not start, as when the workspace is gone. */
	| { phase: "failed"; error: string; startedAt: number; endedAt: number };

/** A claimed run waits `pending` until it starts the one thing it asks for: a session, or a command. */
export type RoutineOutcome =
	| { kind: "pending"; queued: boolean }
	| { kind: "session"; instanceId: string; sessionId: string }
	| { kind: "command"; run: CommandRun };

export interface RoutineRun {
	at: number;
	outcome: RoutineOutcome;
	errors: string[];
}

/** Schedules that start dashboard sessions, or run a command, on their own. */
export interface Routine {
	id: string;
	name: string;
	cwd: string;
	schedules: Schedules;
	task: RoutineTask;
	/** Saved with the routine, since the page's pin lives in localStorage, which the server cannot read. */
	skill: string | null;
	enabled: boolean;
	createdAt: number;
	/** Newest first, the last 10. `runs[0].at` is the time every schedule counts from. */
	runs: RoutineRun[];
}

/** One edit of the routines; the page picks a new routine's `id`, so a save sent twice saves once. */
export type RoutineChange =
	| { op: "save"; routine: Omit<Routine, "runs" | "createdAt"> }
	| { op: "remove"; id: string }
	| { op: "enable"; id: string; enabled: boolean }
	/** Claims a run now, whatever the schedule says. */
	| { op: "run-now"; id: string };

/** What every routine session's prompt ends with, since nobody watches it. */
export const UNATTENDED = "This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.";

/** A command routine's command: the longest one a routine saves, how long it may run, and how much of its output a run keeps. */
export const MAX_COMMAND_LENGTH = 10_000;
export const COMMAND_TIMEOUT_MS = 600_000;
export const MAX_COMMAND_OUTPUT = 64 * 1024;
/** {@link COMMAND_TIMEOUT_MS} in words: `10 minutes`. */
export const COMMAND_TIME_LIMIT = `${COMMAND_TIMEOUT_MS / 60_000} minutes`;

/** The runs a routine keeps, newest first. */
export const MAX_ROUTINE_RUNS = 10;

/** The first run time strictly after `after`. Weekly slots use local time, so 9:00 stays 9:00 across DST. */
export function nextRunAt(schedule: Schedule, after: number): number {
	switch (schedule.kind) {
		case "every":
			return after + schedule.minutes * 60_000;
		case "weekly": {
			const day = new Date(after);
			for (let offset = 0; offset <= 7; offset++) {
				const at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, schedule.time.hour, schedule.time.minute);
				if (at.getTime() > after && schedule.days.includes(at.getDay() as Weekday)) return at.getTime();
			}
			throw new Error("a weekly schedule names no day");
		}
		default: {
			const unhandled: never = schedule;
			return unhandled;
		}
	}
}

/** The earliest next run across `schedules`, each counted from the same `after`. Two intervals therefore share one clock, and the shorter one wins. */
export const nextDueAt = (schedules: Schedules, after: number): number => Math.min(...schedules.map(schedule => nextRunAt(schedule, after)));

/** Missed slots coalesce into one run: a dashboard closed all weekend runs once on Monday. */
export const isDue = (routine: Routine, now: number): boolean =>
	routine.enabled && nextDueAt(routine.schedules, routine.runs[0]?.at ?? routine.createdAt) <= now;

/** Whether `routine` already holds every field the page edits of `spec`. */
function isSameSpec(routine: Routine, spec: Extract<RoutineChange, { op: "save" }>["routine"]): boolean {
	return (
		routine.name === spec.name &&
		routine.cwd === spec.cwd &&
		routine.skill === spec.skill &&
		routine.enabled === spec.enabled &&
		JSON.stringify([routine.schedules, routine.task]) === JSON.stringify([spec.schedules, spec.task])
	);
}

/** `routines` after `change`, or `routines` itself when the change changes nothing. An edit keeps the routine's runs. */
export function applyRoutine(routines: Routine[], change: Exclude<RoutineChange, { op: "run-now" }>, now: number): Routine[] {
	switch (change.op) {
		case "save": {
			const index = routines.findIndex(routine => routine.id === change.routine.id);
			if (index === -1) return [...routines, { ...change.routine, createdAt: now, runs: [] }];
			const stored = routines[index]!;
			if (isSameSpec(stored, change.routine)) return routines;
			return routines.with(index, { ...change.routine, createdAt: stored.createdAt, runs: stored.runs });
		}
		case "remove": {
			const kept = routines.filter(routine => routine.id !== change.id);
			return kept.length === routines.length ? routines : kept;
		}
		case "enable": {
			const index = routines.findIndex(routine => routine.id === change.id);
			const routine = routines[index];
			return routine === undefined || routine.enabled === change.enabled ? routines : routines.with(index, { ...routine, enabled: change.enabled });
		}
		default: {
			const unhandled: never = change;
			return unhandled;
		}
	}
}
