/** Narrowing helpers for untyped JSON: omp's output, `gh` answers, and wire frames. */

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A string, including the empty one. */
export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A string with something other than whitespace in it. */
export const nonEmptyStr = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** A finite number. */
export const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A guard for the members of a fixed list, such as an `as const` array of the values a union allows. */
export const oneOf =
	<T extends string | number>(values: readonly T[]) =>
	(value: unknown): value is T =>
		values.includes(value as T);

export const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** `list` as a tuple that has a first member, or `null` when it is empty. */
export const nonEmpty = <T>(list: readonly T[]): [T, ...T[]] | null => (list.length === 0 ? null : (list as [T, ...T[]]));

/** Every entry of `values` through `parse`, or `null` when `values` is no array or one entry does not parse. */
export function parseAll<T>(values: unknown, parse: (value: unknown) => T | null): T[] | null {
	if (!Array.isArray(values)) return null;
	const parsed: T[] = [];
	for (const value of values) {
		const entry = parse(value);
		if (entry === null) return null;
		parsed.push(entry);
	}
	return parsed;
}
