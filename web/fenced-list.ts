/** A fenced JSON list in an agent's reply, such as `review-pages` or `before-after`: how to read one fence, and the latest one a session's transcript holds. */
import type { Item } from "../src/shared/transcript";

/** How one kind of fence reads: its language, each item's parser, what makes two items the same one, and how many it keeps. */
interface FencedListSpec<T> {
	language: string;
	itemOf: (raw: unknown) => T | null;
	keyOf: (item: T) => string;
	max: number;
}

export interface FencedList<T> {
	/** The items a fence's `source` lists: a JSON array, keeping valid items, each key once, up to the cap; `null` when it is not a JSON array. */
	parse: (source: string) => T[] | null;
	/** The items of the last valid fence in a settled agent reply; empty before one. */
	latest: (items: readonly Item[]) => T[];
	/** Whether two lists hold the same items with the same fields, in the same order, so a reader renders only when the list changes. */
	same: (a: readonly T[], b: readonly T[]) => boolean;
}

const sameFields = (a: object, b: object): boolean => {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every(key => (a as Record<string, unknown>)[key] === (b as Record<string, unknown>)[key]);
};

export function fencedList<T extends object>({ language, itemOf, keyOf, max }: FencedListSpec<T>): FencedList<T> {
	const fence = new RegExp(`\`\`\`${language}[^\\S\\n]*\\n([\\s\\S]*?)\`\`\``, "g");
	const parse = (source: string): T[] | null => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(source);
		} catch {
			return null;
		}
		if (!Array.isArray(parsed)) return null;
		const items = parsed.flatMap(raw => itemOf(raw) ?? []);
		const keys = items.map(keyOf);
		return items.filter((_, at) => keys.indexOf(keys[at]!) === at).slice(0, max);
	};
	const latest = (items: readonly Item[]): T[] => {
		for (let at = items.length - 1; at >= 0; at--) {
			const item = items[at]!;
			if (item.kind !== "assistant" || item.streaming) continue;
			for (const match of [...item.text.matchAll(fence)].reverse()) {
				const list = parse(match[1]!);
				if (list !== null) return list;
			}
		}
		return [];
	};
	const same = (a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((item, at) => sameFields(item, b[at]!));
	return { parse, latest, same };
}
