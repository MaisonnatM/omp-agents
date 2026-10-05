import { useCallback, useSyncExternalStore } from "react";

/** One snapshot and subscription per key, so a change wakes only consumers of that key. */
export function keyedStore<T>(empty: T) {
	const entries = new Map<string, T>();
	const listeners = new Map<string, Set<() => void>>();
	const get = (key: string): T => entries.get(key) ?? empty;
	const set = (key: string, value: T): void => {
		if (value === empty) entries.delete(key);
		else entries.set(key, value);
		for (const listener of listeners.get(key) ?? []) listener();
	};
	const subscribe = (key: string, listener: () => void): (() => void) => {
		const set = listeners.get(key) ?? new Set();
		listeners.set(key, set.add(listener));
		return () => {
			set.delete(listener);
			if (set.size === 0) listeners.delete(key);
		};
	};
	const use = (key: string): T => {
		const watch = useCallback((listener: () => void) => subscribe(key, listener), [key]);
		const read = useCallback(() => get(key), [key]);
		return useSyncExternalStore(watch, read, read);
	};
	return { get, set, use };
}
