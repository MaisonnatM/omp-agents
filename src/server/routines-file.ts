/**
 * The routines, kept in a file so that the next server knows which slots ran and which pull request heads a session took.
 * Every change saves at once: a run's queue is on disk before the runner starts anything from it.
 */
import { JsonFile } from "../fs";
import { isObject } from "../json";
import { applyRoutine, MAX_ROUTINE_RUNS } from "../routines";
import type { Routine, RoutineChange, RoutineRun } from "../shared";
import { parseRoutineSpec } from "./wire";

interface Stored {
	routines: Routine[];
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

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

function parseStarted(value: unknown): RoutineRun["started"][number] | null {
	if (!isObject(value)) return null;
	const { label, instanceId, sessionId } = value;
	return typeof label === "string" && typeof instanceId === "string" && typeof sessionId === "string" ? { label, instanceId, sessionId } : null;
}

function parseRun(value: unknown): RoutineRun | null {
	if (!isObject(value)) return null;
	const { at, queue, errors } = value;
	const started = parseAll(value.started, parseStarted);
	return typeof at === "number" && isStrings(queue) && isStrings(errors) && started ? { at, queue, started, errors } : null;
}

function parseDone(value: unknown): Record<string, string> | null {
	if (!isObject(value)) return null;
	const done: Record<string, string> = {};
	for (const [key, head] of Object.entries(value)) {
		if (typeof head !== "string") return null;
		done[key] = head;
	}
	return done;
}

function parseRoutine(value: unknown): Routine | null {
	const spec = parseRoutineSpec(value);
	if (!spec || !isObject(value)) return null;
	const { createdAt } = value;
	const runs = parseAll(value.runs, parseRun);
	const done = parseDone(value.done);
	return typeof createdAt === "number" && runs && done ? { ...spec, createdAt, runs, done } : null;
}

function parseStored(value: unknown): Stored | null {
	if (!isObject(value)) return null;
	const routines = parseAll(value.routines, parseRoutine);
	return routines && { routines };
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

	/** Applies `change` at time `now` and saves; whether it changed anything. */
	apply(change: Exclude<RoutineChange, { op: "run-now" }>, now: number): boolean {
		const next = applyRoutine(this.#routines, change, now);
		if (next === this.#routines) return false;
		this.#routines = next;
		this.#save();
		return true;
	}

	/**
	 * Claims routine `id`'s slot at `at` with `queue` to start, keeping the newest {@link MAX_ROUTINE_RUNS} runs.
	 * `present` names the pull requests in the inbox now, and `done` forgets the others; `null` keeps it as it is.
	 */
	claim(id: string, at: number, queue: string[], present: string[] | null): void {
		this.#update(id, routine => {
			const keep = present && new Set(present);
			return {
				...routine,
				runs: [{ at, queue, started: [], errors: [] }, ...routine.runs].slice(0, MAX_ROUTINE_RUNS),
				done: keep ? Object.fromEntries(Object.entries(routine.done).filter(([key]) => keep.has(key))) : routine.done,
			};
		});
	}

	/** Takes the next key off the queue of routine `id`'s run at `at`; `null` when that run is gone or its queue is empty. */
	pop(id: string, at: number): string | null {
		const key = this.#run(id, at)?.queue[0];
		if (key === undefined) return null;
		this.#updateRun(id, at, run => ({ ...run, queue: run.queue.slice(1) }));
		return key;
	}

	/** Records a session that the run at `at` started. */
	started(id: string, at: number, session: RoutineRun["started"][number]): void {
		this.#updateRun(id, at, run => ({ ...run, started: [...run.started, session] }));
	}

	/** Records why the run at `at` could not start something; the same error twice in a row records once, so a retry each tick does not pile up. */
	failed(id: string, at: number, error: string): void {
		if (this.#run(id, at)?.errors.at(-1) === error) return;
		this.#updateRun(id, at, run => ({ ...run, errors: [...run.errors, error] }));
	}

	/** Records that a session took pull request `key` at head commit `headOid`. */
	done(id: string, key: string, headOid: string): void {
		this.#update(id, routine => ({ ...routine, done: { ...routine.done, [key]: headOid } }));
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
