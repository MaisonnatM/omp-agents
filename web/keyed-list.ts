/**
 * Applies a list message from the server: `reset` replaces the list with `changed`; otherwise each of `changed`
 * replaces the entry with its key in place or joins at the end, and the entries keyed in `removed` leave. Entries that
 * did not change stay the same objects, so what renders from them can skip the update.
 */
export function applyDelta<T>(prev: readonly T[], reset: boolean, changed: readonly T[], keyOf: (entry: T) => string, removed: readonly string[]): T[] {
	if (reset) return [...changed];
	const gone = new Set(removed);
	const next = gone.size > 0 ? prev.filter(entry => !gone.has(keyOf(entry))) : [...prev];
	const index = new Map(next.map((entry, i) => [keyOf(entry), i]));
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
	return next;
}
