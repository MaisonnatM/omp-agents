/**
 * Runs work one call at a time, in the order the calls arrived.
 * A call that fails does not hold back the next one.
 */
export class SerialLane {
	#last: Promise<unknown> = Promise.resolve();
	#pending = 0;

	/** Whether a call runs or waits. */
	get busy(): boolean {
		return this.#pending > 0;
	}

	/** Settles once every call made so far has settled. */
	idle(): Promise<void> {
		return this.#last.then(() => {});
	}

	run<T>(work: () => Promise<T> | T): Promise<T> {
		this.#pending++;
		const next = this.#last.then(work, work).finally(() => this.#pending--);
		this.#last = next.catch(() => {});
		return next;
	}
}
