import { useCallback, useMemo, useRef } from "react";
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

/** Stores `value` under `key`, or removes the key when `value` is the default, so a value reset to it follows the default if it changes. */
export function storeOrRemove(key: string, value: string, defaultValue: string): void {
	const kept = value === defaultValue ? null : value;
	if (kept === null) localStorage.removeItem(key);
	else localStorage.setItem(key, kept);
	raws.set(key, kept);
}

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
