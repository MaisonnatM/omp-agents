/**
 * The routines, kept in a file so that the next server knows which slots ran.
 * Every change saves at once: a queued run is on disk before the runner starts anything from it.
 * A routine whose task was pull requests or a project's prompt is dropped on load. The rest of the file stays.
 * A file from before `schedules`, before a run's `outcome`, before every routine had a Bot, or before triggers migrates here, so everything else sees the current shape.
 */
import { resolve } from "node:path";
import { ReducerFile } from "../fs";
import { fields, isNonEmpty, isObject, isSafeInteger, isString, isTexts, nullable, parseAll } from "../json";
import { expandHome, HOME } from "../paths";
import {
	applyRoutine,
	isTriggerKind,
	MAX_ROUTINE_RUNS,
	parseRoutineSpec,
	type CommandRun,
	type Routine,
	type RoutineChange,
	type RoutineOutcome,
	type RoutineRun,
	type TriggerEvent,
} from "../routines";
import { type BotId, type BotSpec, defaultLook } from "../shared/bots";

/** The Bot the routines from before Bots move to; page Bots have random UUIDs, so none takes this id. */
export const ROUTINES_BOT_ID = "routines" as BotId;

/** The Bot {@link RoutinesFile.migrate} creates for the routines that had none, working in `cwd`. */
export const routinesBot = (cwd: string): BotSpec => ({
	id: ROUTINES_BOT_ID,
	name: "Routines",
	job: "Run the routines that moved here from the Routines page.\nDo what each routine's message asks without asking questions, and answer briefly.\nIf something blocks you, say what and stop.",
	cwd,
	model: null,
	skill: null,
	...defaultLook(ROUTINES_BOT_ID),
});

/** A session a run recorded before `outcome`, which also held its `label`. */
function parseStarted(value: unknown): { instanceId: string; sessionId: string } | null {
	if (!isObject(value)) return null;
	const { instanceId, sessionId } = value;
	return typeof instanceId === "string" && typeof sessionId === "string" ? { instanceId, sessionId } : null;
}

function parseCommandRun(value: unknown): CommandRun | null {
	if (!isObject(value) || !isSafeInteger(value.startedAt)) return null;
	const { phase, startedAt, endedAt, output } = value;
	if (phase === "running") return { phase, startedAt };
	if (!isSafeInteger(endedAt)) return null;
	switch (phase) {
		case "exited":
			return typeof value.code === "number" && Number.isSafeInteger(value.code) && typeof output === "string" ? { phase, code: value.code, output, startedAt, endedAt } : null;
		case "stopped":
			return (value.reason === "time-limit" || value.reason === "dashboard") && typeof output === "string" ? { phase, reason: value.reason, output, startedAt, endedAt } : null;
		case "failed":
			return typeof value.error === "string" ? { phase, error: value.error, startedAt, endedAt } : null;
		default:
			return null;
	}
}

const isTriggerEvent = fields<TriggerEvent>({ kind: isTriggerKind, title: isString, detail: isString, url: nullable(isString) });

function parseTriggerEvent(value: unknown): TriggerEvent | null {
	return isTriggerEvent(value) ? { kind: value.kind, title: value.title, detail: value.detail, url: value.url } : null;
}

/**
 * A run's `outcome`, or the fields it had before: `queued` or `queue`, `started` sessions, and `command`. Of several sessions, only a pull request routine's run started more than one, and the first stays.
 * A run from before every routine had a Bot that started a session or messaged a Bot sent its prompt into that session.
 */
function parseRun(value: unknown): RoutineRun | null {
	if (!isObject(value) || !isSafeInteger(value.at) || !isTexts(value.errors)) return null;
	// A run from before triggers was started by a schedule or Run now.
	const triggeredBy = "triggeredBy" in value ? parseAll(value.triggeredBy, parseTriggerEvent) : [];
	if (!triggeredBy) return null;
	if (isObject(value.outcome)) {
		const { outcome } = value;
		let parsed: RoutineOutcome | null = null;
		if (outcome.kind === "pending" && typeof outcome.queued === "boolean") parsed = { kind: "pending", queued: outcome.queued };
		if ((outcome.kind === "sent" || outcome.kind === "session" || outcome.kind === "bot") && typeof outcome.sessionId === "string") parsed = { kind: "sent", sessionId: outcome.sessionId };
		if (outcome.kind === "command") {
			const run = parseCommandRun(outcome.run);
			if (run) parsed = { kind: "command", run };
		}
		return parsed ? { at: value.at, outcome: parsed, errors: value.errors, triggeredBy } : null;
	}
	const queued = "queued" in value ? value.queued : isTexts(value.queue) && value.queue.length > 0;
	const started = parseAll(value.started, parseStarted);
	if (typeof queued !== "boolean" || !started) return null;
	const command = parseCommandRun(value.command);
	const outcome: RoutineOutcome = command ? { kind: "command", run: command } : started.length > 0 ? { kind: "sent", sessionId: started[0]!.sessionId } : { kind: "pending", queued };
	return { at: value.at, outcome, errors: value.errors, triggeredBy };
}

