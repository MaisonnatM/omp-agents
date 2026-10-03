import { useState } from "react";

function storedKeys(storageKey: string): Set<string> {
	try {
		const keys: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
		return new Set(Array.isArray(keys) ? keys.filter(key => typeof key === "string") : []);
	} catch {
		return new Set();
	}
}

/** A set of keys that localStorage keeps under `storageKey`, such as folded sections or pinned sessions, with a toggle and a removal. */
export function useStoredKeys(storageKey: string): [ReadonlySet<string>, (key: string) => void, (keys: string[]) => void] {
	const [keys, setKeys] = useState(() => storedKeys(storageKey));
	const store = (next: Set<string>): void => {
		setKeys(next);
		if (next.size === 0) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, JSON.stringify([...next]));
	};
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
