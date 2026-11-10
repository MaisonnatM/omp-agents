/**
 * Where each item of a page-wide queue stands, by key, as an immutable map React components subscribe to;
 * the rebase and worktree removal queues each keep one.
 */
import { useSyncExternalStore } from "react";

export interface QueueStates<State extends string> {
	/** The current map; a new one after each change. */
	readonly current: () => ReadonlyMap<string, State>;
	/** Sets each of `keys` to `state`, or drops it for `null`, then tells subscribers once. */
	set(keys: Iterable<string>, state: State | null): void;
	readonly subscribe: (listener: () => void) => () => void;
	/** Where `key` stands; `null` while it is not queued. */
	useState(key: string): State | null;
	useStates(): ReadonlyMap<string, State>;
	/** Whether anything is queued. */
	useBusy(): boolean;
}

export function queueStates<State extends string>(): QueueStates<State> {
	let states: ReadonlyMap<string, State> = new Map();
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	const notify = (): void => {
		for (const listener of listeners) listener();
	};
	return {
		current: () => states,
		set(keys, state) {
			const next = new Map(states);
			for (const key of keys) {
				if (state) next.set(key, state);
				else next.delete(key);
			}
			states = next;
			notify();
		},
		subscribe,
		useState: key => useSyncExternalStore(subscribe, () => states.get(key) ?? null),
		useStates: () => useSyncExternalStore(subscribe, () => states),
		useBusy: () => useSyncExternalStore(subscribe, () => states.size > 0),
	};
}
