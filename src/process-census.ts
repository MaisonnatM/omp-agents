/**
 * The processes one root process started, which a session keeper (`src/keeper.ts`) stops with omp. omp's background
 * jobs, kernels, and subagents lead process groups or sessions of their own and are reparented once omp exits, so only
 * a note taken while omp is still their parent finds them; a process omp started since the last note escapes.
 * The server's session process list (`src/server/session-processes.ts`) reads the same table, so this stays a leaf the keeper bundle loads.
 */

/** One process as `ps` lists it. */
export interface ProcessRow {
	pid: number;
	ppid: number;
	pgid: number;
	/** `ps`'s `lstart` in the C locale, such as `Thu Oct 23 11:21:58 2026`; with the pid it names the process. */
	started: string;
	/** Resident memory in KiB. */
	rssKb: number;
	/** `ps`'s `%cpu`: percent of one core, so a busy process can pass 100; on macOS a decaying average of recent use. */
	cpuPercent: number;
	/** The command line, as `ps` prints it. */
	command: string;
}

/** Every process by pid. */
export type ProcessTable = Map<number, ProcessRow>;

/** Processes by pid, each with its start time, which tells it from a later process that reuses the pid. */
export type Processes = Map<number, string>;

/** `ps` with the columns {@link parsePs} reads, and the locale that keeps `lstart` in English for `Date.parse` and `%cpu`'s decimal point a dot. */
export const PS_ARGV = ["ps", "-A", "-o", "pid=,ppid=,pgid=,rss=,pcpu=,lstart=,args="];
export const PS_ENV = { LC_ALL: "C" };

/**
 * omp's shared workers run a command with this prefix (omp's `cli/worker-selectors.ts`). omp spawns each detached under
 * whichever omp first needs it, and every other omp on the computer uses it after, so it is never that session's to stop.
 */
export const OMP_WORKER_PREFIX = "__omp_worker_";

const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s?(.*)$/;

/** The table `ps` printed with {@link PS_ARGV}; a line it cannot read is skipped. */
export function parsePs(text: string): ProcessTable {
	const table: ProcessTable = new Map();
	for (const line of text.split("\n")) {
		const match = PS_LINE.exec(line);
		if (!match) continue;
		const [, pid, ppid, pgid, rss, cpu, started, command] = match;
		table.set(Number(pid), {
			pid: Number(pid),
			ppid: Number(ppid),
			pgid: Number(pgid),
			started: started.split(/\s+/).join(" "),
			rssKb: Number(rss),
			cpuPercent: Number(cpu),
			command: command.trim(),
		});
	}
	return table;
}

/** `lsof` listing every TCP port this user's processes listen on, in the fields {@link parseListeners} reads. */
export const LISTENERS_ARGV = ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"];

/** The ports each pid listens on, sorted and unique, from {@link LISTENERS_ARGV}'s output: a `p<pid>` line, then an `n<address>:<port>` line per socket. */
export function parseListeners(text: string): Map<number, number[]> {
	const ports = new Map<number, Set<number>>();
	let pid: number | null = null;
	for (const line of text.split("\n")) {
		if (line.startsWith("p")) pid = Number(line.slice(1));
		else if (line.startsWith("n") && pid !== null) {
			const port = Number(line.slice(line.lastIndexOf(":") + 1));
			if (Number.isInteger(port) && port > 0) ports.set(pid, (ports.get(pid) ?? new Set()).add(port));
		}
	}
	return new Map([...ports].map(([each, set]) => [each, [...set].sort((a, b) => a - b)]));
}

/** Every process now; `null` when `ps` failed. */
function processTable(): ProcessTable | null {
	const ps = Bun.spawnSync(PS_ARGV, { env: { ...process.env, ...PS_ENV } });
	return ps.success ? parsePs(ps.stdout.toString()) : null;
}

/** The processes under `root` in `table`, without `root`, and without omp's shared workers and what they started. */
export function descendants(table: ProcessTable, root: number): Processes {
	const children = new Map<number, number[]>();
	for (const { pid, ppid } of table.values()) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
	const found: Processes = new Map();
	const queue = [...(children.get(root) ?? [])];
	for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
		const row = table.get(pid);
		if (!row || row.command.includes(OMP_WORKER_PREFIX)) continue;
		found.set(pid, row.started);
		queue.push(...(children.get(pid) ?? []));
	}
	return found;
}

/** A session's processes: omp with what shares its process group, its MCP servers, and each other process group under it, a job. */
export interface SessionGroups {
	omp: ProcessRow[];
	/** Each job's processes, by process group id. */
	jobs: Map<number, ProcessRow[]>;
}

