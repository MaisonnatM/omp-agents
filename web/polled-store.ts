import { useCallback, useEffect, useSyncExternalStore } from "react";
import { errorText, getJson } from "./api";

/** How often an open page asks again; the server answers from its cache in between. */
const POLL_MS = 60_000;

export interface PolledRead<T> {
	data: T;
	at: number;
}

/** One key's last read, kept while a newer one loads, and how the latest attempt went. */
export interface PolledEntry<T> {
	read: PolledRead<T> | null;
	/** Why the latest attempt failed; cleared by the next success. */
	error: string | null;
	refreshing: boolean;
}

interface PolledStoreOptions<T> {
	/** The localStorage key under which the last read of every key is kept, so a reopened page shows at once, even after a reload. */
	cacheKey: string;
	/** The API path that reads `scope`; `fresh` makes the server skip its own cache too. */
	url: (scope: string | null, fresh: boolean) => string;
	/** Whether a value read back from localStorage has the shape of `T`. */
	isValid: (value: unknown) => value is T;
}

/**
 * A store of server reads by scope that the sidebar and a page share, kept in localStorage and re-read while a page that
 * uses it is open. The scope names what the read is about, such as a project; it is `null` for a read about everything,
 * or in a store with one entry. The entries and their cache hold `null` under `""`.
 */
export function createPolledStore<T>({ cacheKey, url, isValid }: PolledStoreOptions<T>) {
	const empty: PolledEntry<T> = { read: null, error: null, refreshing: false };

	function storedEntries(): Map<string, PolledEntry<T>> {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? "{}");
			if (typeof stored !== "object" || stored === null) return new Map();
			return new Map(
				Object.entries(stored).flatMap(([key, read]: [string, Partial<PolledRead<T>> | null]) =>
					typeof read?.at === "number" && isValid(read.data) ? [[key, { ...empty, read: read as PolledRead<T> }]] : [],
				),
			);
		} catch {
			return new Map();
		}
	}

	const entries = storedEntries();
	const listeners = new Map<string, Set<() => void>>();
	let inflight: { key: string; controller: AbortController } | null = null;

	function update(key: string, patch: Partial<PolledEntry<T>>): void {
		entries.set(key, { ...(entries.get(key) ?? empty), ...patch });
		for (const listener of listeners.get(key) ?? []) listener();
	}

	function persist(): void {
		const reads = Object.fromEntries([...entries].flatMap(([key, { read }]) => (read ? [[key, read]] : [])));
		try {
			localStorage.setItem(cacheKey, JSON.stringify(reads));
		} catch {
			// Over quota: the reads still show from memory until the next reload.
		}
	}

	/** Reads `scope` again, superseding any read in flight. */
	async function refresh(scope: string | null = null, { fresh = false }: { fresh?: boolean } = {}): Promise<void> {
		const key = scope ?? "";
		if (inflight) {
			inflight.controller.abort();
			update(inflight.key, { refreshing: false });
		}
		const current = { key, controller: new AbortController() };
		inflight = current;
		update(key, { refreshing: true });
		try {
			const data = await getJson<T>(url(scope, fresh), current.controller.signal);
			update(key, { read: { data, at: Date.now() }, error: null, refreshing: false });
			persist();
		} catch (err) {
			if (!current.controller.signal.aborted) update(key, { error: errorText(err), refreshing: false });
		} finally {
			if (inflight === current) inflight = null;
		}
	}

	const subscribe = (key: string, listener: () => void): (() => void) => {
		const set = listeners.get(key) ?? new Set();
		listeners.set(key, set.add(listener));
		return () => {
			set.delete(listener);
			if (set.size === 0) listeners.delete(key);
		};
	};

	function useEntry(scope: string | null, poll: boolean): PolledEntry<T> {
		const key = scope ?? "";
		useEffect(() => {
			if (!poll) return;
			void refresh(scope);
			const timer = setInterval(() => void refresh(scope), POLL_MS);
			return () => clearInterval(timer);
		}, [scope, poll]);
		const watch = useCallback((listener: () => void) => subscribe(key, listener), [key]);
		return useSyncExternalStore(watch, () => entries.get(key) ?? empty);
	}

	return {
		/** `scope`'s entry, as the store last read it. */
		use: (scope: string | null = null): PolledEntry<T> => useEntry(scope, false),
		/** `scope`'s entry, read again now and every {@link POLL_MS} while mounted, showing the kept read meanwhile. */
		usePolling: (scope: string | null = null): PolledEntry<T> => useEntry(scope, true),
		refresh,
	};
}
