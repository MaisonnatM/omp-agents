import { useEffect, useSyncExternalStore } from "react";
import type { Inbox } from "../src/shared";
import { getJson } from "./api";

/** How often the open inbox asks again; the server answers from its cache in between. */
const POLL_MS = 60_000;

/** The last inbox read for each project scope, so a reopened inbox shows at once, even after a reload. */
const CACHE_KEY = "omp-agents.inbox-cache";

export interface InboxRead {
	inbox: Inbox;
	at: number;
}

/** One project scope's inbox: the last read, kept while a newer one loads, and how the latest attempt went. */
export interface InboxEntry {
	read: InboxRead | null;
	/** Why the latest attempt failed; cleared by the next success. */
	error: string | null;
	refreshing: boolean;
}

const EMPTY: InboxEntry = { read: null, error: null, refreshing: false };

function storedEntries(): Map<string, InboxEntry> {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
		if (typeof stored !== "object" || stored === null) return new Map();
		return new Map(
			Object.entries(stored).flatMap(([key, read]: [string, Partial<InboxRead>]) =>
				typeof read?.at === "number" && Array.isArray(read.inbox?.repos) && Array.isArray(read.inbox.unmatched)
					? [[key, { ...EMPTY, read: read as InboxRead }]]
					: [],
			),
		);
	} catch {
		return new Map();
	}
}

/** By project `cwd`, `""` for every project. */
const entries = storedEntries();
const listeners = new Set<() => void>();
let inflight: { key: string; controller: AbortController } | null = null;

function update(key: string, patch: Partial<InboxEntry>): void {
	entries.set(key, { ...(entries.get(key) ?? EMPTY), ...patch });
	for (const listener of listeners) listener();
}

function persist(): void {
	const reads = Object.fromEntries([...entries].flatMap(([key, { read }]) => (read ? [[key, read]] : [])));
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(reads));
	} catch {
		// Over quota: the inbox still shows from memory until the next reload.
	}
}

/** Reads `scope`'s inbox again, superseding any read in flight. `fresh` makes the server skip its own cache too. */
export async function refreshInbox(scope: string | null, fresh: boolean): Promise<void> {
	if (inflight) {
		inflight.controller.abort();
		update(inflight.key, { refreshing: false });
	}
	const current = { key: scope ?? "", controller: new AbortController() };
	inflight = current;
	update(current.key, { refreshing: true });
	const params = new URLSearchParams();
	if (scope !== null) params.set("cwd", scope);
	if (fresh) params.set("fresh", "");
	try {
		const inbox = await getJson<Inbox>(`/api/inbox${params.size ? `?${params}` : ""}`, current.controller.signal);
		update(current.key, { read: { inbox, at: Date.now() }, error: null, refreshing: false });
		persist();
	} catch (err) {
		if (!current.controller.signal.aborted) update(current.key, { error: err instanceof Error ? err.message : String(err), refreshing: false });
	} finally {
		if (inflight === current) inflight = null;
	}
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/**
 * `scope`'s inbox from the cache that the sidebar and the inbox page share. With `poll`, reads it again now and every
 * {@link POLL_MS} while mounted, showing the cached read meanwhile.
 */
export function useInbox(scope: string | null, poll: boolean): InboxEntry {
	const key = scope ?? "";
	useEffect(() => {
		if (!poll) return;
		void refreshInbox(scope, false);
		const timer = setInterval(() => void refreshInbox(scope, false), POLL_MS);
		return () => clearInterval(timer);
	}, [scope, poll]);
	return useSyncExternalStore(subscribe, () => entries.get(key) ?? EMPTY);
}
