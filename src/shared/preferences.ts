/**
 * The page's preferences that follow the user to every machine, as the raw strings the page keeps in localStorage. The
 * server keeps them, so Settings › Sync carries them; the page's localStorage stays the copy it paints from first.
 */
import { isObject } from "../json";

/** The localStorage keys that hold the user's own choices; widths, folds, drafts, and caches describe this machine and stay on it. */
export const PORTABLE_PREFERENCES = [
	"omp-agents.theme",
	"omp-agents.hide-tool-calls",
	"omp-agents.hide-thinking",
	"omp-agents.sidebar-tabs",
	"omp-agents.pinned-skill",
	"omp-agents.session-notifications",
	"omp-agents.merge-method",
	"omp-agents.pr-diff-layout",
	"omp-agents.pr-diff-wrap",
	"omp-agents.pr-diff-whitespace",
	"omp-agents.calendar-routines",
] as const;

const PORTABLE: ReadonlySet<string> = new Set(PORTABLE_PREFERENCES);

export const isPortablePreference = (key: string): boolean => PORTABLE.has(key);

/** What localStorage holds under each portable key; an absent key is the page's default. */
export type PagePreferences = Readonly<Record<string, string>>;

/**
 * `set` stores a key's value, or removes the key with `null`. `seed` hands the server what a page already kept, and
 * applies only while the server keeps none, so the first page to connect after an upgrade wins.
 */
export type PreferenceChange = { op: "set"; key: string; value: string | null } | { op: "seed"; values: PagePreferences };

/** `value` as preferences: `null` unless it is an object of strings under portable keys only. */
export function parsePagePreferences(value: unknown): PagePreferences | null {
	if (!isObject(value) || Array.isArray(value)) return null;
	const entries = Object.entries(value);
	return entries.every((entry): entry is [string, string] => isPortablePreference(entry[0]) && typeof entry[1] === "string") ? Object.fromEntries(entries) : null;
}

/** `values` after `change`, or `values` itself when it changes nothing; `null` until a page seeds them or sets one. */
export function applyPreference(values: PagePreferences | null, change: PreferenceChange): PagePreferences | null {
	if (change.op === "seed") return values ?? Object.fromEntries(Object.entries(change.values).filter(([key]) => isPortablePreference(key)));
	const { key, value } = change;
	if (!isPortablePreference(key)) return values;
	if (values !== null && (values[key] ?? null) === value) return values;
	const base: PagePreferences = values ?? {};
	const { [key]: _, ...rest } = base;
	return value === null ? rest : { ...rest, [key]: value };
}
