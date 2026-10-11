/** Answers kept by key for a time to live. A failure is not kept, so the next `get` asks again. */
export interface Cache<T> {
	/** The kept answer for `key`, else `load()`'s. `fresh` skips the kept answer. */
	get(key: string, load: () => Promise<T>, fresh?: boolean): Promise<T>;
	drop(key: string): void;
	/** Forget every kept answer whose key `matches`. */
	dropWhere(matches: (key: string) => boolean): void;
}

/** A {@link Cache} that keeps answers for `ttlMs`, so that several tabs and quick switches share one query. */
export function createCache<T>(ttlMs = 30_000): Cache<T> {
	const entries = new Map<string, { at: number; answer: Promise<T> }>();
	return {
		get(key, load, fresh = false) {
			const now = Date.now();
			for (const [other, entry] of entries) if (now - entry.at >= ttlMs) entries.delete(other);
			const hit = entries.get(key);
			if (hit && !fresh) return hit.answer;
			const answer = load();
			entries.set(key, { at: now, answer });
			answer.catch(() => entries.get(key)?.answer === answer && entries.delete(key));
			return answer;
		},
		drop(key) {
			entries.delete(key);
		},
		dropWhere(matches) {
			for (const key of entries.keys()) if (matches(key)) entries.delete(key);
		},
	};
}
