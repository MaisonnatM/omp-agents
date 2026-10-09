/** Files read or `git` processes run at once by a pass over many sessions or directories, which keeps the disk busy without forking a burst. */
export const PROBE_PARALLEL = 16;

/** `fn` over every item, at most `limit` at once, the results in the items' order. The first rejection rejects the call. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++;
			results[index] = await fn(items[index]!, index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}
