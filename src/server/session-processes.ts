/**
 * What each live session runs besides omp: its jobs, the process groups under its omp, and its services, the daemons
 * omp's project broker runs for it. The watch lists them, stops one on request, stops the ones every session they serve
 * left idle for the setting's minutes, and stops what a session that left the roster leaves behind. Every stop of a
 * session's processes goes through it; `docs/architecture/session-processes.md` says what counts and why.
 */
import type { DaemonReport, DaemonScope } from "../omp/modules";
import { run } from "../proc";
import { descendants, LISTENERS_ARGV, parseListeners, parsePs, PS_ARGV, PS_ENV, type Processes, type ProcessRow, type ProcessTable, sessionGroups, terminate } from "../process-census";
import { SerialLane } from "../serial-lane";
import type { LiveSessionProcesses, SessionProcess, SessionProcesses } from "../shared/processes";
import type { HostStatus } from "../shared/sessions";
import { errorText } from "../json";

/** How long a stopped job gets to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;

/** A live session, as the roster has it. */
export interface WatchedSession {
	instanceId: string;
	/** omp's session id, which a daemon names as its owner. */
	sessionId: string;
	/** omp's pid. */
	pid: number;
	cwd: string;
	status: HostStatus;
}

export interface SessionProcessWatchDeps {
	/** Every process now; `null` when `ps` failed. */
	readTable(): Promise<ProcessTable | null>;
	/** The TCP ports each process listens on, by pid; `null` when `lsof` failed. */
	readPorts(): Promise<Map<number, number[]> | null>;
	/** The daemons every broker scope runs now, without the ones that ended or that no live broker supervises. */
	readDaemons(): Promise<DaemonReport[]>;
	/** The project directory a broker scope names for `cwd`. */
	projectDir(cwd: string): Promise<string>;
	/** Stops generation `id` of daemon `name`. */
	stopService(scope: DaemonScope, name: string, id: string): Promise<void>;
	/** Stops each process that still runs under the start time it is listed with. */
	stopProcesses(processes: Processes): Promise<void>;
	sessions(): WatchedSession[];
	now(): number;
	/** This server holds the owner lock, so it stops processes no one asked it to. */
	owner(): boolean;
	stopIdleAfterMinutes(): number | null;
}

type Target = { kind: "job"; members: Processes } | { kind: "service"; scope: DaemonScope; name: string; daemonId: string };

/** A listed process, with what stops it and the sessions whose idleness lets the idle stop end it. */
interface Item extends SessionProcess {
	target: Target;
	serves: WatchedSession[];
}

/** One live session's processes, as a sample found them. */
interface Found {
	omp: SessionProcesses["omp"];
	items: Item[];
}

/** What a sample found, by instance id, in roster order. */
type Sample = Map<string, Found>;

/** What a session that leaves the roster is cleaned up by. */
interface Seen {
	/** Every omp session id it ran, since `/new` keeps the instance and changes the id its services name as owner. */
	owners: Set<string>;
	/** omp, by pid and start time; `null` when `ps` did not list it. */
	omp: { pid: number; started: string } | null;
	/** Every process of its jobs, as last seen. */
	jobs: Processes;
}

const memoryOf = (rows: ProcessRow[]): number => rows.reduce((sum, row) => sum + row.rssKb * 1024, 0);
const cpuOf = (rows: ProcessRow[]): number => rows.reduce((sum, row) => sum + row.cpuPercent, 0);

export class SessionProcessWatch {
	readonly #deps: SessionProcessWatchDeps;
	readonly #lane = new SerialLane();
	/** Since when each live session has been idle; now while it is anything else. */
	readonly #idleSince = new Map<string, number>();
	/** Each live session, and each gone one whose omp still ran at the last sample, by instance id. */
	#seen = new Map<string, Seen>();

	constructor(deps: SessionProcessWatchDeps) {
		this.#deps = deps;
	}

	/** Samples, which runs the idle stop and the cleanup when this server owns them. */
	async tick(): Promise<void> {
		await this.#lane.run(() => this.#sample());
	}

