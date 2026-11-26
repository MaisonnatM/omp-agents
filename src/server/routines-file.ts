/**
 * The routines, kept in a file so that the next server knows which slots ran.
 * Every change saves at once: a queued run is on disk before the runner starts anything from it.
 * A routine whose task was pull requests or a project's prompt, or that ran only on triggers routines no longer watch, is dropped on load. The rest of the file stays.
 * A file from before `schedules`, before a run's `outcome`, before triggers, or from when each routine belonged to a Bot migrates here, so everything else sees the current shape.
 */
import { copyFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { ReducerFile } from "../fs";
import { isNonEmpty, isObject, isSafeInteger, isTexts, parseAll } from "../json";
import { absoluteDir, botsDir, botsFile, HOME } from "../paths";
import {
	applyRoutine,
	MAX_PROMPT_LENGTH,
	MAX_ROUTINE_RUNS,
	MAX_TRIGGER_EVENTS,
	isRoutineMachine,
	isRunUsage,
	parseCommandRun,
	parseKeptRoutineSpec,
	parseTriggeredBy,
	type CommandRun,
	type Routine,
	type RoutineChange,
	type RoutineOutcome,
	type RoutineRun,
	type RunUsage,
	type TriggerEvent,
} from "../routines";
import { modelOfSelector } from "../shared/models";
import { skillInvocation } from "../shared/transcript";
import type { BoardLaunch } from "../../templates/omp/agent/extensions/board/log";
import { BUILT_IN_ROUTINES } from "./built-in-routines";

/**
 * A run that has not posted or launched anything, as the file keeps it: `pending`, `queued` until a tick starts it. One
 * off the queue with `errors` failed; one without was sending, as a stopped server may have left it.
 */
const unstarted = (queued: boolean, errors: readonly string[]): RoutineOutcome => (queued ? { kind: "queued" } : errors.length > 0 ? { kind: "failed" } : { kind: "sending" });

const isTaskId = (value: unknown): value is number => isSafeInteger(value) && value > 0;

/**
 * A run's `outcome`, or the fields it had before: `queued` or `queue`, and `command`. A run that went into a session
 * rather than a Board task, as each did before routines posted to the Board, is `"dropped"`: it names no Board task.
 */
function parseRun(value: unknown): RoutineRun | "dropped" | null {
	if (!isObject(value) || !isSafeInteger(value.at) || !isTexts(value.errors)) return null;
	// A run from before triggers was started by a schedule or Run now.
	const triggeredBy = "triggeredBy" in value ? parseTriggeredBy(value.triggeredBy) : [];
	if (!triggeredBy) return null;
	const { errors } = value;
	if (isObject(value.outcome)) {
		const { outcome } = value;
		if (outcome.kind === "sent" || outcome.kind === "session") return "dropped";
		let parsed: RoutineOutcome | null = null;
		if (outcome.kind === "pending" && typeof outcome.queued === "boolean") parsed = unstarted(outcome.queued, errors);
		if (outcome.kind === "posted" && isTaskId(outcome.task)) parsed = { kind: "posted", task: outcome.task };
		if (outcome.kind === "command") {
			const run = parseCommandRun(outcome.run);
			if (run) parsed = isTaskId(outcome.task) ? { kind: "command", run, task: outcome.task } : { kind: "command", run };
		}
		if (!parsed) return null;
		const run: RoutineRun = { at: value.at, outcome: parsed, errors, triggeredBy };
		return isRunUsage(value.usage) ? { ...run, usage: { tokens: value.usage.tokens, cost: value.usage.cost } } : run;
	}
	const queued = "queued" in value ? value.queued : isTexts(value.queue) && value.queue.length > 0;
	if (typeof queued !== "boolean") return null;
	if (Array.isArray(value.started) && value.started.length > 0) return "dropped";
	const command = parseCommandRun(value.command);
	return { at: value.at, outcome: command ? { kind: "command", run: command } : unstarted(queued, errors), errors, triggeredBy };
}

/** `run` as the file keeps it: a run that has not started is `pending`. */
function runJson(run: RoutineRun): unknown {
	const { outcome } = run;
	switch (outcome.kind) {
		case "queued":
			return { ...run, outcome: { kind: "pending", queued: true } };
		case "sending":
		case "failed":
			return { ...run, outcome: { kind: "pending", queued: false } };
		default:
			return run;
	}
}

/** What a Bot held that its routines fold in as they move to its Workspace, as `bots.json` and its memory kept it. */
interface FormerBot {
	cwd: string;
	job: string;
	memory: string;
	launch: BoardLaunch | null;
}

/** Where the Bots were kept: `bots.json`, and the directory of each Bot's `memory.md`. */
export interface FormerBots {
	file: string;
	dir: string;
}

/** The Bots `bots.json` at `file` held, by id, each with its memory from `dir`; empty when the file is gone or unreadable. */
function readFormerBots({ file, dir }: FormerBots): Map<string, FormerBot> {
	const bots = new Map<string, FormerBot>();
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return bots;
	}
	if (!isObject(value) || !Array.isArray(value.bots)) return bots;
	for (const bot of value.bots) {
		if (!isObject(bot) || !isNonEmpty(bot.id) || !isNonEmpty(bot.cwd)) continue;
		let memory = "";
		try {
			memory = readFileSync(join(dir, bot.id, "memory.md"), "utf8").trim();
		} catch {}
		const model = typeof bot.model === "string" ? modelOfSelector(bot.model) : null;
		const skill = isNonEmpty(bot.skill) ? bot.skill : null;
		bots.set(bot.id, { cwd: absoluteDir(bot.cwd), job: typeof bot.job === "string" ? bot.job.trim() : "", memory, launch: model || skill ? { model, thinking: null, skill } : null });
	}
	return bots;
}

