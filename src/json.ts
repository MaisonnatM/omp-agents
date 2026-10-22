/**
 * Narrowing helpers for untyped JSON: omp's output, `gh` answers, wire frames, and the files the server keeps.
 * It uses no Bun API, so the page and the desktop shell bundle it too.
 */

/** A checked value as `{ ok }`, or the refusal: `null`, or `{ error }` from a parser that says why. */
export type Parsed<T, Refusal extends { error: string } | null = null> = { ok: T } | Refusal;

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A string with something other than whitespace in it. */
export const isNonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** A number with no fraction that a double holds exactly, such as epoch milliseconds. */
export const isSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day as `YYYY-MM-DD`, as a todo's `due`, a Linear issue's `dueDate`, and an all-day Google event name one, that the calendar has. */
export const isDay = (value: unknown): value is string => {
	if (typeof value !== "string" || !DAY.test(value)) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
};

/** Bytes in standard base64, as a request body carries a file or an image. */
export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** A string, including the empty one. */
export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A string with something other than whitespace in it. */
export const nonEmptyStr = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** A finite number. */
export const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A guard for the members of a fixed list, such as an `as const` array of the values a union allows. */
export const oneOf =
	<T extends string | number | boolean | null>(values: readonly T[]) =>
	(value: unknown): value is T =>
		values.includes(value as T);

export const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** A type guard over untyped JSON, which the guards below compose into a guard of a whole shape. */
export type Guard<T> = (value: unknown) => value is T;

/** A guard for each field of `T`, so that leaving one out does not compile. */
export type Shape<T> = { [K in keyof T]-?: Guard<T[K]> };

export const isString: Guard<string> = (value): value is string => typeof value === "string";

/** A finite number. */
export const isNumber: Guard<number> = (value): value is number => typeof value === "number" && Number.isFinite(value);

export const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";

export const nullable =
	<T>(guard: Guard<T>): Guard<T | null> =>
	(value): value is T | null =>
		value === null || guard(value);

/** A field JSON may leave out. */
export const optional =
	<T>(guard: Guard<T>): Guard<T | undefined> =>
	(value): value is T | undefined =>
		value === undefined || guard(value);

export const arrayOf =
	<T>(guard: Guard<T>): Guard<T[]> =>
	(value): value is T[] =>
		Array.isArray(value) && value.every(item => guard(item));

/** An object, not an array, whose every value passes `guard`, such as entries by name. */
export const recordOf =
	<T>(guard: Guard<T>): Guard<Record<string, T>> =>
	(value): value is Record<string, T> =>
		isObject(value) && !Array.isArray(value) && Object.values(value).every(item => guard(item));

/** An object whose every field `shape` names passes that field's guard; fields it does not name are not checked. */
export const fields =
	<T>(shape: Shape<T>): Guard<T> =>
	(value): value is T =>
		isObject(value) && Object.entries(shape).every(([key, guard]) => (guard as Guard<unknown>)(value[key]));

/** One of a union whose members differ in their `tag` field, each checked by the shape of its other fields. */
export function tagged<T extends Record<K, string>, K extends string>(tag: K, variants: { [V in T[K]]: Shape<Omit<Extract<T, Record<K, V>>, K>> }): Guard<T> {
	const guards: Record<string, Guard<unknown>> = Object.fromEntries(Object.entries(variants).map(([variant, shape]) => [variant, fields(shape as Shape<unknown>)]));
	return (value): value is T => {
		const variant = isObject(value) ? value[tag] : undefined;
		return typeof variant === "string" && Object.hasOwn(guards, variant) && guards[variant]!(value);
	};
}

/** `guard` as a decoder: the value it accepts, typed, or `null`. */
export const decoder =
	<T>(guard: Guard<T>) =>
	(raw: unknown): T | null =>
		guard(raw) ? raw : null;

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

/** `text` as JSON, or `undefined` when it does not parse, such as a line a writer has not finished. */
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
