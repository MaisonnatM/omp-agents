/**
 * What every list page's **Filter** and **Display** share, whatever they list: options and their counts, day ranges,
 * toggling a value in a set, and the stored display of a list that only picks a grouping.
 */
import { isObject, oneOf, parseJson } from "../src/json";

/** A day in milliseconds. */
export const DAY = 86_400_000;

/** How far a date field of **Filter**, such as **Created** or **Due**, reaches, in days, in menu order. */
export const DAY_RANGES = [1, 3, 7, 14, 30] as const;

export type DayRange = (typeof DAY_RANGES)[number];

/** How far back a date field reaches, such as **Created**'s `Last week`. */
export const DAY_RANGE_LABELS: Record<DayRange, string> = { 1: "Last day", 3: "Last 3 days", 7: "Last week", 14: "Last 2 weeks", 30: "Last month" };

/** How far ahead a date field reaches, such as **Due**'s `Within 7 days`. */
export const NEXT_DAY_RANGE_LABELS: Record<DayRange, string> = { 1: "Within a day", 3: "Within 3 days", 7: "Within 7 days", 14: "Within 14 days", 30: "Within 30 days" };

/** Whether a stored value is one of {@link DAY_RANGES}. */
export const isDayRange = oneOf(DAY_RANGES);

/** Whether the moment `at` falls within the last `range` of days before `now`; `null`, any time, keeps every moment. */
export const withinLast = (at: number, range: DayRange | null, now: number): boolean => range === null || at >= now - range * DAY;

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

/** How many of `items` hold each key `keysOf` gives. */
export function countBy<T>(items: readonly T[], keysOf: (item: T) => readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) for (const key of keysOf(item)) counts.set(key, (counts.get(key) ?? 0) + 1);
	return counts;
}

/** Each key of `counts`, most first, then by name, and each key of `checked` with none, so you can uncheck it. */
export function countedOptions(counts: ReadonlyMap<string, number>, checked: ReadonlySet<string>): FilterOption[] {
	const missing = [...checked].filter(key => !counts.has(key)).map((key): [string, number] => [key, 0]);
	return [...counts, ...missing].toSorted(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b)).map(([key, count]) => ({ key, label: key, count }));
}

/** What **Display** keeps for a list whose only choice is its grouping. */
export interface GroupingDisplay<G extends string> {
	grouping: G;
}

/** The default, decoder, and encoder of a {@link GroupingDisplay} over `groupings`; what is missing or unreadable decodes to `fallback`. */
export function groupingDisplay<G extends string>(groupings: readonly G[], fallback: G) {
	const isGrouping = oneOf(groupings);
	const DEFAULT_DISPLAY: GroupingDisplay<G> = { grouping: fallback };
	const decodeDisplay = (raw: string | null): GroupingDisplay<G> => {
		const stored = parseJson(raw ?? "null");
		return isObject(stored) && isGrouping(stored.grouping) ? { grouping: stored.grouping } : DEFAULT_DISPLAY;
	};
	const encodeDisplay = (display: GroupingDisplay<G>): string => JSON.stringify(display);
	return { DEFAULT_DISPLAY, decodeDisplay, encodeDisplay };
}
