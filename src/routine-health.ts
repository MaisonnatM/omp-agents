/**
 * The routines' daily heartbeat: which recent runs errored. A run errored when it hit an error, its command failed, or
 * a provider's error ended the turn of the session on its Board task.
 */
import { exitedWith, type Routine, type RoutineRun, type RunUsage } from "./routines";
import { DAY_MS } from "./shared/days";

/** How far back each heartbeat looks: one day, as it runs once a day. */
export const HEALTH_WINDOW_MS = DAY_MS;
/** A run younger than this may still be under way, so the next heartbeat judges it. */
export const SETTLE_MS = 30 * 60_000;

/** A run that errored, named as the notice lists it; `at` is the run's key. */
export interface ErroredRun {
	/** The routine's Workspace, whose Routines tab lists it. */
	workspace: string;
	routineId: string;
	name: string;
	at: number;
}

/**
 * The turn the session on a run's Board task took on it, as the Board and its session file hold it: whether the session
 * marked the Board task done, quietly or not, or ended on a provider's error, and how long it took.
 */
export interface RunTurn {
	replied: boolean;
	quiet: boolean;
	failed: boolean;
	ms: number;
	/** What the turn spent. */
	usage: RunUsage;
}

/** The turn the session on Board task `task` took on the run at `at`, or `null` while it has not ended or is not found. */
export type TurnOf = (task: number, at: number) => RunTurn | null;

/**
 * Whether `run` failed in itself: an error, a command that did not exit 0, or a session's turn a provider's error ended.
 * A command whose routine posts only its failures posts its output by exiting non-zero, so that exit is no error.
 */
function errored(routine: Routine, run: RoutineRun, turnOf: TurnOf): boolean {
	const { outcome } = run;
	const code = outcome.kind === "command" && outcome.run.phase === "exited" ? outcome.run.code : 0;
	const handOff = code !== 0 && routine.task.kind === "command" && routine.task.post === "failures" ? exitedWith(code) : null;
	if (run.errors.some(error => error !== handOff) || outcome.kind === "failed") return true;
	if (outcome.kind === "command") return outcome.run.phase === "stopped" || outcome.run.phase === "failed" || (code !== 0 && handOff === null);
	return outcome.kind === "posted" && (turnOf(outcome.task, run.at)?.failed ?? false);
}

/**
 * Every run of `routines` that errored among those claimed from {@link HEALTH_WINDOW_MS} before the last
 * {@link SETTLE_MS} up to it, oldest first, so two heartbeats a day apart judge each run once. `turnOf` finds a posted
 * run's turn.
 */
export function erroredRuns(routines: readonly Routine[], now: number, turnOf: TurnOf): ErroredRun[] {
	const to = now - SETTLE_MS;
	const from = to - HEALTH_WINDOW_MS;
	return routines
		.flatMap(routine =>
			routine.runs
				.filter(run => run.at >= from && run.at < to && errored(routine, run, turnOf))
				.map(({ at }) => ({ workspace: routine.workspace, routineId: routine.id, name: routine.name, at })),
		)
		.toSorted((a, b) => a.at - b.at);
}