/** What a parse of a file from before every routine had a Bot found: whether a routine moved to a Bot, and the workspace of the Routines Bot when one moved there. */
interface Migration {
	moved: boolean;
	workspace: string | null;
}

/** `text` as one shell word. */
const shellWord = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * A routine from before every routine had a Bot, in the current shape: one that messaged a Bot belongs to it, and the
 * rest to the Routines Bot working in `workspace`, with their own workspace and skill folded into the task, so each run
 * does what it did before. `toRoutinesBot` says whether the routine went to the Routines Bot.
 */
function adoptLegacy(value: Record<string, unknown>, workspace: string): { fields: Record<string, unknown>; toRoutinesBot: boolean } {
	const { task, skill } = value;
	const elsewhere = typeof value.cwd === "string" && value.cwd !== workspace ? value.cwd : null;
	if (!isObject(task)) return { fields: value, toRoutinesBot: false };
	switch (task.kind) {
		case "bot":
			return { fields: { ...value, botId: task.botId, task: { kind: "prompt", prompt: task.prompt } }, toRoutinesBot: false };
		case "command": {
			const command = elsewhere !== null && typeof task.command === "string" ? `cd ${shellWord(resolve(HOME, expandHome(elsewhere.trim())))} && ${task.command}` : task.command;
			return { fields: { ...value, botId: ROUTINES_BOT_ID, task: { kind: "command", command } }, toRoutinesBot: true };
		}
		case "prompt": {
			const text = elsewhere !== null && typeof task.prompt === "string" ? `Work in ${elsewhere}.\n\n${task.prompt}` : task.prompt;
			const prompt = isNonEmpty(skill) && typeof text === "string" ? `/skill:${skill} ${text}` : text;
			return { fields: { ...value, botId: ROUTINES_BOT_ID, task: { kind: "prompt", prompt } }, toRoutinesBot: true };
		}
		default:
			return { fields: value, toRoutinesBot: false };
	}
}

/** Whether `entry` is a routine from before every routine had a Bot. */
const isLegacy = (entry: unknown): entry is Record<string, unknown> => isObject(entry) && !("botId" in entry);

/** What a routine of each task kind routines no longer run did, by kind; such a routine is dropped on load. */
const DROPPED_TASKS = new Map([
	["pull-requests", "reviewed pull requests"],
	["project", "sent its prompt to a project"],
]);

function parseRoutine(value: unknown): Routine | { dropped: string } | null {
	const dropped = isObject(value) && isObject(value.task) && typeof value.task.kind === "string" ? DROPPED_TASKS.get(value.task.kind) : undefined;
	if (dropped) return { dropped };
	if (!isObject(value)) return null;
	const spec = parseRoutineSpec({ ...value, schedules: "schedules" in value ? value.schedules : [value.schedule], triggers: "triggers" in value ? value.triggers : [] });
	if (!spec) return null;
	const { createdAt } = value;
	const runs = parseAll(value.runs, parseRun);
	if (typeof createdAt !== "number" || !runs) return null;
	// Before triggers, every run was a schedule's or Run now's, and the schedules counted from the newest.
	const scheduledAt = "scheduledAt" in value ? value.scheduledAt : (runs[0]?.at ?? null);
	return scheduledAt === null || isSafeInteger(scheduledAt) ? { ...spec.ok, createdAt, scheduledAt, runs } : null;
}

