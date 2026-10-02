/** How long an answer serves later loads, so that several tabs and quick switches share one query. */
const FRESH_MS = 30_000;

export type Cache<T> = Map<string, { at: number; answer: Promise<T> }>;

/** Answers kept for `ttlMs`, by key; a failure is not kept, so the next load asks again. `fresh` skips the kept answer. */
export function cached<T>(cache: Cache<T>, key: string, fresh: boolean, load: () => Promise<T>, ttlMs = FRESH_MS): Promise<T> {
	const now = Date.now();
	for (const [other, entry] of cache) if (now - entry.at >= ttlMs) cache.delete(other);
	const hit = cache.get(key);
	if (hit && !fresh) return hit.answer;
	const answer = load();
	cache.set(key, { at: now, answer });
	answer.catch(() => cache.get(key)?.answer === answer && cache.delete(key));
	return answer;
}
