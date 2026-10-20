/**
 * The processes one root process started, which a session keeper (`src/keeper.ts`) stops with omp. omp's background
 * jobs, kernels, and subagents lead process groups or sessions of their own and are reparented once omp exits, so only
 * a note taken while omp is still their parent finds them; a process omp started since the last note escapes.
 */

/** Every process by pid, with its parent and start time. */
type ProcessTable = Map<number, { ppid: number; started: string }>;

/** Processes by pid, each with its start time, which tells it from a later process that reuses the pid. */
type Processes = Map<number, string>;

/** Every process now; `null` when `ps` failed. */
function processTable(): ProcessTable | null {
	const ps = Bun.spawnSync(["ps", "-A", "-o", "pid=,ppid=,lstart="]);
	if (!ps.success) return null;
	const table: ProcessTable = new Map();
	for (const line of ps.stdout.toString().split("\n")) {
		const [pid, ppid, ...started] = line.trim().split(/\s+/);
		if (pid && ppid && started.length > 0) table.set(Number(pid), { ppid: Number(ppid), started: started.join(" ") });
	}
	return table;
}

/** The processes under `root` in `table`, without `root`. */
function descendants(table: ProcessTable, root: number): Processes {
	const children = new Map<number, number[]>();
	for (const [pid, { ppid }] of table) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
	const found: Processes = new Map();
	const queue = [...(children.get(root) ?? [])];
	for (let pid = queue.shift(); pid !== undefined; pid = queue.shift()) {
		found.set(pid, table.get(pid)?.started ?? "");
		queue.push(...(children.get(pid) ?? []));
	}
	return found;
}

/** Sends `name` to `pid`, which may be gone already. */
function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {
		// Gone already.
	}
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
		this.#forgetGone(table);
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
			let listed = this.#forgetGone(processTable());
			for (const pid of this.#noted.keys()) signal(pid, "SIGTERM");
			const deadline = Date.now() + this.#times.graceMs;
			while ((this.#noted.size > 0 || !listed) && Date.now() < deadline) {
				await Bun.sleep(50);
				listed = this.#forgetGone(processTable());
			}
			for (const pid of this.#noted.keys()) signal(pid, "SIGKILL");
			if (!listed) console.error(`omp-agents keeper: ps failed, so these processes omp started may still run: ${[...this.#noted.keys()].join(" ")}`);
		})();
		return this.#reaping;
	}

	/** Forgets the noted processes `table` no longer lists under their start time; whether there was a table. */
	#forgetGone(table: ProcessTable | null): boolean {
		if (!table) return false;
		for (const [pid, started] of this.#noted) if (table.get(pid)?.started !== started) this.#noted.delete(pid);
		return true;
	}
}
