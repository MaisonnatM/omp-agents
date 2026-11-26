/** The rules of routines: when one is due, how a change edits the list, and which routine the page and `routines.json` may hold. */
import { type BoardLaunch, parseLaunch } from "../templates/omp/agent/extensions/board/log";
import { fields, isNonEmpty, isNumber, isObject, isSafeInteger, isString, nullable, oneOf, parseAll, type Parsed } from "./json";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type Schedule =
	/** Every `minutes`, counted from the last run a schedule or **Run now** started. The page offers minutes, hours, and days. */
	| { kind: "every"; minutes: number }
	/** At `time`, local wall-clock time, on each of `days` (0 is Sunday). Daily is all seven. */
	| { kind: "weekly"; days: Weekday[]; time: { hour: number; minute: number } };

/**
 * What the dashboard already watches that starts a run when it happens: a Slack message that waits on you, or a pull
 * request of a workspace whose status changes.
 */
export const TRIGGER_KINDS = ["slack", "pull-request"] as const;
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

/**
 * What a run posts as a Board task in the routine's Workspace, which a session then works on; a run replies on the
 * routine's own Board task instead while that is not done.
 */
export type RoutineTask =
	/** `prompt` is the Board task's text, with what the routine's triggers saw. */
	| { kind: "prompt"; prompt: string }
	/** `command` through `sh -c` in the Workspace, with no omp session; its report, below `prompt` when there is one, is then posted:
	 * with `post: "failures"` only when it did not exit 0, and with `post: "changes"` also when it exited 0 with output other than the
	 * last run's, so a check posts only on news. No `post` posts every run.
	 */
	| { kind: "command"; command: string; post?: CommandPost; prompt?: string };

/** When a command run posts its report as a Board task, beside every run. */
export const COMMAND_POSTS = ["failures", "changes"] as const;
export type CommandPost = (typeof COMMAND_POSTS)[number];

/** The error a command run records when it exits with `code`, other than 0. */
export const exitedWith = (code: number): string => `Exited with code ${code}.`;
const isCommandPost = oneOf(COMMAND_POSTS);

/**
 * A run's command: `running` from its launch, saved before it can end, then how it ended. `slept` is how long the Mac
 * slept between `startedAt` and `endedAt`, when a second or more.
 */
export type CommandRun =
	| { phase: "running"; startedAt: number }
	| { phase: "exited"; code: number; output: string; startedAt: number; endedAt: number; slept?: number }
	/** Killed at the time limit, or by a dashboard stop, which the next server records. */
	| { phase: "stopped"; reason: "time-limit" | "dashboard"; output: string; startedAt: number; endedAt: number; slept?: number }
	/** `sh` could not start, as when the workspace is gone. */
	| { phase: "failed"; error: string; startedAt: number; endedAt: number };

/**
 * Where a claimed run stands: `queued` until a tick starts it, then `sending` while it posts, `posted` once it posted
 * Board task `task` or replied on it, or its `command`, with the Board task its report went to, if it posted. A run
 * that started nothing is `failed`, with its `errors` saying why; so is one a stopped server left `sending`.
 */
export type RoutineOutcome =
	| { kind: "queued" }
	| { kind: "sending" }
	| { kind: "posted"; task: number }
	| { kind: "command"; run: CommandRun; task?: number }
	| { kind: "failed" };

export interface RoutineRun {
	at: number;
	outcome: RoutineOutcome;
	errors: string[];
	/** What the routine's triggers saw that started this run; empty for a run a schedule or **Run now** started. */
	triggeredBy: TriggerEvent[];
	/** What the session on the run's Board task spent on it, once that turn ended; left out before then and for a run that posted nothing. */
	usage?: RunUsage;
}

/** What a session's turn spent: its tokens, input, output, and cache together, and its cost in dollars as the provider priced it. */
export interface RunUsage {
	tokens: number;
	cost: number;
}

export const isRunUsage = fields<RunUsage>({ tokens: isNumber, cost: isNumber });

/** A Workspace's routine: on its schedules, or when its triggers see something happen, a run posts a Board task in the Workspace, or runs a command there. */
export interface Routine {
	id: string;
	/** The Workspace it posts to and runs its command in: a repository's main checkout, or a directory outside git. */
	workspace: string;
	/** The model and thinking level of the sessions on its Board tasks; left out for omp's defaults. */
	launch?: BoardLaunch;
	name: string;
	/** Empty when the routine runs only on its triggers. It has at least one schedule or trigger. */
	schedules: Schedule[];
	triggers: Trigger[];
	task: RoutineTask;
	enabled: boolean;
	/** The other computer it runs on while enabled, as Settings sync carried it; `null` while it runs on this one or is off. */
	machine: RoutineMachine | null;
	createdAt: number;
	/** When the last run a schedule or **Run now** started was claimed, `null` before any; every schedule counts from it, so a triggered run moves no schedule. */
	scheduledAt: number | null;
	/** Newest first, the last 10. */
	runs: RoutineRun[];
	/** Set on a template: the owner server copies it into each Workspace you start working in, as {@link copyOf}. */
	everyWorkspace?: true;
	/** On a copy: the id of the template it was copied from. Each copy is its own routine, which no edit of the template changes. */
	copyOf?: string;
}

