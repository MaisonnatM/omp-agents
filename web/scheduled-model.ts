/** The times the Send later menu offers. */
import type { PlanUsage } from "../src/shared/models";
import { RESET_MARGIN_MS } from "../src/shared/scheduled";

/** A time to send at: a plan window's reset, named by `reset`, or one picked by hand, with `reset` `null`. */
export interface ScheduleWhen {
	at: number;
	reset: string | null;
}

/**
 * The plan windows that reset after `now`, used-up ones first, then the soonest; each sends {@link RESET_MARGIN_MS} after its reset.
 * A window reads as its plan's name and its label, with the account only when two plans share that name.
 */
export function resetChoices(plans: readonly PlanUsage[], now: number): ScheduleWhen[] {
	const shared = new Set(plans.filter((plan, index) => plans.findIndex(other => other.name === plan.name) !== index).map(plan => plan.name));
	const windows = plans.flatMap(plan => {
		const name = plan.account && shared.has(plan.name) ? `${plan.name} · ${plan.account}` : plan.name;
		return plan.windows.flatMap(window =>
			window.resetsAt !== null && window.resetsAt > now ? [{ at: window.resetsAt + RESET_MARGIN_MS, reset: `${name} ${window.label}`, exhausted: window.exhausted }] : [],
		);
	});
	return windows.sort((a, b) => Number(b.exhausted) - Number(a.exhausted) || a.at - b.at).map(({ at, reset }) => ({ at, reset }));
}

/** 9:00 on the day after `now`, local time. */
export function tomorrowMorning(now: number): number {
	const date = new Date(now);
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 9).getTime();
}

/** An `<input type="datetime-local">` value for `at`, local time, to the minute. */
export function dateTimeInputValue(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
