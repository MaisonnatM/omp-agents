/** The rules of routines: when one is due, how a change edits the list, and which routine the page and `routines.json` may hold. */
import { isNonEmpty, isObject, isSafeInteger, oneOf, type Parsed } from "./json";
import { type BotId, parseBotId } from "./shared/bots";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule =
	/** Every `minutes`, counted from the last run a schedule or **Run now** started. The page offers minutes, hours, and days. */
	| { kind: "every"; minutes: number }
	/** At `time`, local wall-clock time, on each of `days` (0 is Sunday). Daily is all seven. */
	| { kind: "weekly"; days: Weekday[]; time: { hour: number; minute: number } };

/**
 * What the dashboard already watches that starts a run when it happens: a Slack message that waits on you, a pull
 * request of a workspace whose status changes, a calendar event about to start, or unread mail in a Gmail inbox.
 */
export const TRIGGER_KINDS = ["slack", "pull-request", "event", "gmail"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export interface Trigger {
	kind: TriggerKind;
}

/** One thing a trigger saw happen, as the run's message names it: `title` in a line, `detail` the rest, empty when there is none. */
export interface TriggerEvent {
	kind: TriggerKind;
	title: string;
	detail: string;
	url: string | null;
}

/** The trigger events one run keeps, the first its check listed, and how much of an event's detail. */
export const MAX_TRIGGER_EVENTS = 10;
export const MAX_TRIGGER_DETAIL = 2_000;

/** What a run does in its Bot: the Bot's model, skill, and workspace apply to both. */
export type RoutineTask =
	/** `prompt` sent into the Bot's conversation, as if you wrote it there. */
	| { kind: "prompt"; prompt: string }
	/** `command` through `sh -c` in the Bot's workspace, with no omp session; what it printed is then posted into the Bot's conversation. */
	| { kind: "command"; command: string };

/** A run's command: `running` from its launch, saved before it can end, then how it ended. */
export type CommandRun =
	| { phase: "running"; startedAt: number }
	| { phase: "exited"; code: number; output: string; startedAt: number; endedAt: number }
	/** Killed at the time limit, or by a dashboard stop, which the next server records. */
	| { phase: "stopped"; reason: "time-limit" | "dashboard"; output: string; startedAt: number; endedAt: number }
	/** `sh` could not start, as when the workspace is gone. */
	| { phase: "failed"; error: string; startedAt: number; endedAt: number };

/** A claimed run waits `pending` until it sends its prompt into conversation `sessionId` or runs its command. */
export type RoutineOutcome =
	| { kind: "pending"; queued: boolean }
	| { kind: "sent"; sessionId: string }
	| { kind: "command"; run: CommandRun };

export interface RoutineRun {
	at: number;
	outcome: RoutineOutcome;
	errors: string[];
	/** What the routine's triggers saw that started this run; empty for a run a schedule or **Run now** started. */
	triggeredBy: TriggerEvent[];
}

/** A Bot's routine: on its schedules, or when its triggers see something happen, a run sends a prompt into the Bot's conversation or runs a command in its workspace. */
export interface Routine {
	id: string;
	/** The Bot the routine belongs to; deleting the Bot deletes the routine. */
	botId: BotId;
	name: string;
	/** Empty when the routine runs only on its triggers. It has at least one schedule or trigger. */
	schedules: Schedule[];
	triggers: Trigger[];
	task: RoutineTask;
	enabled: boolean;
	createdAt: number;
	/** When the last run a schedule or **Run now** started was claimed, `null` before any; every schedule counts from it, so a triggered run moves no schedule. */
	scheduledAt: number | null;
	/** Newest first, the last 10. */
	runs: RoutineRun[];
}

/** What the page edits of a routine: all but its runs and the times the server keeps. */
export type RoutineSpec = Omit<Routine, "runs" | "createdAt" | "scheduledAt">;

/** One edit of the routines; the page picks a new routine's `id`, so a save sent twice saves once. */
export type RoutineChange =
	| { op: "save"; routine: RoutineSpec }
	| { op: "remove"; id: string }
	| { op: "enable"; id: string; enabled: boolean }
	/** Claims a run now, whatever the schedule says. */
	| { op: "run-now"; id: string };

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

/**
 * The earliest next run across `schedules`, each counted from the same `after`, or `Infinity` for none. Two intervals
 * therefore share one clock, and the shorter one wins.
 */
export const nextDueAt = (schedules: readonly Schedule[], after: number): number => Math.min(...schedules.map(schedule => nextRunAt(schedule, after)));

/** Missed slots coalesce into one run: a dashboard closed all weekend runs once on Monday. */
export const isDue = (routine: Routine, now: number): boolean =>
	routine.enabled && nextDueAt(routine.schedules, routine.scheduledAt ?? routine.createdAt) <= now;

/** Whether `routine` runs when a trigger of `kind` sees something happen. */
export const isTriggeredBy = (routine: Routine, kind: TriggerKind): boolean => routine.enabled && routine.triggers.some(trigger => trigger.kind === kind);

/** The trigger kinds some enabled routine of `routines` runs on, so a check reads only what a routine watches. */
export const watchedKinds = (routines: readonly Routine[]): TriggerKind[] => TRIGGER_KINDS.filter(kind => routines.some(routine => isTriggeredBy(routine, kind)));

/** Whether `routine` already holds every field the page edits of `spec`. */
function isSameSpec(routine: Routine, spec: RoutineSpec): boolean {
	return (
		routine.botId === spec.botId &&
		routine.name === spec.name &&
		routine.enabled === spec.enabled &&
		JSON.stringify([routine.schedules, routine.triggers, routine.task]) === JSON.stringify([spec.schedules, spec.triggers, spec.task])
	);
}

/** `routines` after `change`, or `routines` itself when the change changes nothing. An edit keeps the routine's runs. */
export function applyRoutine(routines: Routine[], change: Exclude<RoutineChange, { op: "run-now" }>, now: number): Routine[] {
	switch (change.op) {
		case "save": {
			const index = routines.findIndex(routine => routine.id === change.routine.id);
			if (index === -1) return [...routines, { ...change.routine, createdAt: now, scheduledAt: null, runs: [] }];
			const stored = routines[index]!;
			if (isSameSpec(stored, change.routine)) return routines;
			return routines.with(index, { ...change.routine, createdAt: stored.createdAt, scheduledAt: stored.scheduledAt, runs: stored.runs });
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

const isIntIn = (value: unknown, min: number, max: number): value is number => isSafeInteger(value) && value >= min && value <= max;
const isWeekday = (value: unknown): value is Weekday => isIntIn(value, 0, 6);

function parseSchedule(value: unknown): Parsed<Schedule> {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "every":
			return isIntIn(value.minutes, 1, Number.MAX_SAFE_INTEGER) ? { ok: { kind: "every", minutes: value.minutes } } : null;
		case "weekly": {
			const { days, time } = value;
			if (!Array.isArray(days) || days.length === 0 || !days.every(isWeekday) || new Set(days).size !== days.length) return null;
			if (!isObject(time) || !isIntIn(time.hour, 0, 23) || !isIntIn(time.minute, 0, 59)) return null;
			return { ok: { kind: "weekly", days, time: { hour: time.hour, minute: time.minute } } };
		}
		default:
			return null;
	}
}

function parseSchedules(value: unknown): Parsed<Schedule[]> {
	if (!Array.isArray(value)) return null;
	const schedules: Schedule[] = [];
	for (const entry of value) {
		const schedule = parseSchedule(entry);
		if (!schedule) return null;
		schedules.push(schedule.ok);
	}
	return { ok: schedules };
}

export const isTriggerKind = oneOf(TRIGGER_KINDS);

/** Each kind at most once. */
function parseTriggers(value: unknown): Parsed<Trigger[]> {
	if (!Array.isArray(value)) return null;
	const triggers: Trigger[] = [];
	for (const entry of value) {
		if (!isObject(entry) || !isTriggerKind(entry.kind) || triggers.some(({ kind }) => kind === entry.kind)) return null;
		triggers.push({ kind: entry.kind });
	}
	return { ok: triggers };
}

function parseRoutineTask(value: unknown): Parsed<RoutineTask> {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "prompt":
			return isNonEmpty(value.prompt) ? { ok: { kind: "prompt", prompt: value.prompt } } : null;
		case "command":
			return isNonEmpty(value.command) && value.command.length <= MAX_COMMAND_LENGTH ? { ok: { kind: "command", command: value.command } } : null;
		default:
			return null;
	}
}

/**
 * A routine as the page saves it and `routines.json` keeps it, or `null` when a field is missing, of the wrong type, or
 * out of range, or when it has neither a schedule nor a trigger; other fields drop.
 */
export function parseRoutineSpec(value: unknown): Parsed<RoutineSpec> {
	if (!isObject(value)) return null;
	const { id, name, enabled } = value;
	const botId = parseBotId(value.botId);
	const schedules = parseSchedules(value.schedules);
	const triggers = parseTriggers(value.triggers);
	const task = parseRoutineTask(value.task);
	if (!isNonEmpty(id) || !botId || !isNonEmpty(name) || typeof enabled !== "boolean" || !schedules || !triggers || !task) return null;
	if (schedules.ok.length === 0 && triggers.ok.length === 0) return null;
	return { ok: { id, botId, name, schedules: schedules.ok, triggers: triggers.ok, task: task.ok, enabled } };
}