/** The sections a routine's prompt gains from its former Bot: its job, then its memory, each under its heading when not empty. */
function foldedPrompt(prompt: string, bot: FormerBot, name: string): string {
	const sections = [prompt.trim(), bot.job && `## Job\n${bot.job}`, bot.memory && `## Memory\n${bot.memory}`].filter(Boolean).join("\n\n");
	if (sections.length <= MAX_PROMPT_LENGTH) return sections;
	console.error(`omp-agents: cut routine "${name}"'s prompt, with its Bot's job and memory, to ${MAX_PROMPT_LENGTH} characters`);
	return sections.slice(0, MAX_PROMPT_LENGTH);
}

/** The task the dashboard ships for built-in routine `id`, which an older built-in routine takes as it moves; `undefined` for any other routine. */
const builtInTask = (id: unknown) => BUILT_IN_ROUTINES.find(routine => routine.id === id)?.task;

/**
 * A routine from when each routine belonged to a Bot, in the current shape: its Bot's workspace becomes its Workspace,
 * its Bot's model and skill its launch, and its Bot's job and memory follow its prompt, or a command's new prompt; a
 * built-in routine takes the task the dashboard ships instead. `null` when no Bot of that id is left.
 */
function adoptBotRoutine(value: Record<string, unknown>, bots: Map<string, FormerBot>): Record<string, unknown> | null {
	const bot = typeof value.botId === "string" ? bots.get(value.botId) : undefined;
	if (!bot) return null;
	const { botId: _botId, freshConversation: _fresh, ...rest } = value;
	const moved = { ...rest, workspace: bot.cwd, ...(bot.launch ? { launch: bot.launch } : {}) };
	const shipped = builtInTask(value.id);
	if (shipped) return { ...moved, task: shipped };
	const name = typeof value.name === "string" ? value.name : "unnamed";
	const task = isObject(value.task) ? value.task : {};
	const prompt = foldedPrompt(task.kind === "prompt" && typeof task.prompt === "string" ? task.prompt : "", bot, name);
	return { ...moved, task: { ...task, ...(prompt ? { prompt } : {}) } };
}

/**
 * A routine from before Bots, in the current shape: its own `cwd`, or the home directory, becomes its Workspace, and its
 * skill is folded into its prompt, so each run does what it did before; a built-in routine takes the task the dashboard ships.
 */
