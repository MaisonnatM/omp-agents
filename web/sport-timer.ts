/**
 * The routine timer's steps and clock: a routine as the holds it runs through, with the get-ready, transition, and
 * rest steps between them, and where a run stands at a moment of the `performance.now()` clock.
 */
import type { Exercise } from "../src/shared/sport";

/** The get-ready step before the first hold. */
export const PREPARE_SEC = 10;
/** The transition between two holds when the item before has no rest. */
export const CHANGE_SEC = 5;

export type Side = "gauche" | "droit";

/** One hold of an item: one side of one set. */
export interface Hold {
	item: Exercise;
	/** From 1. */
	set: number;
	sets: number;
	/** `null` for an item done on both sides at once. */
	side: Side | null;
	/** The item's last hold, whose end ticks the item. */
	last: boolean;
	/** Its place among the routine's holds, from 0. */
	index: number;
}

/**
 * What a step is: getting ready, a hold, the switch to the other side, the move to the next hold, or the rest an item
 * asks for after its set.
 */
export type StepKind = "prepare" | "hold" | "side" | "next" | "rest";

export interface TimerStep {
	kind: StepKind;
	/** Its countdown, or `null` for a hold the user ends, such as a set of reps. */
	sec: number | null;
	/** The hold it is, or the one it leads to. */
	hold: Hold;
}

/** The holds of `items`, in order: each item's sets, and each set's left then right side when the item is per side. */
export function holdsOf(items: readonly Exercise[]): Hold[] {
	const holds: Hold[] = [];
	for (const item of items) {
		const sets = Math.max(1, item.sets ?? 1);
		const sides: (Side | null)[] = item.perSide ? ["gauche", "droit"] : [null];
		for (let set = 1; set <= sets; set++) {
			for (const side of sides) holds.push({ item, set, sets, side, last: set === sets && side === sides.at(-1), index: holds.length });
		}
	}
	return holds;
}

/** The step between `from` and the hold after it: the item's rest after its set, else a change of side, else the next hold. */
function between(from: Hold, to: Hold): TimerStep | null {
	if (to.item === from.item && to.set === from.set) return { kind: "side", sec: CHANGE_SEC, hold: to };
	const rest = from.item.restSec;
	if (rest === null) return { kind: "next", sec: CHANGE_SEC, hold: to };
	return rest > 0 ? { kind: "rest", sec: rest, hold: to } : null;
}

/**
 * The steps that run `items`: getting ready, then each hold, its own `holdSec` long or ended by the user when it has
 * none, with the step {@link between} each two. A routine with no items has none.
 */
export function timerSteps(items: readonly Exercise[]): TimerStep[] {
	const holds = holdsOf(items);
	const first = holds[0];
	if (!first) return [];
	const steps: TimerStep[] = [{ kind: "prepare", sec: PREPARE_SEC, hold: first }];
	holds.forEach((hold, index) => {
		steps.push({ kind: "hold", sec: hold.item.holdSec, hold });
		const next = holds[index + 1];
		const step = next && between(hold, next);
		if (step) steps.push(step);
	});
	return steps;
}

/** Where a run stands: its step, and the time that step has run, on the `performance.now()` clock in milliseconds. */
export interface TimerRun {
	/** The current step, or the step count once the run is over. */
	at: number;
	/** How long the current step ran before `since`. */
	ran: number;
	/** When the current step last started or resumed, or `null` while paused. */
	since: number | null;
}

export const startRun = (now: number): TimerRun => ({ at: 0, ran: 0, since: now });

/** How long the current step has run at `now`. */
export const ranAt = ({ ran, since }: TimerRun, now: number): number => ran + (since === null ? 0 : now - since);

export const pauseRun = (run: TimerRun, now: number): TimerRun => (run.since === null ? run : { ...run, ran: ranAt(run, now), since: null });

export const resumeRun = (run: TimerRun, now: number): TimerRun => (run.since === null ? { ...run, since: now } : run);

/** `run` moved to step `at` from its start, still paused when it was. */
export const goTo = (run: TimerRun, at: number, now: number): TimerRun => ({ at, ran: 0, since: run.since === null ? null : now });

/**
 * `run` at `now`: each timed step that ran out ends, and the next starts the moment it ended, so a late frame or a
 * hidden tab loses no time. Returns the run and the steps that ended, in order.
 */
export function advance(steps: readonly TimerStep[], run: TimerRun, now: number): { run: TimerRun; ended: TimerStep[] } {
	const ended: TimerStep[] = [];
	let { at, ran, since } = run;
	while (since !== null && at < steps.length) {
		const step = steps[at]!;
		if (step.sec === null) break;
		const end = since - ran + step.sec * 1000;
		if (now < end) break;
		ended.push(step);
		at++;
		ran = 0;
		since = end;
	}
	return { run: ended.length === 0 ? run : { at, ran, since: at < steps.length ? since : null }, ended };
}

/** The seconds left in the timed steps from `run`'s step on, at `now`, rounded up; a hold the user ends counts none. */
export function secondsLeft(steps: readonly TimerStep[], run: TimerRun, now: number): number {
	const later = steps.slice(run.at + 1).reduce((sum, { sec }) => sum + (sec ?? 0), 0);
	const sec = steps[run.at]?.sec ?? null;
	const current = sec === null ? 0 : Math.max(0, sec * 1000 - ranAt(run, now)) / 1000;
	return Math.ceil(current + later);
}

/** A countdown's seconds: `45`, or `1:30` from a minute up. */
export const clockText = (sec: number): string => (sec < 60 ? `${sec}` : `${Math.floor(sec / 60)}:${`${sec % 60}`.padStart(2, "0")}`);

/** A length of time in words: `45 s`, `8 min 20 s`, `10 min`. */
export function spanText(sec: number): string {
	const minutes = Math.floor(sec / 60);
	const rest = sec % 60;
	if (minutes === 0) return `${rest} s`;
	return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/** Which set and side a hold is: « Série 1 / 2 · côté gauche », without the set when there is one. */
export function holdText({ set, sets, side }: Hold): string {
	const parts = [sets > 1 ? `Série ${set} / ${sets}` : null, side && `côté ${side}`].filter(part => part !== null);
	const text = parts.join(" · ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a step shows above its countdown. */
export function stepTitle({ kind }: TimerStep): string {
	switch (kind) {
		case "prepare":
			return "Prêt";
		case "hold":
			return "Tiens";
		case "side":
			return "Change de côté";
		case "next":
			return "Suivant";
		case "rest":
			return "Repos";
		default: {
			const never: never = kind;
			return never;
		}
	}
}

/** What the voice says as a step starts, or `null` for a hold, which the step before announced. */
export function spokenCue({ kind, hold }: TimerStep): string | null {
	const what = [hold.item.name, hold.side && `côté ${hold.side}`].filter(part => part).join(", ");
	switch (kind) {
		case "prepare":
			return `Prêt. ${what}`;
		case "hold":
			return null;
		case "side":
			return "Change de côté";
		case "next":
			return `Suivant : ${what}`;
		case "rest":
			return `Repos. Ensuite : ${what}`;
		default: {
			const never: never = kind;
			return never;
		}
	}
}
