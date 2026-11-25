/**
 * Each list {@link applyDelta} returned, by the index of its entries' keys. The next delta takes the index over from
 * the list it applies to, so a streamed token updates the index instead of building it again; a list applied to twice
 * builds it again the second time.
 */
const indexes = new WeakMap<readonly unknown[], Map<string, number>>();

/**
 * Applies a list message from the server: `reset` replaces the list with `changed`; otherwise the entries keyed in
 * `removed` leave first, then each of `changed` replaces the entry with its key in place or joins at the end, so a key
 * in both moves to the end. Entries that did not change stay the same objects, so what renders from them can skip the update.
 */
export function applyDelta<T>(prev: readonly T[], reset: boolean, changed: readonly T[], keyOf: (entry: T) => string, removed: readonly string[]): T[] {
	if (reset) return [...changed];
	const gone = new Set(removed);
	const next = gone.size > 0 ? prev.filter(entry => !gone.has(keyOf(entry))) : [...prev];
	// With nothing removed, `next` holds `prev`'s entries at the same places, so `prev`'s index holds for it.
	const kept = gone.size > 0 ? undefined : indexes.get(prev);
	if (kept) indexes.delete(prev);
	const index = kept ?? new Map(next.map((entry, i) => [keyOf(entry), i]));
	for (const entry of changed) {
		const key = keyOf(entry);
		const at = index.get(key);
		if (at === undefined) {
			index.set(key, next.length);
			next.push(entry);
		} else {
			next[at] = entry;
		}
	}
	indexes.set(next, index);
	return next;
}
