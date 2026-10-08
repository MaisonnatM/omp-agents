import { useEffect } from "react";
import { errorText, getJson } from "./api";
import { keyedStore } from "./keyed-store";

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

	function storedEntries(): Map<string, PolledRead<T>> {
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(cacheKey) ?? "{}");
			if (typeof stored !== "object" || stored === null) return new Map();
			return new Map(
				Object.entries(stored).flatMap(([key, read]: [string, Partial<PolledRead<T>> | null]) =>
					typeof read?.at === "number" && isValid(read.data) ? [[key, read as PolledRead<T>]] : [],
				),
			);
		} catch {
			return new Map();
		}
	}

	const cached = storedEntries();
	const entries = keyedStore(empty);
	for (const [key, read] of cached) entries.set(key, { ...empty, read });
	/** The read of each scope in flight, by key. */
	const inflight = new Map<string, AbortController>();
	/** The timer of each scope that a mounted component polls, and how many components share it. */
	const pollers = new Map<string, { callers: number; timer: ReturnType<typeof setInterval> }>();

	function update(key: string, patch: Partial<PolledEntry<T>>): void {
		entries.set(key, { ...entries.get(key), ...patch });
	}

	function persist(): void {
		const reads = Object.fromEntries(cached);
		try {
			localStorage.setItem(cacheKey, JSON.stringify(reads));
		} catch {
			// Over quota: the reads still show from memory until the next reload.
		}
	}

	/** Reads `scope` again, superseding a read of the same scope in flight; reads of other scopes run on. */
	async function refresh(scope: string | null = null, { fresh = false }: { fresh?: boolean } = {}): Promise<void> {
		const key = scope ?? "";
		inflight.get(key)?.abort();
		const controller = new AbortController();
		inflight.set(key, controller);
		update(key, { refreshing: true });
		try {
			const data = await getJson<T>(url(scope, fresh), controller.signal);
			if (controller.signal.aborted) return;
			const read = { data, at: Date.now() };
			update(key, { read, error: null, refreshing: false });
			cached.set(key, read);
			persist();
		} catch (err) {
			if (!controller.signal.aborted) update(key, { error: errorText(err), refreshing: false });
		} finally {
			if (inflight.get(key) === controller) inflight.delete(key);
		}
	}

	/**
	 * Reads `scope` now and every {@link POLL_MS} until the returned function is called. Callers of the same scope share
	 * one timer: the first starts it, and the last to stop clears it.
	 */
	function poll(scope: string | null = null): () => void {
		const key = scope ?? "";
		const running = pollers.get(key);
		if (running) {
			running.callers += 1;
		} else {
			void refresh(scope);
			pollers.set(key, { callers: 1, timer: setInterval(() => void refresh(scope), POLL_MS) });
		}
		return () => {
			const poller = pollers.get(key);
			if (!poller || --poller.callers > 0) return;
			clearInterval(poller.timer);
			pollers.delete(key);
		};
	}

	function useEntry(scope: string | null, polling: boolean): PolledEntry<T> {
		useEffect(() => (polling ? poll(scope) : undefined), [scope, polling]);
		return entries.use(scope ?? "");
	}

	return {
		/** `scope`'s entry, as the store last read it. */
		use: (scope: string | null = null): PolledEntry<T> => useEntry(scope, false),
		/** `scope`'s entry, read again now and every {@link POLL_MS} while mounted and `enabled`, showing the kept read meanwhile. */
		usePolling: (scope: string | null = null, enabled = true): PolledEntry<T> => useEntry(scope, enabled),
		poll,
		refresh,
	};
}
