/**
 * A cache of answers kept for `ttlMs`, by key, so that several tabs and quick switches share one query.
 * A failure is not kept, so the next `get` asks again.
 */
export function createCache<T>(ttlMs = 30_000) {
	const entries = new Map<string, { at: number; answer: Promise<T> }>();
	return {
		/** The kept answer for `key`, else `load()`'s. `fresh` skips the kept answer. */
		get(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
			const now = Date.now();
			for (const [other, entry] of entries) if (now - entry.at >= ttlMs) entries.delete(other);
			const hit = entries.get(key);
			if (hit && !fresh) return hit.answer;
			const answer = load();
			entries.set(key, { at: now, answer });
			answer.catch(() => entries.get(key)?.answer === answer && entries.delete(key));
			return answer;
		},
		drop(key: string): void {
			entries.delete(key);
		},
	};
}