/** A computer a routine runs on: Settings sync's stable id for it and its name as its owner sees it. */
export interface RoutineMachine {
	id: string;
	name: string;
}

export const isRoutineMachine = fields<RoutineMachine>({ id: isString, name: isString });

/** What the page edits of a routine: all but its runs, the times the server keeps, and the computer it runs on. */
export type RoutineSpec = Omit<Routine, "runs" | "createdAt" | "scheduledAt" | "machine">;

/** One edit of the routines; the page picks a new routine's `id`, so a save sent twice saves once. */
export type RoutineChange =
	| { op: "save"; routine: RoutineSpec }
	| { op: "remove"; id: string }
	| { op: "enable"; id: string; enabled: boolean }
	/** Claims a run now, whatever the schedule says. */
	| { op: "run-now"; id: string };

/** A routine's prompt: the longest one it saves, a command's included. */
export const MAX_PROMPT_LENGTH = 20_000;
/** A command routine's command: the longest one a routine saves, how long it may run while the Mac is awake, and how much of its output a run keeps. */
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

/** Whether `routine` runs on this computer: enabled, and not on another one. */
export const runsHere = (routine: Pick<Routine, "enabled" | "machine">): boolean => routine.enabled && routine.machine === null;

/** Missed slots coalesce into one run: a dashboard closed all weekend runs once on Monday. */
export const isDue = (routine: Routine, now: number): boolean =>
	runsHere(routine) && nextDueAt(routine.schedules, routine.scheduledAt ?? routine.createdAt) <= now;

/** Whether `routine` runs when a trigger of `kind` sees something happen. */
export const isTriggeredBy = (routine: Routine, kind: TriggerKind): boolean => runsHere(routine) && routine.triggers.some(trigger => trigger.kind === kind);

/**
 * Whether `routine`'s triggers fire on the local day of `now`: every day for a routine with no schedule or an interval
 * one, else only on a weekday its weekly schedules name, so a weekdays-only routine stays quiet on weekends.
 */
export const triggersOn = (routine: Routine, now: number): boolean => {
	if (routine.schedules.length === 0 || routine.schedules.some(schedule => schedule.kind === "every")) return true;
	const day = new Date(now).getDay() as Weekday;
	return routine.schedules.some(schedule => schedule.kind === "weekly" && schedule.days.includes(day));
};

/** The trigger kinds some enabled routine of `routines` runs on, so a check reads only what a routine watches. */
export const watchedKinds = (routines: readonly Routine[]): TriggerKind[] => TRIGGER_KINDS.filter(kind => routines.some(routine => isTriggeredBy(routine, kind)));

/** Whether `routine` already holds every field the page edits of `spec`. */
export function isSameSpec(routine: Routine, spec: RoutineSpec): boolean {
	return (
		routine.workspace === spec.workspace &&
		routine.name === spec.name &&
		routine.enabled === spec.enabled &&
		routine.everyWorkspace === spec.everyWorkspace &&
		routine.copyOf === spec.copyOf &&
		JSON.stringify([routine.launch ?? null, routine.schedules, routine.triggers, routine.task]) === JSON.stringify([spec.launch ?? null, spec.schedules, spec.triggers, spec.task])
	);
}

/**
 * `routines` after `change`, or `routines` itself when the change changes nothing. An edit keeps the routine's runs and
 * the computer it runs on; enabling a routine that runs on another computer moves it here, its schedules counting from now.
 */
