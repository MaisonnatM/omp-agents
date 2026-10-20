/**
 * What a session keeper (`src/keeper.ts`) and the server's side of it (`src/keeper-link.ts`) say to each other besides
 * omp's own frames. A leaf, so the keeper's bundle holds none of the server's code.
 */

export const HELLO = "omp_agents_keeper";

/** What the server tells a keeper when it starts it, which every connection hands back. */
export interface KeeperMeta {
	/** When the session started. */
	startedAt: number;
	/** The directory omp started in, before its session file records one. */
	cwd: string;
}

/** The first line a keeper sends on each connection; `meta` is what the server passed it at the start. */
export interface KeeperHello {
	type: typeof HELLO;
	/** omp's pid. */
	pid: number;
	meta: unknown;
}

/**
 * Where the keeper listening on `socket` records its pid, written before it listens: a keeper that accepts and never
 * greets tells no pid, and the server stops it by this one.
 */
export const pidFileOf = (socket: string): string => socket.replace(/\.sock$/, ".pid");

/** The line a client sends to end the session: the keeper stops omp, and exits once omp did. */
export const STOP = { type: "omp_agents_keeper_stop" } as const;
