/**
 * Runs one session's prompts, promotes, interrupts, and flushes one at a time, in the order the page sent them.
 * A call that fails does not hold back the next one.
 *
 * Socket handlers do not wait for each other.
 * Without this order, an abort could reach omp before the steer it should deliver, and omp drops a prompt it has read but not run when an abort follows.
 */
export class TurnGate {
	#last: Promise<unknown> = Promise.resolve();

	run<T>(work: () => Promise<T> | T): Promise<T> {
		const next = this.#last.then(work, work);
		this.#last = next.catch(() => {});
		return next;
	}
}
