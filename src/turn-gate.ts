/**
 * One session's prompt, dequeue, and abort, in the order the page sent them.
 *
 * omp numbers those frames when it reads them. An abort throws away a prompt it has
 * read but not run, so a second Enter that aborts before the steer is queued loses
 * the message. Later calls wait. The first call runs now, so an abort with nothing
 * in flight still sends before `abort()` returns.
 */
export class TurnGate {
	#pending = 0;
	#last: Promise<void> = Promise.resolve();

	run<T>(work: () => Promise<T> | T): Promise<T> {
		this.#pending++;
		const previous = this.#last;
		const place = Promise.withResolvers<void>();
		this.#last = place.promise;
		const start = (): Promise<T> => {
			try {
				return Promise.resolve(work()).finally(() => {
					this.#pending--;
					place.resolve();
				});
			} catch (error) {
				this.#pending--;
				place.resolve();
				return Promise.reject(error);
			}
		};
		if (this.#pending === 1) return start();
		return previous.then(start, start);
	}
}