function adoptOwnWorkspace(value: Record<string, unknown>): Record<string, unknown> {
	const { cwd, skill, task, ...rest } = value;
	const workspace = absoluteDir(isNonEmpty(cwd) ? cwd : HOME);
	const shipped = builtInTask(value.id);
	if (shipped) return { ...rest, workspace, task: shipped };
	if (!isObject(task) || task.kind !== "prompt" || !isNonEmpty(skill) || typeof task.prompt !== "string") return { ...rest, task, workspace };
	return { ...rest, workspace, task: { kind: "prompt", prompt: skillInvocation(skill, task.prompt) } };
}

/** What a routine of each task kind routines no longer run did, by kind; such a routine is dropped on load. */
const DROPPED_TASKS = new Map([
	["pull-requests", "reviewed pull requests"],
	["project", "sent its prompt to a project"],
]);

function parseRoutine(value: unknown): Routine | { dropped: string } | null {
	const dropped = isObject(value) && isObject(value.task) && typeof value.task.kind === "string" ? DROPPED_TASKS.get(value.task.kind) : undefined;
	if (dropped) return { dropped };
	if (!isObject(value)) return null;
	const spec = parseKeptRoutineSpec({ ...value, schedules: "schedules" in value ? value.schedules : [value.schedule], triggers: "triggers" in value ? value.triggers : [] });
	if (!spec || "dropped" in spec) return spec;
	const { createdAt } = value;
	const parsedRuns = parseAll(value.runs, parseRun);
	// Before Settings sync carried routines, every routine ran on this computer.
	const machine = value.machine ?? null;
	if (typeof createdAt !== "number" || !parsedRuns || !(machine === null || isRoutineMachine(machine))) return null;
	const runs = parsedRuns.filter((run): run is RoutineRun => run !== "dropped");
	const scheduledAt = "scheduledAt" in value ? value.scheduledAt : Array.isArray(value.runs) && isObject(value.runs[0]) ? value.runs[0].at : null;
	return scheduledAt === null || isSafeInteger(scheduledAt) ? { ...spec.ok, machine: spec.ok.enabled ? machine : null, createdAt, scheduledAt, runs } : null;
}

/**
 * What `routines.json` held: its routines, whether any was in an older shape, which {@link RoutinesFile.migrate} saves,
 * and the names of those that moved but did not parse after, which keep the file and `bots.json` as they are.
 */
interface ReadRoutines {
	routines: Routine[];
	moved: boolean;
	unmoved: string[];
}

function parseRoutines(value: unknown, formerBots: FormerBots): ReadRoutines | null {
	if (!isObject(value) || !Array.isArray(value.routines)) return null;
	let bots: Map<string, FormerBot> | null = null;
	const read: ReadRoutines = { routines: [], moved: false, unmoved: [] };
	for (const entry of value.routines) {
		let current: unknown = entry;
		const name = isObject(entry) && typeof entry.name === "string" && entry.name ? entry.name : "unnamed";
		const moves = isObject(entry) && !("workspace" in entry);
		if (moves) {
			read.moved = true;
			if ("botId" in entry) {
				bots ??= readFormerBots(formerBots);
				current = adoptBotRoutine(entry, bots);
				if (current === null) {
					console.error(`omp-agents: dropped routine "${name}", whose Bot ${String(entry.botId)} is gone`);
					continue;
				}
			} else current = adoptOwnWorkspace(entry);
		}
		const routine = parseRoutine(current);
		if (routine === null) {
			if (!moves) return null;
			console.error(`omp-agents: routine "${name}" could not move to its Workspace, so routines.json and bots.json stay as they are`);
			read.unmoved.push(name);
			continue;
		}
		if ("dropped" in routine) {
			console.error(`omp-agents: dropped routine "${name}", which ${routine.dropped}`);
			continue;
		}
		read.routines.push(routine);
	}
	return read;
}

/** `path`, or, when that is taken, `path` with `-` and the time, so a rename keeps every earlier file. */
const freePath = (path: string): string => (existsSync(path) ? `${path}-${Date.now()}` : path);

