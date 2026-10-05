/** What the Routines page says about a routine, and the editor's form and how it becomes a routine to save. */
import { MAX_COMMAND_LENGTH, nextRunAt } from "../src/routines";
import type { CommandRun, Routine, RoutineChange, RoutinePullRequestAction, RoutineRun, RoutineTask, Schedule, Weekday } from "../src/shared";

/** What the editor saves: a routine without what the server keeps. */
export type RoutineSpec = Extract<RoutineChange, { op: "save" }>["routine"];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The days in the order the page lists them, Monday first. */
export const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

export const dayName = (day: Weekday): string => DAY_NAMES[day];

const sameDays = (days: readonly Weekday[], set: readonly Weekday[]): boolean => days.length === set.length && set.every(day => days.includes(day));

/** `9:00`, `18:30`. */
export const timeWords = ({ hour, minute }: { hour: number; minute: number }): string => `${hour}:${String(minute).padStart(2, "0")}`;

/** `Every 6 hours`, `Weekdays at 9:00`, `Every day at 9:00`, `Mon, Wed at 18:30`. */
export function scheduleWords(schedule: Schedule): string {
	switch (schedule.kind) {
		case "every": {
			const { amount, unit } = everyUnit(schedule.minutes);
			if (amount === 1) return { minutes: "Every minute", hours: "Every hour", days: "Every day" }[unit];
			return `Every ${amount} ${unit}`;
		}
		case "weekly": {
			const at = timeWords(schedule.time);
			if (sameDays(schedule.days, WEEK)) return `Every day at ${at}`;
			if (sameDays(schedule.days, WEEKDAYS)) return `Weekdays at ${at}`;
			if (sameDays(schedule.days, [6, 0])) return `Weekends at ${at}`;
			return `${WEEK.filter(day => schedule.days.includes(day)).map(dayName).join(", ")} at ${at}`;
		}
		default: {
			const unhandled: never = schedule;
			return unhandled;
		}
	}
}

export const ROUTINE_ACTION_WORDS: Record<RoutinePullRequestAction, string> = {
	review: "Review pull requests",
	"thermonuclear-review": "Thermonuclear review",
};

/** The first line of `text` with anything but blanks, trimmed. */
const firstLine = (text: string): string => text.split("\n").find(line => line.trim())?.trim() ?? "";

/** `Review pull requests`, `Thermonuclear review`, the prompt's first line, or the command's after `$ `. */
export function taskWords(task: RoutineTask): string {
	switch (task.kind) {
		case "pull-requests":
			return ROUTINE_ACTION_WORDS[task.action];
		case "prompt":
			return firstLine(task.prompt);
		case "command":
			return `$ ${firstLine(task.command)}`;
		default: {
			const unhandled: never = task;
			return unhandled;
		}
	}
}

const startOfDay = (at: number): number => new Date(at).setHours(0, 0, 0, 0);

