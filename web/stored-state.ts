import { useState } from "react";

/**
 * A value that localStorage keeps under `key`, read once, and its setter, which stores it at once. `decode` turns what is
 * stored into a value; what it makes of `null`, when nothing is stored, is the default. The default is removed rather
 * than stored, so a value reset to it follows the default if it changes.
 */
export function useStoredState<T>(key: string, decode: (raw: string | null) => T, encode: (value: T) => string = String): [T, (value: T) => void] {
	const [value, setValue] = useState(() => decode(localStorage.getItem(key)));
	const store = (next: T): void => {
		setValue(next);
		const raw = encode(next);
		if (raw === encode(decode(null))) localStorage.removeItem(key);
		else localStorage.setItem(key, raw);
	};
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

/** A set of keys that localStorage keeps under `storageKey`, such as folded sections or pinned sessions, with a toggle and a removal. */
export function useStoredKeys(storageKey: string): [ReadonlySet<string>, (key: string) => void, (keys: string[]) => void] {
	const [keys, store] = useStoredState(storageKey, decodeKeys, stored => JSON.stringify([...stored]));
	const toggle = (key: string): void => {
		const next = new Set(keys);
		if (!next.delete(key)) next.add(key);
		store(next);
	};
	const remove = (removed: string[]): void => {
		const next = new Set(keys);
		if (removed.filter(key => next.delete(key)).length > 0) store(next);
	};
	return [keys, toggle, remove];
}
