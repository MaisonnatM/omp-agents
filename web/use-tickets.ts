import { useEffect, useSyncExternalStore } from "react";
import type { TicketsAnswer } from "../src/shared";
import { getJson } from "./api";

/** How often the open tickets page asks again; the server answers from its cache in between. */
const POLL_MS = 60_000;

/** The last tickets read, so a reopened page shows at once, even after a reload. Linear is not per project, so there is one. */
const CACHE_KEY = "omp-agents.tickets-cache";

export interface TicketsRead {
	answer: TicketsAnswer;
	at: number;
}

/** The last read, kept while a newer one loads, and how the latest attempt went. */
export interface TicketsEntry {
	read: TicketsRead | null;
	/** Why the latest request failed; cleared by the next success. An answer's own error is in `read`. */
	error: string | null;
	refreshing: boolean;
}

function storedRead(): TicketsRead | null {
	try {
		const read: Partial<TicketsRead> | null = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
		const answer = read?.answer;
		const valid = typeof read?.at === "number" && typeof answer === "object" && answer !== null && ("tickets" in answer ? Array.isArray(answer.tickets) : typeof answer.error === "string");
		return valid ? (read as TicketsRead) : null;
	} catch {
		return null;
	}
}

let entry: TicketsEntry = { read: storedRead(), error: null, refreshing: false };
const listeners = new Set<() => void>();
let inflight: AbortController | null = null;

function update(patch: Partial<TicketsEntry>): void {
	entry = { ...entry, ...patch };
	for (const listener of listeners) listener();
}

/** Reads the tickets again, superseding any read in flight. `fresh` makes the server skip its own cache too. */
export async function refreshTickets(fresh: boolean): Promise<void> {
	inflight?.abort();
	const controller = new AbortController();
	inflight = controller;
	update({ refreshing: true });
	try {
		const answer = await getJson<TicketsAnswer>(`/api/tickets${fresh ? "?fresh" : ""}`, controller.signal);
		const read = { answer, at: Date.now() };
		update({ read, error: null, refreshing: false });
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify(read));
		} catch {
			// Over quota: the tickets still show from memory until the next reload.
		}
	} catch (err) {
		if (!controller.signal.aborted) update({ error: err instanceof Error ? err.message : String(err), refreshing: false });
	} finally {
		if (inflight === controller) inflight = null;
	}
}

const subscribe = (listener: () => void): (() => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/**
 * The tickets from the cache that the sidebar and the tickets page share. With `poll`, reads them again now and every
 * {@link POLL_MS} while mounted, showing the cached read meanwhile.
 */
export function useTickets(poll: boolean): TicketsEntry {
	useEffect(() => {
		if (!poll) return;
		void refreshTickets(false);
		const timer = setInterval(() => void refreshTickets(false), POLL_MS);
		return () => clearInterval(timer);
	}, [poll]);
	return useSyncExternalStore(subscribe, () => entry);
}