/** `Today at 9:00`, `Tomorrow at 9:00`, `Mon at 9:00` within the week, else `Oct 12 at 9:00`; all in local time. */
export function whenWords(at: number, now: number): string {
	const date = new Date(at);
	const time = timeWords({ hour: date.getHours(), minute: date.getMinutes() });
	// Rounded, since a day across a DST change is 23 or 25 hours.
	const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
	if (days === 0) return `Today at ${time}`;
	if (days === 1) return `Tomorrow at ${time}`;
	if (days > 1 && days < 7) return `${dayName(date.getDay() as Weekday)} at ${time}`;
	return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()} at ${time}`;
}

/** When `routine` runs next: `Paused` while it is off, `Due now` once its slot passed, which the next minute's check runs. */
export function nextRunWords(routine: Routine, now: number): string {
	if (!routine.enabled) return "Paused";
	const next = nextRunAt(routine.schedule, routine.runs[0]?.at ?? routine.createdAt);
	return next <= now ? "Due now" : whenWords(next, now);
}

/** How a run's command stands, `null` for a run without one. */
function commandWords(command: CommandRun | null): string | null {
	switch (command?.phase) {
		case undefined:
			return null;
		case "running":
			return "Running…";
		case "exited":
			return command.code === 0 ? "Succeeded" : `Failed (exit ${command.code})`;
		case "stopped":
			return command.reason === "time-limit" ? "Stopped at the time limit" : "Stopped with the dashboard";
		case "failed":
			return "Could not start";
	}
}

/** A command run's result, else `1 session started, 2 errors, Queued: 3`, the parts that apply. */
export function runWords(run: RoutineRun, task: RoutineTask): string {
	const command = commandWords(run.command);
	if (command !== null) return command;
	const parts = [
		run.started.length > 0 && `${run.started.length} ${run.started.length === 1 ? "session" : "sessions"} started`,
		run.errors.length > 0 && `${run.errors.length} ${run.errors.length === 1 ? "error" : "errors"}`,
		run.queue.length > 0 && `Queued: ${run.queue.length}`,
	].filter(part => part !== false);
	if (parts.length > 0) return parts.join(", ");
	return task.kind === "pull-requests" ? "No pull requests to review" : "Nothing started";
}

/** The last run's result, or that there was none. */
export const lastRunWords = (routine: Routine): string => (routine.runs[0] ? runWords(routine.runs[0], routine.task) : "Not run yet");

export type EveryUnit = "minutes" | "hours" | "days";

const UNIT_MINUTES: Record<EveryUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** `minutes` in the largest unit that divides it: 360 reads 6 hours. */
export function everyUnit(minutes: number): { amount: number; unit: EveryUnit } {
	const unit = minutes % UNIT_MINUTES.days === 0 ? "days" : minutes % UNIT_MINUTES.hours === 0 ? "hours" : "minutes";
	return { amount: minutes / UNIT_MINUTES[unit], unit };
}

/**
 * The editor's form. It keeps every task's and both schedules' fields, so switching kind and back keeps what you typed.
 * `amount` and `time` hold the inputs' text as typed (`time` is `HH:MM`).
 */
export interface RoutineDraft {
	id: string;
	name: string;
	cwd: string;
	enabled: boolean;
	skill: string | null;
	task: RoutineTask["kind"];
	prompt: string;
	action: RoutinePullRequestAction;
	command: string;
	schedule: Schedule["kind"];
	amount: string;
	unit: EveryUnit;
	days: Weekday[];
	time: string;
}

/** A new routine's form: a prompt on weekdays at 9:00 in `cwd`, through `skill`. */
export function newDraft(id: string, cwd: string, skill: string | null): RoutineDraft {
	return {
		id,
		name: "",
		cwd,
		enabled: true,
		skill,
		task: "prompt",
		prompt: "",
		action: "review",
		command: "",
		schedule: "weekly",
		amount: "1",
		unit: "days",
		days: [...WEEKDAYS],
		time: "09:00",
	};
}

/** `routine`'s form, its other kinds' fields at their defaults. */
export function draftOf(routine: Routine): RoutineDraft {
	const draft = newDraft(routine.id, routine.cwd, routine.skill);
	const { task, schedule } = routine;
	const every = schedule.kind === "every" ? everyUnit(schedule.minutes) : null;
	return {
		...draft,
		name: routine.name,
		enabled: routine.enabled,
		task: task.kind,
		prompt: task.kind === "prompt" ? task.prompt : draft.prompt,
		action: task.kind === "pull-requests" ? task.action : draft.action,
		command: task.kind === "command" ? task.command : draft.command,
		schedule: schedule.kind,
		amount: every ? String(every.amount) : draft.amount,
		unit: every?.unit ?? draft.unit,
		days: schedule.kind === "weekly" ? [...schedule.days] : draft.days,
		time: schedule.kind === "weekly" ? `${String(schedule.time.hour).padStart(2, "0")}:${String(schedule.time.minute).padStart(2, "0")}` : draft.time,
	};
}

/** The routine `draft` saves, or what to fix first. */
export function specOf(draft: RoutineDraft): { ok: RoutineSpec } | { fix: string } {
	const name = draft.name.trim();
	if (!name) return { fix: "Name the routine." };
	const cwd = draft.cwd.trim();
	if (!cwd) return { fix: "Choose a workspace." };
	let task: RoutineTask;
	switch (draft.task) {
		case "prompt":
			if (!draft.prompt.trim()) return { fix: "Write the prompt the session starts with." };
			task = { kind: "prompt", prompt: draft.prompt.trim() };
			break;
		case "pull-requests":
			task = { kind: "pull-requests", action: draft.action };
			break;
		case "command": {
			const command = draft.command.trim();
			if (!command) return { fix: "Write the command to run." };
			if (command.length > MAX_COMMAND_LENGTH) return { fix: `Shorten the command to ${MAX_COMMAND_LENGTH.toLocaleString("en-US")} characters or fewer.` };
			task = { kind: "command", command };
			break;
		}
		default: {
			const unhandled: never = draft.task;
			return unhandled;
		}
	}
	let schedule: Schedule;
	if (draft.schedule === "every") {
		const amount = Number(draft.amount);
		if (!Number.isSafeInteger(amount) || amount < 1) return { fix: "Use a whole number of at least 1." };
		schedule = { kind: "every", minutes: amount * UNIT_MINUTES[draft.unit] };
	} else {
		if (draft.days.length === 0) return { fix: "Pick at least one day." };
		const match = /^(\d{2}):(\d{2})$/.exec(draft.time);
		if (!match) return { fix: "Set the time it runs at." };
		schedule = { kind: "weekly", days: WEEK.filter(day => draft.days.includes(day)), time: { hour: Number(match[1]), minute: Number(match[2]) } };
	}
	// A command runs without a session, so it has no skill to start one with.
	const skill = task.kind === "command" ? null : draft.skill;
	return { ok: { id: draft.id, name, cwd, enabled: draft.enabled, skill, task, schedule } };
}
