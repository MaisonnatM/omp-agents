import type { PolledEntry } from "./polled-store";

/** What Get started shows: its dialog, its bottom-right bubble, or nothing. */
export type GetStartedSurface = "dialog" | "bubble" | "none";

/** A setup fact as Get started knows it: read, unreadable with why, or not answered yet. */
export type Observation<T> = { kind: "known"; value: T } | { kind: "unavailable"; message: string } | { kind: "checking" };

export const CHECKING = { kind: "checking" } as const;

/** A polled store's entry as a fact: its error, else its read, else still checking. */
export function observation<T>(entry: PolledEntry<T>): Observation<T> {
	if (entry.error) return { kind: "unavailable", message: entry.error };
	return entry.read ? { kind: "known", value: entry.read.data } : CHECKING;
}

/** Whether `fact` is known and `done` holds for its value. */
export const known = <T>(fact: Observation<T>, done: (value: T) => boolean): boolean => fact.kind === "known" && done(fact.value);

/** `fact` with `map` applied to its value once known; checking and unavailable stay as they are. */
export const mapKnown = <T, U>(fact: Observation<T>, map: (value: T) => U): Observation<U> => (fact.kind === "known" ? { kind: "known", value: map(fact.value) } : fact);

export interface SessionFacts {
	/** Live sessions on the roster. */
	hosts: number;
	/** Past sessions the session files list. */
	past: number;
	/** The roster has answered once. */
	listed: boolean;
	connected: boolean;
	rosterError: string | null;
}

/** Whether a session has ever run here: any live or past one settles it; an empty roster counts only once it answered over a live connection. */
export function firstSessionFact({ hosts, past, listed, connected, rosterError }: SessionFacts): Observation<boolean> {
	if (hosts > 0 || past > 0) return { kind: "known", value: true };
	if (rosterError) return { kind: "unavailable", message: rosterError };
	if (!connected) return { kind: "unavailable", message: "Waiting for the dashboard to reconnect before checking sessions." };
	return listed ? { kind: "known", value: false } : CHECKING;
}

export interface GetStartedFacts {
	/** The URL names `#get-started`. */
	route: boolean;
	/** No page or pane shows. */
	vacantHome: boolean;
	dismissed: boolean;
	/** The dialog was closed once on this computer. */
	minimized: boolean;
	requiredDone: boolean;
	/** The provider count and the first-session fact have answered. */
	settled: boolean;
}

export function getStartedSurface({ route, vacantHome, dismissed, minimized, requiredDone, settled }: GetStartedFacts): GetStartedSurface {
	if (route) return "dialog";
	if (dismissed || requiredDone || !settled) return "none";
	return vacantHome && !minimized ? "dialog" : "bubble";
}
