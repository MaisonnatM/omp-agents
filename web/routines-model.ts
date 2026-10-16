/** What the Routines page says about a routine, and the editor's form and how it becomes a routine to save. */
import { nonEmpty } from "../src/json";
import { MAX_COMMAND_LENGTH, nextDueAt, type CommandRun, type Routine, type RoutineRun, type RoutineSpec, type RoutineTask, type Schedule, type Weekday } from "../src/routines";
import { minutesOfTimeInput, timeInputValue } from "./days";

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

/** The schedules in the order they were saved, each in its own words. */
export const schedulesWords = (schedules: readonly Schedule[]): string => schedules.map(scheduleWords).join(", ");

/** The first line of `text` with anything but blanks, trimmed. */
const firstLine = (text: string): string => text.split("\n").find(line => line.trim())?.trim() ?? "";

/** The prompt's first line, or the command's after `$ `. */
export function taskWords(task: RoutineTask): string {
	switch (task.kind) {
		case "prompt":
			return firstLine(task.prompt);
		case "command":
			return `$ ${firstLine(task.command)}`;
		case "project":
			return `To project: ${firstLine(task.prompt)}`;
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
	const next = nextDueAt(routine.schedules, routine.runs[0]?.at ?? routine.createdAt);
	return next <= now ? "Due now" : whenWords(next, now);
}

/** How a command stands. */
function commandWords(command: CommandRun): string {
	switch (command.phase) {
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

/** A run's result: `1 session started, 2 errors, Queued`, the parts that apply, or how its command stands. */
export function runWords(run: RoutineRun): string {
	const { outcome } = run;
	if (outcome.kind === "command") return commandWords(outcome.run);
	const parts = [
		outcome.kind === "session" && "1 session started",
		outcome.kind === "project" && "Sent to the project",
		run.errors.length > 0 && `${run.errors.length} ${run.errors.length === 1 ? "error" : "errors"}`,
		outcome.kind === "pending" && outcome.queued && "Queued",
	].filter(part => part !== false);
	return parts.length > 0 ? parts.join(", ") : "Nothing started";
}

/** The last run's result, or that there was none. */
export const lastRunWords = (routine: Routine): string => (routine.runs[0] ? runWords(routine.runs[0]) : "Not run yet");

export type EveryUnit = "minutes" | "hours" | "days";

const UNIT_MINUTES: Record<EveryUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** `minutes` in the largest unit that divides it: 360 reads 6 hours. */
export function everyUnit(minutes: number): { amount: number; unit: EveryUnit } {
	const unit = minutes % UNIT_MINUTES.days === 0 ? "days" : minutes % UNIT_MINUTES.hours === 0 ? "hours" : "minutes";
	return { amount: minutes / UNIT_MINUTES[unit], unit };
}

/**
 * One schedule in the editor. It keeps both kinds' fields, so switching kind and back keeps what you typed.
 * `amount` and `time` hold the inputs' text as typed (`time` is `HH:MM`).
 */
export interface ScheduleDraft {
	kind: Schedule["kind"];
	amount: string;
	unit: EveryUnit;
	days: Weekday[];
	time: string;
}

/** A schedule the editor adds: weekdays at 9:00. */
export function blankSchedule(): ScheduleDraft {
	return { kind: "weekly", amount: "1", unit: "days", days: [...WEEKDAYS], time: "09:00" };
}

/**
 * The editor's form. It keeps every task's fields, so switching kind and back keeps what you typed.
 */
export interface RoutineDraft {
	id: string;
	name: string;
	cwd: string;
	enabled: boolean;
	skill: string | null;
	/** The preset whose model, tools, and branch each run starts with, `null` for none. */
	preset: string | null;
	task: RoutineTask["kind"];
	prompt: string;
	/** Whether the prompt's session is pinned once it finishes. */
	pin: boolean;
	command: string;
	/** The project whose coordinator a project task's prompt goes to, `null` until one is picked. */
	projectId: string | null;
	schedules: ScheduleDraft[];
}

/** A new routine's form: a prompt on weekdays at 9:00 in `cwd`, through `skill`. */
export function newDraft(id: string, cwd: string, skill: string | null): RoutineDraft {
	return {
		id,
		name: "",
		cwd,
		enabled: true,
		skill,
		preset: null,
		task: "prompt",
		prompt: "",
		pin: false,
		command: "",
		projectId: null,
		schedules: [blankSchedule()],
	};
}

/** One saved schedule as the editor shows it, with the other kind's fields at their defaults. */
function scheduleDraft(schedule: Schedule): ScheduleDraft {
	const blank = blankSchedule();
	if (schedule.kind === "every") {
		const every = everyUnit(schedule.minutes);
		return { ...blank, kind: "every", amount: String(every.amount), unit: every.unit };
	}
	const { hour, minute } = schedule.time;
	return { ...blank, kind: "weekly", days: [...schedule.days], time: timeInputValue(hour * 60 + minute) };
}

/** `routine`'s form, its other task's fields at their defaults. */
export function draftOf(routine: Routine): RoutineDraft {
	const draft = newDraft(routine.id, routine.cwd, routine.skill);
	const { task } = routine;
	return {
		...draft,
		name: routine.name,
		enabled: routine.enabled,
		preset: routine.preset,
		task: task.kind,
		prompt: task.kind === "command" ? draft.prompt : task.prompt,
		pin: task.kind === "prompt" ? task.pin : draft.pin,
		command: task.kind === "command" ? task.command : draft.command,
		projectId: task.kind === "project" ? task.projectId : draft.projectId,
		schedules: routine.schedules.map(scheduleDraft),
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
			task = { kind: "prompt", prompt: draft.prompt.trim(), pin: draft.pin };
			break;
		case "command": {
			const command = draft.command.trim();
			if (!command) return { fix: "Write the command to run." };
			if (command.length > MAX_COMMAND_LENGTH) return { fix: `Shorten the command to ${MAX_COMMAND_LENGTH.toLocaleString("en-US")} characters or fewer.` };
			task = { kind: "command", command };
			break;
		}
		case "project":
			if (draft.projectId === null) return { fix: "Pick the project its prompt goes to." };
			if (!draft.prompt.trim()) return { fix: "Write the prompt the coordinator gets." };
			task = { kind: "project", projectId: draft.projectId, prompt: draft.prompt.trim() };
			break;
		default: {
			const unhandled: never = draft.task;
			return unhandled;
		}
	}
	const schedules: Schedule[] = [];
	for (const [index, schedule] of draft.schedules.entries()) {
		const parsed = scheduleOf(schedule, draft.schedules.length > 1 ? index : null);
		if ("fix" in parsed) return parsed;
		schedules.push(parsed.ok);
	}
	const schedulesOf = nonEmpty(schedules);
	if (!schedulesOf) return { fix: "Add a schedule." };
	const session = task.kind === "prompt";
	return { ok: { id: draft.id, name, cwd, enabled: draft.enabled, skill: session ? draft.skill : null, preset: session ? draft.preset : null, task, schedules: schedulesOf } };
}

/** `draft` as a schedule, or what to fix. `index` names it when the routine has several. */
function scheduleOf(draft: ScheduleDraft, index: number | null): { ok: Schedule } | { fix: string } {
	const which = index === null ? "" : `Schedule ${index + 1}: `;
	if (draft.kind === "every") {
		const amount = Number(draft.amount);
		if (!Number.isSafeInteger(amount) || amount < 1) return { fix: `${which}Use a whole number of at least 1.` };
		return { ok: { kind: "every", minutes: amount * UNIT_MINUTES[draft.unit] } };
	}
	if (draft.days.length === 0) return { fix: `${which}Pick at least one day.` };
	const minutes = minutesOfTimeInput(draft.time);
	if (minutes === null) return { fix: `${which}Set the time it runs at.` };
	return { ok: { kind: "weekly", days: WEEK.filter(day => draft.days.includes(day)), time: { hour: Math.floor(minutes / 60), minute: minutes % 60 } } };
}
