/** omp's isolation sandboxes and its per-user daemon (pi-coding-agent src/task, src/ovnfs, src/daemon; pi-tui; pi-natives). */

/** omp's task-isolation ownership (src/task/isolation-ownership.ts): the marker a sandbox holds, whether its omp process still runs, and the native backend a retained mount needs stopped. */
export interface IsolationOwnershipModule {
	ISOLATION_OWNER_FILE: string;
	hasLiveIsolationOwner(baseDir: string): Promise<boolean>;
	/** The backend of a retained mount that needs native teardown, `undefined` with none; throws on a malformed record. */
	readRetainedMountBackend(dir: string): Promise<number | undefined>;
}
/** pi-natives (native/index.js): the native teardown of an isolation backend mounted at `merged`. */
export interface IsolationNativesModule {
	isoStop(kind: number, merged: string): Promise<void>;
}
/** omp's ovnfs task records (src/ovnfs/task-record.ts): the name of the record of the ovnfs checkout a sandbox stands for. */
export interface OvnfsTaskModule {
	OVNFS_CHECKOUT_FILE: string;
}
/** ovnfs's admin socket client (src/ovnfs/client.ts): rejects with an `OvnfsError` for an error the daemon reports, with the socket's error when it cannot connect. */
export interface OvnfsClientModule {
	/** The daemon's reply to `op`, unchecked: `ls` answers ovnfs's `api.LsReply`. */
	callSocket(socket: string, op: "ls" | "rm", args: object): Promise<unknown>;
	/** `code` is the daemon's, such as `not_found` for a checkout it does not have. */
	OvnfsError: abstract new (...args: never[]) => Error & { readonly code: string };
	/** The admin protocol omp speaks; `ovnfs --json status` reports the daemon's as `version`. */
	PROTOCOL_VERSION: number;
}
/** Where a unit sits on omp's daemon board (pi-tui src/tools/daemon.ts `UnitScope`); a label, never a separate daemon. */
export type UnitScope = { kind: "global" } | { kind: "project"; dir: string } | { kind: "session"; id: string };
/** A unit's state (pi-tui src/tools/daemon.ts `DaemonState`). */
export type UnitState = "starting" | "running" | "ready" | "restarting" | "stopping" | "exited" | "failed";
/** One unit of omp's daemon (pi-tui src/tools/daemon.ts `UnitSnapshot`), with the fields the dashboard reads. */
export interface UnitSnapshot {
	/** Stable for the unit's lifetime. */
	id: string;
	/** `proc` for a service, omp's shared browser included. */
	kind: string;
	scope: UnitScope;
	/** The service name of a `proc` unit. */
	key: string;
	/** Changes on every (re)launch, so a stop can target one. */
	generation: string;
	state: UnitState;
	/** Every process the unit owns, main one first. */
	pids: number[];
	/** In ms since the epoch. */
	startedAt: number;
	/** The omp session id of the session that started it; omp's shared browser has none. */
	owner?: string;
	command?: string;
	/** False for a unit the daemon cannot wait on, such as one read from its store while no daemon runs. */
	supervised: boolean;
}
/**
 * A command a `proc` unit runs (pi-tui src/tools/daemon.ts `ProcSpec`). It is ready once `ready.port` accepts a connection
 * on 127.0.0.1.
 */
export interface ProcSpec {
	application: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	pty: boolean;
	ready: { port: number; timeoutMs: number };
}
/** A connection to omp's daemon (src/daemon/protocol.ts `DaemonClient`), with the operations the dashboard sends. */
export interface DaemonClient {
	request(operation: { op: "list"; kind: "proc" }): Promise<{ units: UnitSnapshot[] }>;
	request(operation: { op: "stop"; unit: string; generation: string; timeoutMs: number }): Promise<{ unit: UnitSnapshot }>;
	request(operation: {
		op: "open";
		kind: "proc";
		scope: UnitScope;
		key: string;
		label: string;
		proc: ProcSpec;
		/** Runs until stopped, never restarted, carried across a daemon upgrade. */
		policy: { hold: "persist"; restart: "no"; survive: "exec" };
		owner: string;
		replace: true;
		awaitReady: true;
		lease: false;
	}): Promise<{ unit: UnitSnapshot }>;
	request(operation: { op: "logs"; unit: string; lines: number; head: false; follow: false; timeoutMs: number }): Promise<{ text: string; terminalOutput: string }>;
	close(): void;
}
/** The daemon's client (src/daemon/client.ts). */
export interface DaemonClientModule {
	/** The process-wide connection, which starts the daemon when none runs and reconnects; never close it. */
	daemonClient(): Promise<DaemonClient>;
	/** A connection to a daemon that already runs, `undefined` when none answers; the caller closes it. */
	probeDaemon(): Promise<DaemonClient | undefined>;
	/** The directory a project scope names for `dir`. */
	canonicalProjectDir(dir: string): Promise<string>;
}
/** `omp ps`'s table (pi-tui src/apps/ps-data.ts): the unit states with no process behind them. */
export interface PsTableModule {
	TERMINAL_STATES: Partial<Record<UnitState, true>>;
}
