/** The rules of routines: when one is due, which pull requests a run takes, and how a change edits the list. */
import { PULL_REQUEST_ACTIONS } from "./pull-request-actions";
import { type InboxPullRequest, prKey, type Routine, type RoutineChange, type Schedule, type Weekday } from "./shared";

/** What every routine session's prompt ends with, since nobody watches it. */
export const UNATTENDED = "This session runs unattended from a routine. Do not ask questions. If something blocks you, say what and stop.";

/** The one queue entry of a prompt task's run, which no pull request key can be. */
export const PROMPT_TARGET = "prompt";

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

/** Missed slots coalesce into one run: a dashboard closed all weekend runs once on Monday. */
export const isDue = (routine: Routine, now: number): boolean =>
	routine.enabled && nextRunAt(routine.schedule, routine.runs[0]?.at ?? routine.createdAt) <= now;

/** The pull requests to review that `routine`'s action applies to and whose head commit no session took yet, in inbox order; none for a prompt task. */
export function pendingTargets(routine: Routine, prs: InboxPullRequest[]): InboxPullRequest[] {
	const { task } = routine;
	if (task.kind !== "pull-requests") return [];
	const { applies } = PULL_REQUEST_ACTIONS[task.action];
	return prs.filter(pr => pr.role === "reviewer" && pr.state !== "merged" && applies(pr) && routine.done[prKey(pr)] !== pr.headOid);
}

/** `routines` after `change`, or `routines` itself when the change changes nothing. An edit keeps the routine's runs and the heads it took. */
export function applyRoutine(routines: Routine[], change: Exclude<RoutineChange, { op: "run-now" }>, now: number): Routine[] {
	switch (change.op) {
		case "save": {
			const index = routines.findIndex(routine => routine.id === change.routine.id);
			if (index === -1) return [...routines, { ...change.routine, createdAt: now, runs: [], done: {} }];
			const { createdAt, runs, done } = routines[index]!;
			return routines.with(index, { ...change.routine, createdAt, runs, done });
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
