import { useCallback, useMemo, useRef } from "react";
import { isPortablePreference, PORTABLE_PREFERENCES, type PagePreferences, type PreferenceChange } from "../src/shared/preferences";
import { keyedStore } from "./keyed-store";

/**
 * What localStorage holds under each key, `null` when nothing is stored, and `undefined` until the key is first read.
 * The one snapshot every {@link useStoredState} of a key reads, so a write in one component shows in the others.
 */
const raws = keyedStore<string | null | undefined>(undefined);

function readRaw(key: string): string | null {
	const raw = raws.get(key);
	return raw === undefined ? localStorage.getItem(key) : raw;
}

if (typeof window !== "undefined") window.addEventListener("storage", event => {
	if (event.storageArea !== localStorage) return;
	if (event.key === null) for (const key of raws.keys()) raws.set(key, localStorage.getItem(key));
	else raws.set(event.key, event.newValue);
});

function write(key: string, kept: string | null): void {
	if (kept === null) localStorage.removeItem(key);
	else localStorage.setItem(key, kept);
	raws.set(key, kept);
}

const ignore = (): void => {};

/** Where this page's change to a portable preference goes: the open socket, once `web/use-dashboard.ts` hands it over. */
let sendPreference: (change: PreferenceChange) => void = ignore;

/** Sends each change this page makes to a portable preference through `send`, until the returned function stops it. */
export function sendPreferencesThrough(send: (change: PreferenceChange) => void): () => void {
	sendPreference = send;
	return () => {
		if (sendPreference === send) sendPreference = ignore;
	};
}

/**
 * Stores `value` under `key`, or removes the key when `value` is the default, so a value reset to it follows the default if it changes.
 * A portable preference that changes also goes to the server, which keeps it for every window and Settings › Sync.
 */
export function storeOrRemove(key: string, value: string, defaultValue: string): void {
	const kept = value === defaultValue ? null : value;
	const changed = readRaw(key) !== kept;
	write(key, kept);
	if (changed && isPortablePreference(key)) sendPreference({ op: "set", key, value: kept });
}

/** What this page keeps under each portable preference, which seeds the server's while it keeps none. */
export function storedPreferences(): PagePreferences {
	const values: Record<string, string> = {};
	for (const key of PORTABLE_PREFERENCES) {
		const raw = readRaw(key);
		if (raw !== null) values[key] = raw;
	}
	return values;
}

/** Takes the server's preferences as this page's own without sending them back; only a key whose value changed wakes its readers. */
export function adoptPreferences(values: PagePreferences): void {
	for (const key of PORTABLE_PREFERENCES) {
		const value = values[key] ?? null;
		if (readRaw(key) !== value) write(key, value);
	}
}

/** Calls `changed` after each write of `key`, from this page, another page of this origin, or the server, until the returned function stops it. */
export const onStoredChange = (key: string, changed: () => void): (() => void) => raws.subscribe(key, changed);

/** The number localStorage keeps under `key` when `valid` takes it, else `fallback`. */
export function storedNumber(key: string, valid: (value: number) => boolean, fallback: number): number {
	const raw = readRaw(key);
	const value = Number(raw);
	return raw !== null && valid(value) ? value : fallback;
}

/**
 * A value that localStorage keeps under `key`, and its setter, which stores it at once and stays the same function
 * across renders. `decode` turns what is stored into a value; what it makes of `null`, when nothing is stored, is the
 * default. The default is removed rather than stored, so a value reset to it follows the default if it changes.
 * The setter also takes an update of the value it last set, so two in one event both apply. Every component that holds
 * the same key, in this tab or another, sees the write, such as the sidebar's pull request list and the Pull requests page.
 */
export function useStoredState<T>(key: string, decode: (raw: string | null) => T, encode: (value: T) => string = String): [T, (next: T | ((prev: T) => T)) => void] {
	const codec = useRef({ decode, encode });
	codec.current = { decode, encode };
	raws.use(key);
	const raw = readRaw(key);
	const value = useMemo(() => codec.current.decode(raw), [raw]);
	const store = useCallback(
		(next: T | ((prev: T) => T)): void => {
			const { decode, encode } = codec.current;
			const resolved = typeof next === "function" ? (next as (prev: T) => T)(decode(readRaw(key))) : next;
			storeOrRemove(key, encode(resolved), encode(decode(null)));
		},
		[key],
	);
	return [value, store];
}

function decodeKeys(raw: string | null): ReadonlySet<string> {
	try {
		const keys: unknown = JSON.parse(raw ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** A set of keys that localStorage keeps under `storageKey`, such as folded sections, with a toggle that flips each key it names. */
export function useStoredKeys(storageKey: string): [ReadonlySet<string>, (...keys: string[]) => void] {
	const [keys, store] = useStoredState(storageKey, decodeKeys, stored => JSON.stringify([...stored]));
	const toggle = useCallback(
		(...flipped: string[]): void =>
			store(prev => {
				const next = new Set(prev);
				for (const key of flipped) if (!next.delete(key)) next.add(key);
				return next;
			}),
		[store],
	);
	return [keys, toggle];
}
