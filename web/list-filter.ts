/** What every list page's **Filter** shares, whatever it lists: its options, its day ranges, and toggling a value in a set. */
import { oneOf } from "../src/json";

/** A day in milliseconds. */
export const DAY = 86_400_000;

/** How far back a date field of **Filter**, such as **Created** or **Updated**, reaches, in days, in menu order. */
export const DAY_RANGES = [1, 3, 7, 14, 30] as const;

export type DayRange = (typeof DAY_RANGES)[number];

export const DAY_RANGE_LABELS: Record<DayRange, string> = { 1: "Last day", 3: "Last 3 days", 7: "Last week", 14: "Last 2 weeks", 30: "Last month" };

/** Whether a stored value is one of {@link DAY_RANGES}. */
export const isDayRange = oneOf(DAY_RANGES);

/** A value a field of **Filter** checks, with how many items it holds where the menu says so. */
export interface FilterOption<K extends string = string> {
	key: K;
	label: string;
	count?: number;
}

/** `set` with `value` flipped. */
export function withToggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
	const next = new Set(set);
	if (!next.delete(value)) next.add(value);
	return next;
}
