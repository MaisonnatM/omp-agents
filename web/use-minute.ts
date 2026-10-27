import { useSyncExternalStore } from "react";

/** One timer for every component that reads the time at `period`, running while any listens. */
function clock(period: number): { subscribe: (listener: () => void) => () => void; now: () => number } {
	let now = Date.now();
	const listeners = new Set<() => void>();
	let timer: Timer | undefined;
	return {
		subscribe: listener => {
			listeners.add(listener);
			if (listeners.size === 1) {
				now = Date.now();
				timer = setInterval(() => {
					now = Date.now();
					for (const notify of listeners) notify();
				}, period);
			}
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) clearInterval(timer);
			};
		},
		now: () => now,
	};
}

const minute = clock(60_000);
const second = clock(1000);

/** The time now, renewed each minute, so "Today" turns into "Tomorrow", a passed slot reads as due, and an age counts up. */
export function useMinute(): number {
	return useSyncExternalStore(minute.subscribe, minute.now);
}

/** A countdown reads seconds under this, so only then does it renew each second. */
const SECONDS_SHOWN_MS = 3_600_000;

/**
 * The time now for a countdown to `at`: renewed each second while `at` is under an hour ahead, else each minute.
 * Only the components counting down to such an `at` listen to the second's timer, so nothing else re-renders each second; a run already due reads **Due now** until the server claims it, which needs no second's timer.
 */
export function useCountdownNow(at: number | null): number {
	const minuteNow = useMinute();
	const near = at !== null && at > minuteNow && at - minuteNow < SECONDS_SHOWN_MS;
	const store = near ? second : minute;
	return useSyncExternalStore(store.subscribe, store.now);
}
