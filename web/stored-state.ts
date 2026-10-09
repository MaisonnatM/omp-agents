import { useCallback, useEffect, useRef, useState } from "react";

/** The setters of every mounted {@link useStoredState} by key, so a write in one component shows in the others. */
const holders = new Map<string, Set<(value: unknown) => void>>();

/**
 * A value that localStorage keeps under `key`, read once, and its setter, which stores it at once and stays the same
 * function across renders. `decode` turns what is stored into a value; what it makes of `null`, when nothing is stored,
 * is the default. The default is removed rather than stored, so a value reset to it follows the default if it changes.
 * The setter also takes an update of the value it last set, so two in one event both apply. Every component that holds
 * the same key sees the write, such as the inbox's sidebar and its page.
 * `key` stays the same for as long as the component is mounted: the value is read when it mounts, not when `key` changes.
 */
export function useStoredState<T>(key: string, decode: (raw: string | null) => T, encode: (value: T) => string = String): [T, (next: T | ((prev: T) => T)) => void] {
	const [value, setValue] = useState(() => decode(localStorage.getItem(key)));
	const latest = useRef({ value, decode, encode });
	latest.current.decode = decode;
	latest.current.encode = encode;
	useEffect(() => {
		const hold = (next: unknown): void => {
			latest.current.value = next as T;
			setValue(next as T);
		};
		const set = holders.get(key) ?? new Set();
		holders.set(key, set.add(hold));
		return () => {
			set.delete(hold);
			if (set.size === 0) holders.delete(key);
		};
	}, [key]);
	const store = useCallback(
		(next: T | ((prev: T) => T)): void => {
			const codec = latest.current;
			const resolved = typeof next === "function" ? (next as (prev: T) => T)(codec.value) : next;
			codec.value = resolved;
			setValue(resolved);
			for (const hold of holders.get(key) ?? []) hold(resolved);
			const raw = codec.encode(resolved);
			if (raw === codec.encode(codec.decode(null))) localStorage.removeItem(key);
			else localStorage.setItem(key, raw);
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
