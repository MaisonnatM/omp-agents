/** Strings this browser keeps by name under one localStorage key, each dropped once nobody changed it for a while. */
import { fields, isNumber, isObject, isString } from "../src/json";

interface Kept {
	text: string;
	/** When the text last changed, in epoch milliseconds. */
	at: number;
}

const isKept = fields<Kept>({ text: isString, at: isNumber });

export interface ExpiringStrings {
	get(name: string): string | null;
	/** Keeps `text` under `name`, or forgets `name` for `null`, dropping every other string unchanged for the keep time. */
	set(name: string, text: string | null): void;
}

/** The strings kept under `storageKey`, each for `keepMs` after it last changed. */
export function expiringStrings(storageKey: string, keepMs: number): ExpiringStrings {
	/** What is kept, without any entry in another shape. */
	const stored = (): Record<string, Kept> => {
		try {
			const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
			if (!isObject(value) || Array.isArray(value)) return {};
			return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, Kept] => isKept(entry[1])));
		} catch {
			return {};
		}
	};
	return {
		get: name => stored()[name]?.text ?? null,
		set(name, text) {
			const all = stored();
			if ((all[name]?.text ?? null) === text) return;
			const now = Date.now();
			const kept = Object.fromEntries(Object.entries(all).filter(([other, entry]) => other !== name && now - entry.at < keepMs));
			if (text !== null) kept[name] = { text, at: now };
			try {
				localStorage.setItem(storageKey, JSON.stringify(kept));
			} catch {
				// Over quota: the text is not kept, and the caller still holds it.
			}
		},
	};
}
