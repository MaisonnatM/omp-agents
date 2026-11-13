/** Reordering a list by drag or by key: where an item lands beside another, and the line that shows it. */

export type Where = "before" | "after";

/** `keys` with `key` moved to just before or after `target`; unchanged when either is missing or they are one. */
export function moveKey(keys: readonly string[], key: string, target: string, where: Where): string[] {
	if (key === target || !keys.includes(key) || !keys.includes(target)) return [...keys];
	const rest = keys.filter(other => other !== key);
	const at = rest.indexOf(target) + (where === "after" ? 1 : 0);
	return [...rest.slice(0, at), key, ...rest.slice(at)];
}

/** `items` with the one keyed `key` moved to just before or after the one keyed `target`, as {@link moveKey} moves keys. */
export function moveBy<T>(items: readonly T[], keyOf: (item: T) => string, key: string, target: string, where: Where): T[] {
	const moved = items.find(item => keyOf(item) === key);
	if (moved === undefined || key === target || !items.some(item => keyOf(item) === target)) return [...items];
	const rest = items.filter(item => item !== moved);
	const at = rest.findIndex(item => keyOf(item) === target) + (where === "after" ? 1 : 0);
	return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** The neighbor `key` swaps with when it moves one place `by`, and on which side; `null` at the edge. */
export function stepTarget(keys: readonly string[], key: string, by: 1 | -1): { target: string; where: Where } | null {
	const target = keys[keys.indexOf(key) + by];
	return target === undefined || !keys.includes(key) ? null : { target, where: by === 1 ? "after" : "before" };
}

/** The line that shows where a dragged item would land, on an element that is `relative`. */
export const DROP_LINE: Record<Where, string> = {
	before: "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-ring",
	after: "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-ring",
};

/** {@link DROP_LINE} for items laid out in a row, such as the header tabs: the line stands at the item's left or right edge. */
export const SIDE_DROP_LINE: Record<Where, string> = {
	before: "before:absolute before:inset-y-1 before:-left-px before:w-0.5 before:rounded-full before:bg-ring",
	after: "after:absolute after:inset-y-1 after:-right-px after:w-0.5 after:rounded-full after:bg-ring",
};
