/** Narrowing helpers for untyped JSON: omp's output, `gh` answers, and wire frames. */

export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A string, including the empty one. */
export const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** A string with something other than whitespace in it. */
export const nonEmptyStr = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** A finite number. */
export const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