/** The process groups under `root`, as {@link SessionGroups}; `null` when `table` does not list `root`. */
export function sessionGroups(table: ProcessTable, root: number): SessionGroups | null {
	const omp = table.get(root);
	if (!omp) return null;
	const groups: SessionGroups = { omp: [omp], jobs: new Map() };
	for (const pid of descendants(table, root).keys()) {
		const row = table.get(pid);
		if (!row) continue;
		if (row.pgid === omp.pgid) groups.omp.push(row);
		else groups.jobs.set(row.pgid, [...(groups.jobs.get(row.pgid) ?? []), row]);
	}
	return groups;
}

/** Sends `name` to `pid`, which may be gone already. */
function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {
		// Gone already.
	}
}

/** Forgets the processes `table` no longer lists under their start time; whether there was a table. */
function forgetGone(processes: Processes, table: ProcessTable | null): boolean {
	if (!table) return false;
	for (const [pid, started] of processes) if (table.get(pid)?.started !== started) processes.delete(pid);
	return true;
}

/**
 * Stops `processes`: SIGTERM, then SIGKILL after `graceMs` to those `ps` still lists under the start time they had, so
 * a pid that a later process reuses is never signalled. Settles once none runs, or at the grace's end. `read` lists the
 * processes; the server passes one that runs `ps` without blocking.
 */
export async function terminate(processes: Processes, graceMs: number, read: () => ProcessTable | null | Promise<ProcessTable | null> = processTable): Promise<void> {
	let listed = forgetGone(processes, await read());
	for (const pid of processes.keys()) signal(pid, "SIGTERM");
	const deadline = Date.now() + graceMs;
	while ((processes.size > 0 || !listed) && Date.now() < deadline) {
		await Bun.sleep(50);
		listed = forgetGone(processes, await read());
	}
	for (const pid of processes.keys()) signal(pid, "SIGKILL");
	if (!listed) console.error(`omp-agents: ps failed, so these processes may still run: ${[...processes.keys()].join(" ")}`);
}

/** Stops `root` and every process under it now, as one `ps` finds them, by {@link terminate}. */
export async function stopTree(root: number, graceMs: number): Promise<void> {
	const table = processTable();
	if (!table) return void console.error(`omp-agents: ps failed, so process ${root} and what it started may still run`);
	const started = table.get(root)?.started;
	const tree: Processes = new Map(started === undefined ? [] : [[root, started]]);
	for (const [pid, at] of descendants(table, root)) tree.set(pid, at);
	await terminate(tree, graceMs);
}

export interface CensusTimes {
	/** How often the census notes the processes under the root on its own. */
	everyMs: number;
	/** How long {@link ProcessCensus.noteSoon} waits, so a burst of calls costs one `ps`. */
	soonMs: number;
	/** How long a reaped process gets to exit on SIGTERM before SIGKILL. */
	graceMs: number;
}

export class ProcessCensus {
	readonly #root: number;
	readonly #times: CensusTimes;
	/** The processes seen under the root, as last seen. */
	readonly #noted: Processes = new Map();
	readonly #every: NodeJS.Timeout;
	#soon: NodeJS.Timeout | undefined;
	#reaping: Promise<void> | null = null;

	constructor(root: number, times: CensusTimes) {
		this.#root = root;
		this.#times = times;
		this.#every = setInterval(() => this.note(), times.everyMs);
	}

	/** Notes the processes under the root now, and forgets the noted ones that are gone; whether `ps` answered. */
	note(): boolean {
		const table = processTable();
		if (!table) return false;
		forgetGone(this.#noted, table);
		for (const [pid, started] of descendants(table, this.#root)) this.#noted.set(pid, started);
		return true;
	}

	/** Notes them in a moment, as an async tool call starts its background job just after it returns. */
	noteSoon(): void {
		if (this.#reaping) return;
		this.#soon ??= setTimeout(() => {
			this.#soon = undefined;
			this.note();
		}, this.#times.soonMs);
	}

	/**
	 * Stops noting, and stops every noted process: SIGTERM, then SIGKILL to those left after the grace. It goes by the
	 * noted set alone, which is all a root that exited leaves to find them by. Settles once none runs.
	 */
	reap(): Promise<void> {
		this.#reaping ??= (async () => {
			clearInterval(this.#every);
			clearTimeout(this.#soon);
			await terminate(this.#noted, this.#times.graceMs);
		})();
		return this.#reaping;
	}
}
