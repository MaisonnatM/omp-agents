/** The rules of routines: when one is due, and how a change edits the list. */
import { type Routine, type RoutineChange, type Schedule, type Schedules, type Weekday } from "./shared";

/** What every routine session's prompt ends with, since nobody watches it. */
export const UNATTENDED = "This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.";

/** The one queue entry of a prompt or command task's run, which starts one thing per run; no pull request key can be it. */
export const SINGLE_TARGET = "single";

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

/** `routines` after `change`, or `routines` itself when the change changes nothing. An edit keeps the routine's runs. */
export function applyRoutine(routines: Routine[], change: Exclude<RoutineChange, { op: "run-now" }>, now: number): Routine[] {
	switch (change.op) {
		case "save": {
			const index = routines.findIndex(routine => routine.id === change.routine.id);
			if (index === -1) return [...routines, { ...change.routine, createdAt: now, runs: [] }];
			const { createdAt, runs } = routines[index]!;
			return routines.with(index, { ...change.routine, createdAt, runs });
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