	/** Every live session's processes now, in roster order. */
	list(): Promise<LiveSessionProcesses[]> {
		return this.#lane.run(async () => answerOf(await this.#sample()));
	}

	/** Stops session `instanceId`'s process `id`, unless either no longer runs, and answers what every live session runs after. */
	stop(instanceId: string, id: string): Promise<LiveSessionProcesses[]> {
		return this.#lane.run(async () => {
			const item = (await this.#sample()).get(instanceId)?.items.find(each => each.id === id);
			if (item) await this.#stopTarget(item.target);
			return answerOf(await this.#sample());
		});
	}

	async #sample(): Promise<Sample> {
		const sessions = this.#deps.sessions();
		const [table, reports, projectDirs, listeners] = await Promise.all([
			this.#deps.readTable(),
			this.#deps.readDaemons(),
			Promise.all(sessions.map(session => this.#deps.projectDir(session.cwd))),
			this.#deps.readPorts(),
		]);
		if (!table) throw new Error("ps failed, so no session's processes are known");
		const portsOf = (rows: ProcessRow[]): number[] => [...new Set(rows.flatMap(row => listeners?.get(row.pid) ?? []))].sort((a, b) => a - b);
		const now = this.#deps.now();
		const owner = this.#deps.owner();
		const timeout = this.#deps.stopIdleAfterMinutes();
		const live = new Set(sessions.map(session => session.instanceId));
		for (const id of this.#idleSince.keys()) if (!live.has(id)) this.#idleSince.delete(id);
		for (const session of sessions) this.#idleSince.set(session.instanceId, session.status === "idle" ? (this.#idleSince.get(session.instanceId) ?? now) : now);

		const previous = this.#seen;
		this.#seen = new Map();
		const found: Sample = new Map();
		for (const session of sessions) {
			const groups = sessionGroups(table, session.pid);
			const jobs = groups ? [...groups.jobs].map(([pgid, rows]) => jobItem(session, pgid, rows, portsOf(rows))) : [];
			const ompRow = table.get(session.pid);
			this.#seen.set(session.instanceId, {
				owners: new Set([...(previous.get(session.instanceId)?.owners ?? []), session.sessionId]),
				omp: ompRow ? { pid: ompRow.pid, started: ompRow.started } : null,
				jobs: new Map(jobs.flatMap(job => (job.target.kind === "job" ? [...job.target.members] : []))),
			});
			const ompRows = groups?.omp ?? [];
			found.set(session.instanceId, { omp: { memoryBytes: memoryOf(ompRows), cpuPercent: cpuOf(ompRows), processCount: ompRows.length }, items: jobs });
		}
		const gone = [...previous].filter(([id]) => !live.has(id));
		const left: Seen[] = [];
		for (const [id, seen] of gone) {
			// A session that left the roster while its omp runs may come back, so what it runs stays until omp exits.
			if (seen.omp && table.get(seen.omp.pid)?.started === seen.omp.started) this.#seen.set(id, seen);
			else left.push(seen);
		}

		const orphans: Target[] = [];
		for (const { scope, daemons } of reports) {
			for (const { snapshot, command } of daemons) {
				const owned = snapshot.owner;
				const serves =
					owned !== undefined
						? sessions.filter(session => this.#seen.get(session.instanceId)?.owners.has(owned))
						: scope.kind === "project"
							? sessions.filter((_, index) => projectDirs[index] === scope.projectDir)
							: [];
				const target: Target = { kind: "service", scope, name: snapshot.name, daemonId: snapshot.id };
				if (serves.length === 0) {
					if (owned !== undefined && left.some(seen => seen.owners.has(owned))) orphans.push(target);
					continue;
				}
				const tree = snapshot.pid === undefined ? [] : [snapshot.pid, ...descendants(table, snapshot.pid).keys()].flatMap(pid => table.get(pid) ?? []);
				const item: Item = {
					id: JSON.stringify(["service", scope.runtimeDir, snapshot.name, snapshot.id]),
					kind: "service",
					shared: owned === undefined,
					label: command ? `${snapshot.name}: ${command}` : snapshot.name,
					memoryBytes: memoryOf(tree),
					cpuPercent: cpuOf(tree),
					processCount: tree.length,
					ports: portsOf(tree),
					startedAt: snapshot.startedAt,
					stopsAt: null,
					target,
					serves,
				};
				for (const session of serves) found.get(session.instanceId)?.items.push(item);
			}
		}

		const due = new Map<string, Target>();
		for (const { items } of found.values()) {
			for (const item of items) {
				item.stopsAt = owner && timeout !== null ? this.#stopsAt(item, timeout) : null;
				if (item.stopsAt !== null && item.stopsAt <= now) due.set(item.id, item.target);
			}
		}
		if (owner) {
			const stops = [...due.values(), ...orphans, ...left.flatMap((seen): Target[] => (seen.jobs.size > 0 ? [{ kind: "job", members: seen.jobs }] : []))];
			for (const result of await Promise.allSettled(stops.map(target => this.#stopTarget(target)))) {
				if (result.status === "rejected") console.error(`omp-agents: stopping a session's process failed: ${errorText(result.reason)}`);
			}
		}
		for (const each of found.values()) each.items = each.items.filter(item => !due.has(item.id)).sort((a, b) => b.memoryBytes - a.memoryBytes);
		return found;
	}

	/** When the idle stop ends `item`: `timeout` minutes after it started or the last session it serves went idle; `null` while one of them is busy. */
	#stopsAt(item: Item, timeout: number): number | null {
		if (item.serves.some(session => session.status !== "idle")) return null;
		return Math.max(item.startedAt, ...item.serves.map(session => this.#idleSince.get(session.instanceId) ?? item.startedAt)) + timeout * 60_000;
	}

	#stopTarget(target: Target): Promise<void> {
		return target.kind === "job" ? this.#deps.stopProcesses(new Map(target.members)) : this.#deps.stopService(target.scope, target.name, target.daemonId);
	}
}

/** Job `pgid` of `session`, named by its top process: the group's leader, else the first under omp. */
function jobItem(session: WatchedSession, pgid: number, rows: ProcessRow[], ports: number[]): Item {
	const top = rows.find(row => row.pid === pgid) ?? rows[0];
	return {
		id: JSON.stringify(["job", pgid, top.started]),
		kind: "job",
		shared: false,
		label: top.command,
		memoryBytes: memoryOf(rows),
		cpuPercent: cpuOf(rows),
		processCount: rows.length,
		ports,
		startedAt: Date.parse(top.started),
		stopsAt: null,
		target: { kind: "job", members: new Map(rows.map(row => [row.pid, row.started])) },
		serves: [session],
	};
}

function answerOf(sample: Sample): LiveSessionProcesses[] {
	return [...sample].map(([instanceId, found]) => ({ instanceId, omp: found.omp, processes: found.items.map(({ target: _target, serves: _serves, ...shown }) => shown) }));
}

/** Every process now, read without blocking the server; `null` when `ps` failed. */
export async function readProcessTable(): Promise<ProcessTable | null> {
	const ps = await run(PS_ARGV, { env: PS_ENV, timeoutMs: 10_000 });
	return ps.code === 0 ? parsePs(ps.stdout) : null;
}

/** The TCP ports each process listens on, read without blocking the server; `null` when `lsof` failed. */
export async function readListeningPorts(): Promise<Map<number, number[]> | null> {
	try {
		const lsof = await run(LISTENERS_ARGV, { timeoutMs: 10_000 });
		// lsof exits 1 when it finds no listener.
		return lsof.code === 0 || lsof.code === 1 ? parseListeners(lsof.stdout) : null;
	} catch {
		return null;
	}
}

/** Stops `processes` by {@link terminate}, reading `ps` without blocking the server. */
export const stopProcesses = (processes: Processes): Promise<void> => terminate(processes, STOP_GRACE_MS, readProcessTable);
