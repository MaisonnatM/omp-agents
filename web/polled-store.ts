import { useEffect } from "react";
import { isObject } from "../src/json";
import { errorText } from "../src/json";
import { getJson } from "./api";
import { keyedStore } from "./keyed-store";

/** How often an open page asks again by default; the server answers from its cache in between. */
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
	/** The API path that reads `scope`; `fresh` makes the server skip its own cache too. */
	url: (scope: string | null, fresh: boolean) => string;
	/** Keeps reads in localStorage, each through `decode` when the page loads, which answers `null` for a read kept in another shape; omitted for memory-only stores. */
	cache?: { key: string; decode: (raw: unknown) => T | null };
	/** How often a mounted component reads again; {@link POLL_MS} when omitted. */
	pollMs?: number;
}

/** One polled scope's timer, how many mounted components share it, and whether a tick fell while the page was hidden. */
interface Poller {
	scope: string | null;
	callers: number;
	missed: boolean;
	timer: ReturnType<typeof setInterval>;
}

/**
 * A store of server reads by scope that the sidebar and a page share, optionally kept in localStorage and re-read
 * while a page that uses it is open. The scope names what the read is about, such as a workspace; it is `null`
 * for a read about everything, or in a store with one entry. Entries and their cache hold `null` under `""`.
 */
export function createPolledStore<T>({ url, cache, pollMs = POLL_MS }: PolledStoreOptions<T>) {
	const empty: PolledEntry<T> = { read: null, error: null, refreshing: false };

	function storedEntries(): Map<string, PolledRead<T>> {
		if (!cache) return new Map();
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(cache.key) ?? "{}");
			if (!isObject(stored)) return new Map();
			return new Map(
				Object.entries(stored).flatMap(([key, read]): [string, PolledRead<T>][] => {
					if (!isObject(read) || typeof read.at !== "number") return [];
					const data = cache.decode(read.data);
					return data === null ? [] : [[key, { data, at: read.at }]];
				}),
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
	/** Each polled scope's poller, by key. */
	const pollers = new Map<string, Poller>();

	function update(key: string, patch: Partial<PolledEntry<T>>): void {
		entries.set(key, { ...entries.get(key), ...patch });
	}

	function persist(): void {
		if (!cache) return;
		const reads = Object.fromEntries(cached);
		try {
			localStorage.setItem(cache.key, JSON.stringify(reads));
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
			if (cache) cached.set(key, read);
			persist();
		} catch (err) {
			if (!controller.signal.aborted) update(key, { error: errorText(err), refreshing: false });
		} finally {
			if (inflight.get(key) === controller) inflight.delete(key);
		}
	}

	/** Reads `scope` if no read has been kept and no request is in flight yet; nothing otherwise. */
	function ensure(scope: string | null = null): void {
		const key = scope ?? "";
		if (entries.get(key).read !== null || inflight.has(key)) return;
		refresh(scope).catch(err => console.error(err));
	}

	/** Applies a saved change to the current answer, superseding any read begun before it. */
	function changeAnswer(change: (data: T) => T, scope: string | null = null): void {
		const key = scope ?? "";
		const current = entries.get(key).read;
		if (!current) return;
		inflight.get(key)?.abort();
		inflight.delete(key);
		const read = { data: change(current.data), at: Date.now() };
		update(key, { read, error: null, refreshing: false });
		if (cache) cached.set(key, read);
		persist();
	}

	/** Reads each polled scope whose tick the hidden page skipped, once the page shows again. */
	function resume(): void {
		if (document.hidden) return;
		for (const poller of pollers.values()) {
			if (!poller.missed) continue;
			poller.missed = false;
			void refresh(poller.scope);
		}
	}

	/**
	 * Reads `scope` now and every `pollMs` until the returned function is called. Callers of the same scope share
	 * one timer: the first starts it, and the last to stop clears it. A tick while the page is hidden reads nothing,
	 * and the page reads that scope once when it shows again.
	 */
	function poll(scope: string | null = null): () => void {
		const key = scope ?? "";
		const running = pollers.get(key);
		if (running) {
			running.callers += 1;
		} else {
			void refresh(scope);
			if (pollers.size === 0) document.addEventListener("visibilitychange", resume);
			const poller: Poller = { scope, callers: 1, missed: false, timer: setInterval(() => {
				if (document.hidden) poller.missed = true;
				else void refresh(scope);
			}, pollMs) };
			pollers.set(key, poller);
		}
		return () => {
			const poller = pollers.get(key);
			if (!poller || --poller.callers > 0) return;
			clearInterval(poller.timer);
			pollers.delete(key);
			if (pollers.size === 0) document.removeEventListener("visibilitychange", resume);
		};
	}

	function useEntry(scope: string | null, polling: boolean): PolledEntry<T> {
		useEffect(() => (polling ? poll(scope) : undefined), [scope, polling]);
		return entries.use(scope ?? "");
	}

	return {
		/** `scope`'s entry, as the store last read it. */
		use: (scope: string | null = null): PolledEntry<T> => useEntry(scope, false),
		/** `scope`'s entry, read again now and every `pollMs` while mounted and `enabled`, showing the kept read meanwhile. */
		usePolling: (scope: string | null = null, enabled = true): PolledEntry<T> => useEntry(scope, enabled),
		poll,
		refresh,
		update: changeAnswer,
		ensure,
	};
}
