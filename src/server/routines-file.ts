/**
 * The routines, kept in a file so that the next server knows which slots ran.
 * Every change saves at once: a queued run is on disk before the runner starts anything from it.
 * A routine whose task was pull requests is dropped on load. The rest of the file stays.
 * A file from before `schedules`, before a run's `outcome`, or before a prompt task's `pin` migrates here, so everything else sees the current shape.
 */
import { JsonFile } from "../fs";
import { isObject, isTexts } from "../json";
import { applyRoutine, MAX_ROUTINE_RUNS, type CommandRun, type Routine, type RoutineChange, type RoutineOutcome, type RoutineRun } from "../routines";
import { parseRoutineSpec } from "./wire";

interface Stored {
	routines: Routine[];
}

/** Every entry of `values` through `parse`, or `null` when `values` is no array or one entry does not parse. */
function parseAll<T>(values: unknown, parse: (value: unknown) => T | null): T[] | null {
	if (!Array.isArray(values)) return null;
	const parsed: T[] = [];
	for (const value of values) {
		const entry = parse(value);
		if (entry === null) return null;
		parsed.push(entry);
	}
	return parsed;
}

/** A session a run recorded before `outcome`, which also held its `label`. */
function parseStarted(value: unknown): { instanceId: string; sessionId: string } | null {
	if (!isObject(value)) return null;
	const { instanceId, sessionId } = value;
	return typeof instanceId === "string" && typeof sessionId === "string" ? { instanceId, sessionId } : null;
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseCommandRun(value: unknown): CommandRun | null {
	if (!isObject(value) || !isTime(value.startedAt)) return null;
	const { phase, startedAt, endedAt, output } = value;
	if (phase === "running") return { phase, startedAt };
	if (!isTime(endedAt)) return null;
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

/** A run's `outcome`, or the fields it had before: `queued` or `queue`, `started` sessions, and `command`. Of several sessions, only a pull request routine's run started more than one, and the first stays. */
function parseRun(value: unknown): RoutineRun | null {
	if (!isObject(value) || !isTime(value.at) || !isTexts(value.errors)) return null;
	if (isObject(value.outcome)) {
		const { outcome } = value;
		let parsed: RoutineOutcome | null = null;
		if (outcome.kind === "pending" && typeof outcome.queued === "boolean") parsed = { kind: "pending", queued: outcome.queued };
		if (outcome.kind === "session" && typeof outcome.instanceId === "string" && typeof outcome.sessionId === "string") parsed = { kind: "session", instanceId: outcome.instanceId, sessionId: outcome.sessionId };
		if (outcome.kind === "command") {
			const run = parseCommandRun(outcome.run);
			if (run) parsed = { kind: "command", run };
		}
		return parsed ? { at: value.at, outcome: parsed, errors: value.errors } : null;
	}
	const queued = "queued" in value ? value.queued : isTexts(value.queue) && value.queue.length > 0;
	const started = parseAll(value.started, parseStarted);
	if (typeof queued !== "boolean" || !started) return null;
	const command = parseCommandRun(value.command);
	const outcome: RoutineOutcome = command ? { kind: "command", run: command }
		: started.length > 0 ? { kind: "session", instanceId: started[0]!.instanceId, sessionId: started[0]!.sessionId }
		: { kind: "pending", queued };
	return { at: value.at, outcome, errors: value.errors };
}

const isPullRequestRoutine = (value: unknown): boolean => isObject(value) && isObject(value.task) && value.task.kind === "pull-requests";

function parseRoutine(value: unknown): Routine | "drop" | null {
	if (isPullRequestRoutine(value)) return "drop";
	if (!isObject(value)) return null;
	const { task } = value;
	const spec = parseRoutineSpec({
		...value,
		schedules: "schedules" in value ? value.schedules : [value.schedule],
		task: isObject(task) && task.kind === "prompt" && !("pin" in task) ? { ...task, pin: false } : task,
	});
	if (!spec) return null;
	const { createdAt } = value;
	const runs = parseAll(value.runs, parseRun);
	return typeof createdAt === "number" && runs ? { ...spec.ok, createdAt, runs } : null;
}

function parseStored(value: unknown): Stored | null {
	if (!isObject(value) || !Array.isArray(value.routines)) return null;
	const routines: Routine[] = [];
	for (const entry of value.routines) {
		const routine = parseRoutine(entry);
		if (routine === null) return null;
		if (routine === "drop") {
			const name = isObject(entry) && typeof entry.name === "string" && entry.name ? entry.name : "unnamed";
			console.error(`omp-agents: dropped routine "${name}", which reviewed pull requests`);
			continue;
		}
		routines.push(routine);
	}
	return { routines };
}

export class RoutinesFile {
	readonly #file: JsonFile<Stored>;
	#routines: Routine[];

	constructor(path: string) {
		// The file holds routines someone wrote, so a file that is not one moves aside rather than being written over.
		this.#file = new JsonFile(path, { parse: parseStored, holds: "a list of routines", onInvalid: "aside", indent: "\t" });
		this.#routines = this.#file.load()?.routines ?? [];
	}

	get routines(): Routine[] {
		return this.#routines;
	}

	/** Reads the file again, for a server that takes over from one that kept saving since this one started. */
	reload(): void {
		this.#routines = this.#file.load()?.routines ?? this.#routines;
	}

	/** Applies `change` at time `now` and saves; whether it changed anything. */
	apply(change: Exclude<RoutineChange, { op: "run-now" }>, now: number): boolean {
		const next = applyRoutine(this.#routines, change, now);
		if (next === this.#routines) return false;
		this.#routines = next;
		this.#save();
		return true;
	}

	/** Claims routine `id`'s slot at `at`, queued, keeping the newest {@link MAX_ROUTINE_RUNS} runs. */
	claim(id: string, at: number): void {
		this.#update(id, routine => ({
			...routine,
			runs: [{ at, outcome: { kind: "pending", queued: true }, errors: [] } satisfies RoutineRun, ...routine.runs].slice(0, MAX_ROUTINE_RUNS),
		}));
	}

	/** Takes routine `id`'s run at `at` off the queue, saved before its session or command starts. */
	dequeue(id: string, at: number): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "pending", queued: false } }));
	}

	/** Records the sole session the run at `at` started. */
	started(id: string, at: number, session: { instanceId: string; sessionId: string }): void {
		this.#updateRun(id, at, run => ({ ...run, outcome: { kind: "session", ...session } }));
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
		return this.#routines.find(routine => routine.id === id)?.runs.find(run => run.at === at);
	}

	#updateRun(id: string, at: number, next: (run: RoutineRun) => RoutineRun): void {
		this.#update(id, routine => ({ ...routine, runs: routine.runs.map(run => (run.at === at ? next(run) : run)) }));
	}

	/** Passes routine `id` through `next` and saves; a routine that is gone stays gone. */
	#update(id: string, next: (routine: Routine) => Routine): void {
		const index = this.#routines.findIndex(routine => routine.id === id);
		if (index === -1) return;
		this.#routines = this.#routines.with(index, next(this.#routines[index]!));
		this.#save();
	}

	#save(): void {
		this.#file.save({ routines: this.#routines });
	}
}
