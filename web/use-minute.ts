import { useSyncExternalStore } from "react";

let now = Date.now();
const listeners = new Set<() => void>();
let timer: Timer | undefined;

/** One timer for every component on the page, running while any listens. */
function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (listeners.size === 1) {
		now = Date.now();
		timer = setInterval(() => {
			now = Date.now();
			for (const notify of listeners) notify();
		}, 60_000);
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) clearInterval(timer);
	};
}

/** The time now, renewed each minute, so "Today" turns into "Tomorrow", a passed slot reads as due, and an age counts up. */
export function useMinute(): number {
	return useSyncExternalStore(subscribe, () => now);
}
