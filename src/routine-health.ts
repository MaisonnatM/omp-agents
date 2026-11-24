/**
 * The routines' daily heartbeat: which recent runs exited early. A run errored, its Bot's turn ended with no reply, it
 * ended far shorter than the routine's usual run, or it missed its schedule.
 */
import { nextDueAt, type Routine, type RoutineRun, type RunUsage, runsHere } from "./routines";
import type { BotId } from "./shared/bots";
import { DAY_MS } from "./shared/days";

/** How far back each heartbeat looks: one day, as it runs once a day. */
export const HEALTH_WINDOW_MS = DAY_MS;
/** A run younger than this may still be under way, so the next heartbeat judges it. */
export const SETTLE_MS = 30 * 60_000;
/** A slot claimed, or still unclaimed, this long after it came due missed its schedule. */
export const LATE_AFTER_MS = 60 * 60_000;
/** A run that took less than this share of its routine's usual time ended far shorter than usual. */
export const SHORT_SHARE = 0.25;
/** The other timed runs a routine needs before its usual time counts. */
export const MIN_USUAL_RUNS = 3;

export const EARLY_EXITS = ["errored", "no-reply", "short", "missed"] as const;
/** Why a run exited early. */
export type EarlyExit = (typeof EARLY_EXITS)[number];

/** A run that exited early, named as the notice lists it; `at` is the run's key, or the slot a routine has not run yet. */
export interface EarlyRun {
	botId: BotId;
	routineId: string;
	name: string;
	at: number;
	exit: EarlyExit;
}

/**
 * The Bot's turn that answered a prompt run, as its session file holds it: whether it ended on a reply, called
 * `stay_quiet`, or ended on a provider's error, and how long it took.
 */
export interface RunTurn {
	replied: boolean;
	quiet: boolean;
	failed: boolean;
	ms: number;
	/** What the turn spent. */
	usage: RunUsage;
}

/** The turn of routine `routineId`'s run at `at` in conversation `sessionId`, or `null` when it is not found. */
export type TurnOf = (sessionId: string, routineId: string, at: number) => RunTurn | null;

/** How long `run` took: its command's run, or its Bot's turn; `null` while it has not ended or is not found. */
function durationOf(run: RoutineRun, turn: RunTurn | null): number | null {
	const { outcome } = run;
	if (outcome.kind === "command") return outcome.run.phase === "running" ? null : outcome.run.endedAt - outcome.run.startedAt;
	return turn?.ms ?? null;
}

/** Whether `run` failed in itself: an error, a command that did not exit 0, or a Bot turn a provider's error ended. */
function errored(run: RoutineRun, turn: RunTurn | null): boolean {
	const { outcome } = run;
	if (run.errors.length > 0 || outcome.kind === "failed") return true;
	if (outcome.kind === "command") return outcome.run.phase === "stopped" || outcome.run.phase === "failed" || (outcome.run.phase === "exited" && outcome.run.code !== 0);
	return turn?.failed ?? false;
}

const median = (values: number[]): number => {
	const sorted = values.toSorted((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Why `run` of `routine` exited early, or `null` when it did not. `older` is the routine's newest scheduled run before
 * it, from which its slot counted; `usual` is the other runs' times.
 */
function exitOf(routine: Routine, run: RoutineRun, turn: RunTurn | null, older: RoutineRun | undefined, usual: number[], now: number): EarlyExit | null {
	if (errored(run, turn)) return "errored";
	const { outcome } = run;
	if (outcome.kind === "queued" || outcome.kind === "sending") return now - run.at >= LATE_AFTER_MS ? "missed" : null;
	if (turn !== null && !turn.replied && !turn.quiet) return "no-reply";
	const ms = durationOf(run, turn);
	if (ms !== null && !turn?.quiet && usual.length >= MIN_USUAL_RUNS && ms < SHORT_SHARE * median(usual)) return "short";
	if (run.triggeredBy.length === 0 && older !== undefined && run.at - nextDueAt(routine.schedules, older.at) >= LATE_AFTER_MS) return "missed";
	return null;
}

/**
 * Every run of `routines` that exited early among those claimed from {@link HEALTH_WINDOW_MS} before the last
 * {@link SETTLE_MS} up to it, oldest first, so two heartbeats a day apart judge each run once; and each routine that
 * runs here and has a slot overdue by {@link LATE_AFTER_MS} or more, at that slot. `turnOf` finds a prompt run's turn.
 */
export function earlyRuns(routines: readonly Routine[], now: number, turnOf: TurnOf): EarlyRun[] {
	const to = now - SETTLE_MS;
	const from = to - HEALTH_WINDOW_MS;
	const early: EarlyRun[] = [];
	for (const routine of routines) {
		const { botId, id: routineId, name } = routine;
		const turns = new Map(routine.runs.map(run => [run.at, run.outcome.kind === "sent" ? turnOf(run.outcome.sessionId, routineId, run.at) : null]));
		const durations = new Map(routine.runs.map(run => [run.at, durationOf(run, turns.get(run.at) ?? null)]));
		routine.runs.forEach((run, index) => {
			if (run.at < from || run.at >= to) return;
			const older = routine.runs.slice(index + 1).find(({ triggeredBy }) => triggeredBy.length === 0);
			const usual = routine.runs.flatMap(other => (other === run ? [] : (durations.get(other.at) ?? [])));
			const exit = exitOf(routine, run, turns.get(run.at) ?? null, older, usual, now);
			if (exit !== null) early.push({ botId, routineId, name, at: run.at, exit });
		});
		if (!runsHere(routine) || routine.schedules.length === 0) continue;
		const due = nextDueAt(routine.schedules, routine.scheduledAt ?? routine.createdAt);
		if (now - due >= LATE_AFTER_MS) early.push({ botId, routineId, name, at: due, exit: "missed" });
	}
	return early.toSorted((a, b) => a.at - b.at);
}