export class RoutinesFile extends ReducerFile<Routine[], [change: Exclude<RoutineChange, { op: "run-now" }>, now: number]> {
	readonly #path: string;
	readonly #formerBots: FormerBots;

	constructor(path: string, formerBots: FormerBots = { file: botsFile, dir: botsDir }) {
		super(path, {
			parse: value => parseRoutines(value, formerBots)?.routines ?? null,
			toJson: routines => ({ routines: routines.map(routine => ({ ...routine, runs: routine.runs.map(runJson) })) }),
			holds: "a list of routines",
			empty: [],
			reduce: applyRoutine,
		});
		this.#path = path;
		this.#formerBots = formerBots;
	}

	/**
	 * Saves a file in an older shape in the current one, after copying it to `routines.json.before-board`, then renames
	 * `bots.json` to `bots.json.migrated`, so its Bots fold in once. A routine that moved but did not parse keeps both
	 * files as they are. A file in the current shape with no `bots.json` changes nothing, so a second call does nothing,
	 * and a crash before the save migrates the same way on the next call.
	 */
	migrate(): void {
		let json: unknown = null;
		try {
			json = JSON.parse(readFileSync(this.#path, "utf8"));
		} catch {}
		const read = parseRoutines(json, this.#formerBots);
		if (read?.moved) {
			const before = `${this.#path}.before-board`;
			if (!existsSync(before)) copyFileSync(this.#path, before);
			if (read.unmoved.length > 0) return;
			this.replace(read.routines);
		}
		const { file } = this.#formerBots;
		if (existsSync(file)) renameSync(file, freePath(`${file}.migrated`));
	}

/**
	 * Claims a run of routine `id` at `at`, queued, keeping the newest {@link MAX_ROUTINE_RUNS} runs. A run with no
	 * `triggeredBy` is a schedule's or Run now's, which the schedules count from.
	 */
	claim(id: string, at: number, triggeredBy: TriggerEvent[]): void {
		this.#updateRoutine(id, routine => ({
			...routine,
			scheduledAt: triggeredBy.length === 0 ? at : routine.scheduledAt,
			runs: [{ at, outcome: { kind: "queued" }, errors: [], triggeredBy } satisfies RoutineRun, ...routine.runs].slice(0, MAX_ROUTINE_RUNS),
		}));
	}

	/** Adds `events` to what started the run at `at`, keeping the first {@link MAX_TRIGGER_EVENTS}. */
	addTriggerEvents(id: string, at: number, events: TriggerEvent[]): void {
		this.#updateRun(id, at, run => ({ ...run, triggeredBy: [...run.triggeredBy, ...events].slice(0, MAX_TRIGGER_EVENTS) }));
	}

	/** Takes routine `id`'s run at `at` off the queue as it posts, saved before the post goes. */
	sending(id: string, at: number): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "sending" } }));
	}

	/** Records the Board task the run at `at` posted, or replied on: a command run's report keeps its command. */
	posted(id: string, at: number, task: number): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: run.outcome.kind === "command" ? { ...run.outcome, task } : { kind: "posted", task } }));
	}

	/** Records what the session on the run's Board task spent on the run at `at`. */
	usage(id: string, at: number, usage: RunUsage): void {
		this.#updateRun(id, at, run => ({ ...run, usage }));
	}

	/** Records the command of the run at `at` as it launches and again as it ends. */
	command(id: string, at: number, command: CommandRun): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "command", run: command } }));
	}

	/**
	 * Records why the run at `at` could not start or post something, which fails a run that had not started; the same
	 * error twice in a row records once, so a retry each tick does not pile up.
	 */
	failed(id: string, at: number, error: string): void {
		if (this.#run(id, at)?.errors.at(-1) === error) return;
		this.#updateRun(id, at, run => ({
			...run,
			outcome: run.outcome.kind === "queued" || run.outcome.kind === "sending" ? { kind: "failed" } : run.outcome,
			errors: [...run.errors, error],
		}));
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
