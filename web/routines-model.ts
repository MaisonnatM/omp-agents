/** What a Bot's page says about its routines, and the editor's form and how it becomes a routine to save. */
import {
	MAX_COMMAND_LENGTH,
	MAX_ROUTINE_RUNS,
	nextDueAt,
	TRIGGER_KINDS,
	type CommandRun,
	type Routine,
	type RoutineRun,
	type RoutineSpec,
	type RoutineTask,
	type Schedule,
	type TriggerKind,
	type Weekday,
} from "../src/routines";
import type { BotId } from "../src/shared/bots";
import { minutesOfTimeInput, timeInputValue } from "../src/shared/days";

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

/** What starts a routine of each kind of trigger, as a checkbox and a summary say it. */
export const TRIGGER_WORDS: Record<TriggerKind, string> = {
	slack: "When a Slack message waits on you",
	"pull-request": "When a pull request waits on you",
	event: "Before a calendar event starts",
	gmail: "When unread mail comes in",
};

/** What starts `routine`: its schedules in the order they were saved, then its triggers, each in its own words. */
export const startsWords = ({ schedules, triggers }: Pick<Routine, "schedules" | "triggers">): string =>
	[...schedules.map(scheduleWords), ...triggers.map(({ kind }) => TRIGGER_WORDS[kind])].join(", ");

/** The first line of `text` with anything but blanks, trimmed. */
const firstLine = (text: string): string => text.split("\n").find(line => line.trim())?.trim() ?? "";

