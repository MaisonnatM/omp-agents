/** Answers kept by key for a time to live. A failure is not kept, so the next `get` asks again. */
export interface Cache<T> {
	/** The kept answer for `key`, else `load()`'s. `fresh` skips the kept answer. */
	get(key: string, load: () => Promise<T>, fresh?: boolean): Promise<T>;
	drop(key: string): void;
	/** Forget every kept answer whose key `matches`. */
	dropWhere(matches: (key: string) => boolean): void;
}

/**
 * A {@link Cache} that keeps answers for `ttlMs`, so that several tabs and quick switches share one query. An answer
 * past `ttlMs` by the clock is never served, which holds across a machine's sleep, and each answer also leaves on its
 * own timer, so a key nobody asks for again does not hold its answer.
 */
export function createCache<T>(ttlMs = 30_000): Cache<T> {
	const entries = new Map<string, { at: number; answer: Promise<T>; expiry: Timer }>();
	const forget = (key: string): void => {
		clearTimeout(entries.get(key)?.expiry);
		entries.delete(key);
	};
	return {
		get(key, load, fresh = false) {
			const now = Date.now();
			const hit = entries.get(key);
			if (hit && !fresh && now - hit.at < ttlMs) return hit.answer;
			forget(key);
			const answer = load();
			entries.set(key, { at: now, answer, expiry: setTimeout(() => entries.delete(key), ttlMs).unref() });
			answer.catch(() => entries.get(key)?.answer === answer && forget(key));
			return answer;
		},
		drop: forget,
		dropWhere(matches) {
			for (const key of entries.keys()) if (matches(key)) forget(key);
		},
	};
}