/** `routines.json`'s list, recording in `migration` what moved from the shape before every routine had a Bot. */
function parseRoutines(value: unknown, migration: Migration): Routine[] | null {
	migration.moved = false;
	migration.workspace = null;
	if (!isObject(value) || !Array.isArray(value.routines)) return null;
	const firstCwd = value.routines.find((entry): entry is Record<string, unknown> => isLegacy(entry) && isNonEmpty(entry.cwd) && !(isObject(entry.task) && entry.task.kind === "bot"))?.cwd;
	const workspace = typeof firstCwd === "string" ? firstCwd : HOME;
	const routines: Routine[] = [];
	for (const entry of value.routines) {
		let current: unknown = entry;
		if (isLegacy(entry)) {
			const { fields, toRoutinesBot } = adoptLegacy(entry, workspace);
			current = fields;
			migration.moved = true;
			if (toRoutinesBot) migration.workspace = workspace;
		}
		const routine = parseRoutine(current);
		if (routine === null) return null;
		if ("dropped" in routine) {
			const name = isObject(entry) && typeof entry.name === "string" && entry.name ? entry.name : "unnamed";
			console.error(`omp-agents: dropped routine "${name}", which ${routine.dropped}`);
			continue;
		}
		routines.push(routine);
	}
	return routines;
}

export class RoutinesFile extends ReducerFile<Routine[], [change: Exclude<RoutineChange, { op: "run-now" }>, now: number]> {
	/** What the last read of the file found to migrate, until {@link migrate} saves it. */
	readonly #migration: Migration;

	constructor(path: string) {
		const migration: Migration = { moved: false, workspace: null };
		super(path, { parse: value => parseRoutines(value, migration), toJson: routines => ({ routines }), holds: "a list of routines", empty: [], reduce: applyRoutine });
		this.#migration = migration;
	}

	/**
	 * Saves a file read in the shape from before every routine had a Bot in the current one. When a routine moved to the
	 * Routines Bot, `adopt` first gets that Bot, to create unless it exists. A file read in the current shape changes
	 * nothing, so a second call does nothing, and a crash before the save migrates the same way on the next read.
	 */
	migrate(adopt: (bot: BotSpec) => void): void {
		const { moved, workspace } = this.#migration;
		if (!moved) return;
		if (workspace !== null) adopt(routinesBot(workspace));
		this.#migration.moved = false;
		this.#migration.workspace = null;
		this.replace([...this.value]);
	}

	/** Deletes Bot `botId`'s routines, as deleting the Bot does; whether it deleted any. */
	removeBot(botId: BotId): boolean {
		return this.update(routines => {
			const kept = routines.filter(routine => routine.botId !== botId);
			return kept.length === routines.length ? routines : kept;
		});
	}

	/**
	 * Claims a run of routine `id` at `at`, queued, keeping the newest {@link MAX_ROUTINE_RUNS} runs. A run with no
	 * `triggeredBy` is a schedule's or Run now's, which the schedules count from.
	 */
	claim(id: string, at: number, triggeredBy: TriggerEvent[]): void {
		this.#updateRoutine(id, routine => ({
			...routine,
			scheduledAt: triggeredBy.length === 0 ? at : routine.scheduledAt,
			runs: [{ at, outcome: { kind: "pending", queued: true }, errors: [], triggeredBy } satisfies RoutineRun, ...routine.runs].slice(0, MAX_ROUTINE_RUNS),
		}));
	}

	/** Takes routine `id`'s run at `at` off the queue, saved before its message or command starts. */
	dequeue(id: string, at: number): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "pending", queued: false } }));
	}

	/** Records the Bot conversation the run at `at` sent its prompt into. */
	sent(id: string, at: number, sessionId: string): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "sent", sessionId } }));
	}

	/** Records the command of the run at `at` as it launches and again as it ends. */
	command(id: string, at: number, command: CommandRun): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "command", run: command } }));
	}

	/** Records why the run at `at` could not start something; the same error twice in a row records once, so a retry each tick does not pile up. */
	failed(id: string, at: number, error: string): void {
		if (this.#run(id, at)?.errors.at(-1) === error) return;
		this.#updateRun(id, at, run => ({ ...run, errors: [...run.errors, error] }));
	}

	#run(id: string, at: number): RoutineRun | undefined {
		return this.value.find(routine => routine.id === id)?.runs.find(run => run.at === at);
	}

	#updateRun(id: string, at: number, next: (run: RoutineRun) => RoutineRun): void {
		this.#updateRoutine(id, routine => ({ ...routine, runs: routine.runs.map(run => (run.at === at ? next(run) : run)) }));
	}

	/** Passes routine `id` through `next` and saves; a routine that is gone stays gone. */
	#updateRoutine(id: string, next: (routine: Routine) => Routine): void {
		this.update(routines => {
			const index = routines.findIndex(routine => routine.id === id);
			return index === -1 ? routines : routines.with(index, next(routines[index]!));
		});
	}
}
