/** omp's isolation sandboxes and daemon brokers (pi-coding-agent src/task, src/cli, src/launch; pi-tui). */

/** omp's task-isolation ownership (src/task/isolation-ownership.ts): the marker a sandbox holds, and whether its omp process still runs. */
export interface IsolationOwnershipModule {
	ISOLATION_OWNER_FILE: string;
	hasLiveIsolationOwner(baseDir: string): Promise<boolean>;
}
/** `omp worktree` (src/cli/worktree-cli.ts): the native teardown a retained sandbox's mount needs before removal; throws when it cannot run it. */
export interface WorktreeCliModule {
	stopRetainedMount(dir: string): Promise<boolean>;
}
/** omp's ovnfs-backed isolation (src/task/ovnfs.ts): the name of the record of the ovnfs checkout a sandbox stands for. */
export interface OvnfsTaskModule {
	OVNFS_CHECKOUT_FILE: string;
}
/** The ovnfs daemons omp knows (src/ovnfs/daemon.ts), one per ovnfs command. */
export interface OvnfsDaemonModule {
	/** The daemon `command` runs, without starting one; `undefined` when none answers. */
	runningDaemon(command: string): Promise<{ socket: string; mount: string } | undefined>;
	/** Forgets `command`'s daemon after its socket stopped answering, so the next call asks the command again. */
	forgetDaemon(command: string): void;
}
/** ovnfs's admin socket client (src/ovnfs/client.ts): rejects with an `OvnfsError` for an error the daemon reports, with the socket's error when it cannot connect. */
export interface OvnfsClientModule {
	/** The daemon's reply to `op`, unchecked: `ls` answers ovnfs's `api.LsReply`. */
	callSocket(socket: string, op: "ls" | "rm", args: object): Promise<unknown>;
	/** `code` is the daemon's, such as `not_found` for a checkout it does not have. */
	OvnfsError: abstract new (...args: never[]) => Error & { readonly code: string };
}
/** A daemon broker's scope (pi-tui src/apps/ps-data.ts `PsScope`): a project's runtime directory, or a machine-wide service's. */
export interface DaemonScope {
	kind: "project" | "global";
	runtimeDir: string;
	/** The canonical project directory, once the broker named it. */
	projectDir?: string;
	service?: string;
	brokerPid?: number;
}
/** One daemon a broker runs or ran (pi-tui src/tools/daemon.ts `DaemonSnapshot`), with the fields the dashboard reads. */
export interface DaemonSnapshot {
	name: string;
	/** The generation: a restart under the same name gets another. */
	id: string;
	state: "starting" | "running" | "ready" | "restarting" | "stopping" | "exited" | "failed";
	pid?: number;
	/** In ms since the epoch. */
	startedAt: number;
	/** The omp session id of the session that started it; omp's shared browser has none. */
	owner?: string;
}
/** A broker scope's daemons (pi-tui src/apps/ps-data.ts `PsScopeReport`); `supervised` is false for a record a dead broker left on disk. */
export interface DaemonReport {
	scope: DaemonScope;
	daemons: { snapshot: DaemonSnapshot; command?: string; supervised: boolean }[];
}
/** `omp ps` (src/cli/ps-data.ts): every broker scope's daemons, without spawning a broker, and a client of one scope's broker. */
export interface PsDataModule {
	collectReports(all: boolean, target: { dir?: string; global?: string }): Promise<DaemonReport[]>;
	scopeClient(scope: DaemonScope): Promise<{ request(operation: { op: "stop"; name: string; id?: string; timeoutMs: number }): Promise<unknown>; close(): void }>;
}
/** `omp ps`'s table (pi-tui src/apps/ps-data.ts): the daemon states with no process behind them. */
export interface PsTableModule {
	TERMINAL_STATES: Partial<Record<DaemonSnapshot["state"], true>>;
}
/** The daemon broker's paths (src/launch/paths.ts): the project directory a broker scope is keyed by. */
export interface LaunchPathsModule {
	canonicalProjectDir(dir: string): Promise<string>;
}
/**
 * A daemon to start (pi-tui src/tools/daemon.ts `DaemonSpec`), never restarted, kept, or detached. It is ready once
 * `ready.port` accepts a connection on 127.0.0.1.
 */
export interface DaemonSpec {
	name: string;
	application: string;
	args: string[];
	env: Record<string, string>;
	cwd: string;
	pty: boolean;
	ready: { port: number; timeoutMs: number };
	restart: "no";
	persist: false;
	detached: false;
}
/** A connection to one project's daemon broker (src/launch/client.ts `DaemonBrokerClient`), with the operations the dashboard sends. */
export interface DaemonBrokerClient {
	request(operation: { op: "start"; spec: DaemonSpec; owner: string; replace: true; awaitReady: true }): Promise<{ op: "start"; daemon: DaemonSnapshot; readyTimedOut: boolean }>;
	request(operation: {
		op: "logs";
		name: string;
		lines: number;
		head: false;
		follow: false;
		renderTerminalRows: true;
		timeoutMs: number;
	}): Promise<{ op: "logs"; text: string; terminalRows?: string[] }>;
	close(): void;
}
/** The daemon broker's client (src/launch/client.ts): a connection to the broker of the project `projectDir` is in, which it starts when none runs. */
export interface LaunchClientModule {
	createDaemonBrokerClient(projectDir: string): Promise<DaemonBrokerClient>;
}
