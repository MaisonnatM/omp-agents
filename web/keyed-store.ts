import { useCallback, useRef, useSyncExternalStore } from "react";

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
	/**
	 * Reads `select(entry)` of `key`, waking only when that result changes by `equal`, so a change to another field of
	 * the entry renders nothing. `select` must be the same function across renders, or `equal` must hold between its results.
	 */
	const useSelect = <S>(key: string, select: (entry: T) => S, equal: (a: S, b: S) => boolean = Object.is): S => {
		const watch = useCallback((listener: () => void) => subscribe(key, listener), [key]);
		const last = useRef<{ entry: T; select: (entry: T) => S; selected: S } | null>(null);
		const read = (): S => {
			const entry = get(key);
			const before = last.current;
			if (before && before.entry === entry && before.select === select) return before.selected;
			const selected = select(entry);
			const kept = before && equal(before.selected, selected) ? before.selected : selected;
			last.current = { entry, select, selected: kept };
			return kept;
		};
		return useSyncExternalStore(watch, read, read);
	};
	return { get, set, use, useSelect };
}
