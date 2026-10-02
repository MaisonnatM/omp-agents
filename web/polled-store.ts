import { useEffect, useSyncExternalStore } from "react";
import { getJson } from "./api";

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
	/** The API path that reads `key`; `fresh` makes the server skip its own cache too. */
	url: (key: string, fresh: boolean) => string;
	/** Whether a value read back from localStorage has the shape of `T`. */
	isValid: (value: unknown) => value is T;
}

/**
 * A store of server reads by key that the sidebar and a page share, kept in localStorage and re-read while a page that
 * uses it is open. The key names what the read is about, such as a project; a read about everything uses `""`.
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
	const listeners = new Set<() => void>();
	let inflight: { key: string; controller: AbortController } | null = null;

	function update(key: string, patch: Partial<PolledEntry<T>>): void {
		entries.set(key, { ...(entries.get(key) ?? empty), ...patch });
		for (const listener of listeners) listener();
	}

	function persist(): void {
		const reads = Object.fromEntries([...entries].flatMap(([key, { read }]) => (read ? [[key, read]] : [])));
		try {
			localStorage.setItem(cacheKey, JSON.stringify(reads));
		} catch {
			// Over quota: the reads still show from memory until the next reload.
		}
	}

	/** Reads `key` again, superseding any read in flight. */
	async function refresh(key: string, fresh: boolean): Promise<void> {
		if (inflight) {
			inflight.controller.abort();
			update(inflight.key, { refreshing: false });
		}
		const current = { key, controller: new AbortController() };
		inflight = current;
		update(key, { refreshing: true });
		try {
			const data = await getJson<T>(url(key, fresh), current.controller.signal);
			update(key, { read: { data, at: Date.now() }, error: null, refreshing: false });
			persist();
		} catch (err) {
			if (!current.controller.signal.aborted) update(key, { error: err instanceof Error ? err.message : String(err), refreshing: false });
		} finally {
			if (inflight === current) inflight = null;
		}
	}

	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	/** `key`'s entry. With `poll`, reads it again now and every {@link POLL_MS} while mounted, showing the kept read meanwhile. */
	function use(key: string, poll: boolean): PolledEntry<T> {
		useEffect(() => {
			if (!poll) return;
			void refresh(key, false);
			const timer = setInterval(() => void refresh(key, false), POLL_MS);
			return () => clearInterval(timer);
		}, [key, poll]);
		return useSyncExternalStore(subscribe, () => entries.get(key) ?? empty);
	}

	return { use, refresh };
}
