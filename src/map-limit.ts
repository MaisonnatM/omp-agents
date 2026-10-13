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

/** A gate that runs at most `most` of the tasks handed to it at once; a finished task hands its slot to the longest waiter. */
export function limit(most: number): <T>(task: () => Promise<T>) => Promise<T> {
	let running = 0;
	const waiting: (() => void)[] = [];
	return async task => {
		if (running >= most) await new Promise<void>(resolve => waiting.push(resolve));
		else running++;
		try {
			return await task();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else running--;
		}
	};
}