export function applyRoutine(routines: Routine[], change: Exclude<RoutineChange, { op: "run-now" }>, now: number): Routine[] {
	switch (change.op) {
		case "save": {
			const index = routines.findIndex(routine => routine.id === change.routine.id);
			if (index === -1) return [...routines, { ...change.routine, machine: null, createdAt: now, scheduledAt: null, runs: [] }];
			const stored = routines[index]!;
			if (isSameSpec(stored, change.routine)) return routines;
			const machine = change.routine.enabled ? stored.machine : null;
			return routines.with(index, { ...change.routine, machine, createdAt: stored.createdAt, scheduledAt: stored.scheduledAt, runs: stored.runs });
		}
		case "remove": {
			const kept = routines.filter(routine => routine.id !== change.id);
			return kept.length === routines.length ? routines : kept;
		}
		case "enable": {
			const index = routines.findIndex(routine => routine.id === change.id);
			const routine = routines[index];
			if (routine === undefined || (routine.enabled === change.enabled && routine.machine === null)) return routines;
			return routines.with(index, { ...routine, enabled: change.enabled, machine: null, scheduledAt: routine.machine === null ? routine.scheduledAt : now });
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

/** Whether `entry`, a trigger or what one saw, names a kind routines no longer watch, which a saved routine or run drops. */
const isRetiredTrigger = (entry: unknown): boolean => isObject(entry) && typeof entry.kind === "string" && !isTriggerKind(entry.kind);

const isTriggerEvent = fields<TriggerEvent>({ kind: isTriggerKind, title: isString, detail: isString, url: nullable(isString) });

/** What started a run, as `routines.json` and a routine's message keep it, each event without other fields, or `null`. */
export function parseTriggeredBy(value: unknown): TriggerEvent[] | null {
	if (!Array.isArray(value)) return null;
	return parseAll(
		value.filter(event => !isRetiredTrigger(event)),
		event => (isTriggerEvent(event) ? { kind: event.kind, title: event.title, detail: event.detail, url: event.url } : null),
	);
}

/** A run's command as `routines.json` keeps it, or `null`. */
export function parseCommandRun(value: unknown): CommandRun | null {
	if (!isObject(value) || !isSafeInteger(value.startedAt)) return null;
	const { phase, startedAt, endedAt, output, slept } = value;
	if (phase === "running") return { phase, startedAt };
	if (!isSafeInteger(endedAt)) return null;
	const report = typeof output === "string" && (slept === undefined || (isSafeInteger(slept) && slept > 0));
	switch (phase) {
		case "exited":
			return report && typeof value.code === "number" && Number.isSafeInteger(value.code) ? { phase, code: value.code, output, startedAt, endedAt, slept } : null;
		case "stopped":
			return report && (value.reason === "time-limit" || value.reason === "dashboard") ? { phase, reason: value.reason, output, startedAt, endedAt, slept } : null;
		case "failed":
			return typeof value.error === "string" ? { phase, error: value.error, startedAt, endedAt } : null;
		default:
			return null;
	}
}

/** Each kind at most once. */
function parseTriggers(value: unknown): Parsed<Trigger[]> {
	if (!Array.isArray(value)) return null;
	const triggers: Trigger[] = [];
	for (const entry of value) {
		if (isRetiredTrigger(entry)) continue;
		if (!isObject(entry) || !isTriggerKind(entry.kind) || triggers.some(({ kind }) => kind === entry.kind)) return null;
		triggers.push({ kind: entry.kind });
	}
	return { ok: triggers };
}

const isPrompt = (value: unknown): value is string => isNonEmpty(value) && value.length <= MAX_PROMPT_LENGTH;

function parseRoutineTask(value: unknown): Parsed<RoutineTask> {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "prompt":
			return isPrompt(value.prompt) ? { ok: { kind: "prompt", prompt: value.prompt } } : null;
		case "command": {
			const { command, post, prompt } = value;
			if (!isNonEmpty(command) || command.length > MAX_COMMAND_LENGTH) return null;
			if ((post !== undefined && !isCommandPost(post)) || (prompt !== undefined && prompt !== "" && !isPrompt(prompt))) return null;
			return { ok: { kind: "command", command, ...(post === undefined ? {} : { post }), ...(isNonEmpty(prompt) ? { prompt } : {}) } };
		}
		default:
			return null;
	}
}

/**
 * A routine as the page saves it and `routines.json` keeps it, or `null` when a field is missing, of the wrong type, or
 * out of range, or when it has neither a schedule nor a trigger; other fields drop. Its Workspace is an absolute path.
 */
export function parseRoutineSpec(value: unknown): Parsed<RoutineSpec> {
	if (!isObject(value)) return null;
	const { id, name, enabled, workspace, everyWorkspace, copyOf } = value;
	const launch = parseLaunch(value.launch);
	const schedules = parseSchedules(value.schedules);
	const triggers = parseTriggers(value.triggers);
	const task = parseRoutineTask(value.task);
	if (!isNonEmpty(id) || !isNonEmpty(workspace) || !workspace.startsWith("/") || !isNonEmpty(name) || typeof enabled !== "boolean" || launch === null || !schedules || !triggers || !task) return null;
	if (schedules.ok.length === 0 && triggers.ok.length === 0) return null;
	if (!(everyWorkspace === undefined || typeof everyWorkspace === "boolean") || !(copyOf === undefined || isNonEmpty(copyOf))) return null;
	const spec: RoutineSpec = { id, workspace, name, schedules: schedules.ok, triggers: triggers.ok, task: task.ok, enabled };
	if (launch) spec.launch = launch;
	if (everyWorkspace) spec.everyWorkspace = true;
	if (copyOf !== undefined) spec.copyOf = copyOf;
	return { ok: spec };
}

/**
 * A routine `routines.json` or Settings sync keeps, as {@link parseRoutineSpec} reads it, or why it is dropped: it ran
 * only on triggers routines no longer watch, so it is left with neither a schedule nor a trigger.
 */
export function parseKeptRoutineSpec(value: Record<string, unknown>): Parsed<RoutineSpec> | { dropped: string } {
	const spec = parseRoutineSpec(value);
	if (spec) return spec;
	return Array.isArray(value.triggers) && value.triggers.some(isRetiredTrigger) ? { dropped: "ran only on triggers routines no longer watch" } : null;
}