/** The prompt's first line, or the command's after `$ `. */
export function taskWords(task: RoutineTask): string {
	switch (task.kind) {
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

/** The units a span of time reads in, largest first. */
const SPAN_UNITS = [
	{ unit: "d", seconds: 86_400 },
	{ unit: "h", seconds: 3600 },
	{ unit: "min", seconds: 60 },
	{ unit: "s", seconds: 1 },
] as const;

/** `seconds`, at least 1, in its largest unit and the next one's remainder when that is not 0: `3 d 9 h`, `1 h`, `14 min 30 s`. */
function spanWords(seconds: number): string {
	const index = SPAN_UNITS.findIndex(unit => seconds >= unit.seconds);
	const { unit, seconds: size } = SPAN_UNITS[index]!;
	const whole = `${Math.floor(seconds / size)} ${unit}`;
	const next = SPAN_UNITS[index + 1];
	const rest = next ? Math.floor((seconds % size) / next.seconds) : 0;
	return next && rest > 0 ? `${whole} ${rest} ${next.unit}` : whole;
}

/** How long until `at`, counted up to the whole second: `in 3 d 9 h`, `in 2 h 14 min`, `in 14 min 30 s`, `in 30 s`. */
export const countdownWords = (at: number, now: number): string => `in ${spanWords(Math.max(1, Math.ceil((at - now) / 1000)))}`;

/** How long a run took: `3 s`, `1 min 5 s`, `under 1 s`. */
export const durationWords = (ms: number): string => (ms < 1000 ? "under 1 s" : spanWords(Math.round(ms / 1000)));

/** A past run's time: `today 6:00`, `yesterday 9:00`, else `Fri 16 Oct, 16:00`; all in local time. */
export function pastRunWords(at: number, now: number): string {
	const date = new Date(at);
	const time = timeWords({ hour: date.getHours(), minute: date.getMinutes() });
	// Rounded, since a day across a DST change is 23 or 25 hours.
	const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
	if (days === 0) return `today ${time}`;
	if (days === 1) return `yesterday ${time}`;
	return `${dayName(date.getDay() as Weekday)} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}, ${time}`;
}

/** When `routine`'s schedules run it next, `null` while it is paused or has no schedule. */
export const scheduledRunAt = (routine: Routine): number | null =>
	routine.enabled && routine.schedules.length > 0 ? nextDueAt(routine.schedules, routine.scheduledAt ?? routine.createdAt) : null;

/**
 * When `routine` runs next: `Paused` while it is off, `Due now` once its slot passed, which the next minute's check runs,
 * `On a trigger` when it has no schedule, else `Next run in 2 h 14 min`.
 */
export function nextRunWords(routine: Routine, now: number): string {
	if (!routine.enabled) return "Paused";
	const at = scheduledRunAt(routine);
	if (at === null) return "On a trigger";
	return at <= now ? "Due now" : `Next run ${countdownWords(at, now)}`;
}

/** A row's schedules in the order they were saved, `On a trigger` when it has none. */
export const schedulesWords = ({ schedules }: Pick<Routine, "schedules">): string => schedules.map(scheduleWords).join(", ") || "On a trigger";

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

/** A run's result: `Sent to the Bot, 2 errors`, the parts that apply, or how its command stands. */
export function runWords(run: RoutineRun): string {
	const { outcome } = run;
	if (outcome.kind === "command") return commandWords(outcome.run);
	const parts = [
		outcome.kind === "sent" && "Sent to the Bot",
		run.errors.length > 0 && `${run.errors.length} ${run.errors.length === 1 ? "error" : "errors"}`,
		outcome.kind === "pending" && outcome.queued && "Queued",
	].filter(part => part !== false);
	return parts.length > 0 ? parts.join(", ") : "Nothing sent";
}

/** How a run went, for its dot: `failed` once it has an error, which a command that did not succeed records. */
export type RunHealth = "ok" | "failed" | "running" | "waiting";

export function runHealth({ outcome, errors }: RoutineRun): RunHealth {
	if (errors.length > 0) return "failed";
	switch (outcome.kind) {
		case "pending":
			return "waiting";
		case "sent":
			return "ok";
		case "command": {
			const { run } = outcome;
			if (run.phase === "running") return "running";
			return run.phase === "exited" && run.code === 0 ? "ok" : "failed";
		}
	}
}

/** Each health as the count of a routine's runs says it. */
const HEALTH_WORDS: Record<RunHealth, string> = { ok: "succeeded", failed: "failed", running: "running", waiting: "waiting" };

/** A routine's runs by how they went, the healths it has in one order: `8 succeeded, 1 failed`; `No runs yet` without any. */
export function runCountWords(runs: readonly RoutineRun[]): string {
	const healths = runs.map(runHealth);
	const words = (Object.keys(HEALTH_WORDS) as RunHealth[]).flatMap(health => {
		const count = healths.filter(item => item === health).length;
		return count > 0 ? [`${count} ${HEALTH_WORDS[health]}`] : [];
	});
	return words.join(", ") || "No runs yet";
}

/** The run strip's {@link MAX_ROUTINE_RUNS} slots, oldest first, so the latest sits last; `null` for a slot no run has filled yet. */
export function runSlots(runs: readonly RoutineRun[]): (RoutineRun | null)[] {
	const kept = runs.slice(0, MAX_ROUTINE_RUNS).reverse();
	return [...Array<null>(MAX_ROUTINE_RUNS - kept.length).fill(null), ...kept];
}

/** How long a run's command took, `null` for a prompt or a command still running. */
export function runDuration({ outcome }: RoutineRun): number | null {
	if (outcome.kind !== "command" || outcome.run.phase === "running") return null;
	return outcome.run.endedAt - outcome.run.startedAt;
}

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
 * The editor's form. It keeps both tasks' fields, so switching kind and back keeps what you typed.
 */
export interface RoutineDraft {
	id: string;
	/** The Bot the routine belongs to, which the editor never changes. */
	botId: BotId;
	name: string;
	enabled: boolean;
	task: RoutineTask["kind"];
	prompt: string;
	command: string;
	schedules: ScheduleDraft[];
	triggers: TriggerKind[];
}

/** A new routine's form for Bot `botId`: a prompt on weekdays at 9:00. */
export function newDraft(id: string, botId: BotId): RoutineDraft {
	return { id, botId, name: "", enabled: true, task: "prompt", prompt: "", command: "", schedules: [blankSchedule()], triggers: [] };
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
	const draft = newDraft(routine.id, routine.botId);
	const { task } = routine;
	return {
		...draft,
		name: routine.name,
		enabled: routine.enabled,
		task: task.kind,
		prompt: task.kind === "prompt" ? task.prompt : draft.prompt,
		command: task.kind === "command" ? task.command : draft.command,
		schedules: routine.schedules.map(scheduleDraft),
		triggers: routine.triggers.map(({ kind }) => kind),
	};
}

/** The routine `draft` saves, or what to fix first. */
export function specOf(draft: RoutineDraft): { ok: RoutineSpec } | { fix: string } {
	const name = draft.name.trim();
	if (!name) return { fix: "Name the routine." };
	let task: RoutineTask;
	switch (draft.task) {
		case "prompt":
			if (!draft.prompt.trim()) return { fix: "Write the message the Bot gets." };
			task = { kind: "prompt", prompt: draft.prompt.trim() };
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
	const schedules: Schedule[] = [];
	for (const [index, schedule] of draft.schedules.entries()) {
		const parsed = scheduleOf(schedule, draft.schedules.length > 1 ? index : null);
		if ("fix" in parsed) return parsed;
		schedules.push(parsed.ok);
	}
	if (schedules.length === 0 && draft.triggers.length === 0) return { fix: "Add a schedule or a trigger." };
	const triggers = TRIGGER_KINDS.filter(kind => draft.triggers.includes(kind)).map(kind => ({ kind }));
	return { ok: { id: draft.id, botId: draft.botId, name, enabled: draft.enabled, task, schedules, triggers } };
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

/** The open row's choice of one schedule; a routine whose schedules are any other has none, and reads as custom. */
export type Cadence = "hourly" | "daily" | "weekdays" | "weekly";

type TimeOfDay = Extract<Schedule, { kind: "weekly" }>["time"];

/** A cadence with the time and the day its schedule may need, kept for each cadence so switching to another and back restores them. */
export interface CompactSchedule {
	cadence: Cadence;
	time: TimeOfDay;
	day: Weekday;
}

/** Each cadence's label and the schedule it makes of a time and a day, in the order the control lists them. */
export const CADENCES: Record<Cadence, { label: string; schedule: (time: TimeOfDay, day: Weekday) => Schedule }> = {
	hourly: { label: "Hourly", schedule: () => ({ kind: "every", minutes: 60 }) },
	daily: { label: "Daily", schedule: time => ({ kind: "weekly", days: [...WEEK], time }) },
	weekdays: { label: "Weekdays", schedule: time => ({ kind: "weekly", days: [...WEEKDAYS], time }) },
	weekly: { label: "Weekly", schedule: (time, day) => ({ kind: "weekly", days: [day], time }) },
};

/** What a cadence picked on a custom routine, or on an hourly one, runs at: 9:00, and Monday for weekly. */
const DEFAULT_COMPACT: Omit<CompactSchedule, "cadence"> = { time: { hour: 9, minute: 0 }, day: 1 };

export const scheduleOfCadence = ({ cadence, time, day }: CompactSchedule): Schedule => CADENCES[cadence].schedule(time, day);

function sameSchedule(a: Schedule, b: Schedule): boolean {
	if (a.kind === "every") return b.kind === "every" && a.minutes === b.minutes;
	return b.kind === "weekly" && sameDays(a.days, b.days) && a.time.hour === b.time.hour && a.time.minute === b.time.minute;
}

/** The cadence `schedules` read as, `null` (custom) unless they are one schedule a cadence makes. */
export function cadenceOf(schedules: readonly Schedule[]): CompactSchedule | null {
	const [schedule, ...more] = schedules;
	if (!schedule || more.length > 0) return null;
	const time = schedule.kind === "weekly" ? schedule.time : DEFAULT_COMPACT.time;
	const day = schedule.kind === "weekly" && schedule.days.length === 1 ? schedule.days[0]! : DEFAULT_COMPACT.day;
	const cadence = (Object.keys(CADENCES) as Cadence[]).find(each => sameSchedule(CADENCES[each].schedule(time, day), schedule));
	return cadence ? { cadence, time, day } : null;
}

/** `current` switched to `cadence`, at the defaults when the routine was custom. */
export const withCadence = (current: CompactSchedule | null, cadence: Cadence): CompactSchedule => ({ ...(current ?? DEFAULT_COMPACT), cadence });

/** `routine` to save with `schedule` in place of all its schedules, keeping its triggers. */
export function specWithSchedule({ id, botId, name, enabled, task, triggers }: Routine, schedule: Schedule): RoutineSpec {
	return { id, botId, name, enabled, task, schedules: [schedule], triggers };
}
