/**
 * What each live session runs besides omp: its jobs, the process groups under its omp, and its services, the `proc` units
 * omp's daemon runs in its project. The watch lists them, stops one on request, stops the ones every session they serve
 * left idle for the setting's minutes, stops what a session that left the roster leaves behind, and ends a session left
 * idle for the setting's hours. Every stop of a session's processes goes through it; `docs/architecture/session-processes.md`
 * says what counts and why.
 */
import type { UnitSnapshot } from "../omp/module-types/processes";
import { run } from "../proc";
import {
	cwdsArgv,
	cwdsIn,
	descendants,
	environmentsArgv,
	LISTENERS_ARGV,
	listeningPortsIn,
	OMP_WORKER_PREFIX,
	parseCwds,
	parseListeners,
	parseSessionFiles,
	type Processes,
	type ProcessRow,
	type ProcessTable,
	sessionFilesIn,
	sessionGroups,
	terminate,
} from "../process-census";
import { SerialLane } from "../serial-lane";
import type { LiveSessionProcesses, ProcessSettings, SessionProcess, SessionProcesses } from "../shared/processes";
import type { HostStatus } from "../shared/sessions";
import { errorText } from "../json";

/** How long a stopped job gets to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;

/** How old a sample {@link SessionProcessWatch.list} answers from may be, so every open window's CPU card shares one `ps` and `lsof`. */
export const LIST_REUSE_MS = 2_000;

/** A live session, as the roster has it. */
export interface WatchedSession {
	instanceId: string;
	/** omp's session id, which a service names as its owner. */
	sessionId: string;
	/** omp's session file, which omp's bash tool names in each command's environment; `null` before omp wrote one. */
	file: string | null;
	/** omp's pid. */
	pid: number;
	cwd: string;
	status: HostStatus;
	/** Its main agent only waits on a subagent that still runs or on a scheduled check, which the idle session stop counts as busy. */
	waitsOnWork: boolean;
	/** The idle session stop may end it: a session this server started that is neither private nor a Bot's conversation. */
	stopsWhenIdle: boolean;
}

export interface SessionProcessWatchDeps {
	/** Every process now; `null` when `ps` failed. */
	readTable(): Promise<ProcessTable | null>;
	/** The TCP ports each process listens on, by pid; `null` when `lsof` failed. */
	readPorts(): Promise<Map<number, number[]> | null>;
	/** The working directory of each of `pids` that still runs. */
	readCwds(pids: readonly number[]): Promise<Map<number, string>>;
	/** The omp session file in the environment of each of `pids` that an omp bash tool started; `null` when the read failed. */
	readSessionFiles(pids: readonly number[]): Promise<Map<number, string> | null>;
	/** What app `dir` holds, the same for each checkout of it, such as `front/` of one repository; `null` outside git. */
	appOf(dir: string): Promise<string | null>;
	/** The services omp's daemon runs now, without the ones that ended or that it does not supervise. */
	readServices(): Promise<UnitSnapshot[]>;
	/** The project directory a project scope names for `cwd`. */
	projectDir(cwd: string): Promise<string>;
	/** Stops `unit`'s generation it is listed with. */
	stopService(unit: UnitSnapshot): Promise<void>;
	/** Stops each process that still runs under the start time it is listed with. */
	stopProcesses(processes: Processes): Promise<void>;
	sessions(): WatchedSession[];
	/** Ends live session `instanceId` as a Bot's idle stop does: its omp stops, its worktree stays, and it becomes a past session. */
	endSession(instanceId: string): Promise<void>;
	/** When omp last wrote live session `instanceId`'s file, which starts its idle clock when this server first sees it settled; `null` with no file. */
	lastWrittenAt(instanceId: string): number | null;
	now(): number;
	/** This server holds the owner lock, so it stops processes no one asked it to. */
	owner(): boolean;
	settings(): ProcessSettings;
}

type Target = { kind: "job"; members: Processes } | { kind: "service"; unit: UnitSnapshot };

/** A listed process, with what stops it and the sessions whose idleness lets the idle stop end it. */
interface Item extends SessionProcess {
	target: Target;
	serves: WatchedSession[];
}

/** One live session's processes, as a sample found them. */
interface Found {
	omp: SessionProcesses["omp"];
	items: Item[];
	otherPorts: number[];
}

/** What a sample found, by instance id, in roster order. */
type Sample = Map<string, Found>;

/** What a session that leaves the roster is cleaned up by. */
interface Seen {
	/** Every omp session id it ran, since `/new` keeps the instance and changes the id its services name as owner. */
	owners: Set<string>;
	/** Every session file it had, for the same reason. */
	files: Set<string>;
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
	/** Since when each live session has been idle with no running subagent it waits on; now while it is anything else. */
	readonly #settledSince = new Map<string, number>();
	/** Each live session, and each gone one whose omp still ran at the last sample, by instance id. */
	#seen = new Map<string, Seen>();
	/** {@link SessionProcessWatchDeps.appOf} by directory, which a running server keeps. */
	readonly #apps = new Map<string, Promise<string | null>>();
	/** The session file each process launchd or init adopted names, `null` for none, by pid and start time, as the last sample read them. */
	#adoptedFiles = new Map<string, string | null>();
	/** The last sample and when it was taken, which {@link list} reuses while it is under {@link LIST_REUSE_MS} old. */
	#last: { at: number; sample: Sample } | null = null;

	constructor(deps: SessionProcessWatchDeps) {
		this.#deps = deps;
	}

	/** Samples, which runs the idle stop and the cleanup when this server owns them. */
	async tick(): Promise<void> {
		await this.#lane.run(() => this.#fresh());
	}

	/** Every live session's processes, from the last sample if it started under {@link LIST_REUSE_MS} before this call, in roster order. */
	list(): Promise<LiveSessionProcesses[]> {
		// Asked before the lane, so a slow sample that started after this call, or just before it, answers every list queued behind it.
		const asked = this.#deps.now();
		return this.#lane.run(async () => {
			const last = this.#last;
			return answerOf(last && last.at > asked - LIST_REUSE_MS ? last.sample : await this.#fresh());
		});
	}

	/** Stops session `instanceId`'s process `id`, unless either no longer runs, and answers what every live session runs after. */
	stop(instanceId: string, id: string): Promise<LiveSessionProcesses[]> {
		return this.#lane.run(async () => {
			const item = (await this.#fresh()).get(instanceId)?.items.find(each => each.id === id);
			if (item) await this.#stopTarget(item.target);
			return answerOf(await this.#fresh());
		});
	}

	/** A new sample, kept as the last one. */
	async #fresh(): Promise<Sample> {
		const at = this.#deps.now();
		const sample = await this.#sample();
		this.#last = { at, sample };
		return sample;
	}

	async #sample(): Promise<Sample> {
		const sessions = this.#deps.sessions();
		const [table, services, projectDirs, listeners] = await Promise.all([
			this.#deps.readTable(),
			this.#deps.readServices(),
			Promise.all(sessions.map(session => this.#deps.projectDir(session.cwd))),
			this.#deps.readPorts(),
		]);
		if (!table) throw new Error("ps failed, so no session's processes are known");
		const portsOf = (rows: ProcessRow[]): number[] => [...new Set(rows.flatMap(row => listeners?.get(row.pid) ?? []))].sort((a, b) => a - b);
		const now = this.#deps.now();
		const owner = this.#deps.owner();
		const { stopIdleAfterMinutes: timeout, stopIdleSessionsAfterHours: sessionTimeout } = this.#deps.settings();
		const live = new Set(sessions.map(session => session.instanceId));
		for (const clock of [this.#idleSince, this.#settledSince]) for (const id of clock.keys()) if (!live.has(id)) clock.delete(id);
		for (const { instanceId, status, waitsOnWork } of sessions) {
			this.#idleSince.set(instanceId, status === "idle" ? (this.#idleSince.get(instanceId) ?? now) : now);
			// A server that restarted first sees a long-idle session settled since its file was last written, not since now.
			const settled = status === "idle" && !waitsOnWork;
			this.#settledSince.set(instanceId, settled ? (this.#settledSince.get(instanceId) ?? Math.min(now, this.#deps.lastWrittenAt(instanceId) ?? now)) : now);
		}

		const previous = this.#seen;
		this.#seen = new Map();
		const ompPids = [...sessions.map(session => session.pid), ...[...previous.values()].flatMap(seen => (seen.omp ? [seen.omp.pid] : []))];
		const detached = await this.#detached(table, ompPids);
		// A detached tree is one job of one session, keyed by its root's process group, even when two sessions' files name it.
		const claimed = new Set<ProcessRow[]>();
		const found: Sample = new Map();
		for (const session of sessions) {
			const files = new Set([...(previous.get(session.instanceId)?.files ?? []), ...(session.file === null ? [] : [session.file])]);
			const groups = sessionGroups(table, session.pid);
			const byGroup = new Map<number, ProcessRow[]>(groups?.jobs ?? []);
			for (const { file, rows } of detached) {
				if (claimed.has(rows) || ![...files].some(own => startedIn(file, own))) continue;
				claimed.add(rows);
				const pgid = rows[0].pgid;
				byGroup.set(pgid, [...(byGroup.get(pgid) ?? []), ...rows]);
			}
			const jobs = [...byGroup].map(([pgid, rows]) => jobItem(session, pgid, rows, portsOf(rows)));
			const ompRow = table.get(session.pid);
			this.#seen.set(session.instanceId, {
				owners: new Set([...(previous.get(session.instanceId)?.owners ?? []), session.sessionId]),
				files,
				omp: ompRow ? { pid: ompRow.pid, started: ompRow.started } : null,
				jobs: new Map(jobs.flatMap(job => (job.target.kind === "job" ? [...job.target.members] : []))),
			});
			const ompRows = groups?.omp ?? [];
			found.set(session.instanceId, { omp: { memoryBytes: memoryOf(ompRows), cpuPercent: cpuOf(ompRows), processCount: ompRows.length }, items: jobs, otherPorts: [] });
		}
		const gone = [...previous].filter(([id]) => !live.has(id));
		const left: Seen[] = [];
		for (const [id, seen] of gone) {
			// A session that left the roster while its omp runs may come back, so what it runs stays until omp exits.
			if (seen.omp && table.get(seen.omp.pid)?.started === seen.omp.started) this.#seen.set(id, seen);
			else left.push(seen);
		}

		const orphans: Target[] = [];
		for (const unit of services) {
			const { owner: owned, scope } = unit;
			const serves =
				owned !== undefined
					? sessions.filter(session => this.#seen.get(session.instanceId)?.owners.has(owned))
					: scope.kind === "project"
						? sessions.filter((_, index) => projectDirs[index] === scope.dir)
						: [];
			const target: Target = { kind: "service", unit };
			if (serves.length === 0) {
				if (owned !== undefined && left.some(seen => seen.owners.has(owned))) orphans.push(target);
				continue;
			}
			const main = unit.pids[0];
			const tree = main === undefined ? [] : [main, ...descendants(table, main).keys()].flatMap(pid => table.get(pid) ?? []);
			const item: Item = {
				id: JSON.stringify(["service", unit.id, unit.generation]),
				kind: "service",
				shared: owned === undefined,
				label: unit.command ? `${unit.key}: ${unit.command}` : unit.key,
				memoryBytes: memoryOf(tree),
				cpuPercent: cpuOf(tree),
				processCount: tree.length,
				ports: portsOf(tree),
				startedAt: unit.startedAt,
				stopsAt: null,
				target,
				serves,
			};
			for (const session of serves) found.get(session.instanceId)?.items.push(item);
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
			const idle = sessionTimeout === null ? [] : sessions.filter(session => session.stopsWhenIdle && this.#settledSince.get(session.instanceId)! + sessionTimeout * 3_600_000 <= now);
			const stopping = [...stops.map(target => this.#stopTarget(target)), ...idle.map(session => this.#deps.endSession(session.instanceId))];
			for (const result of await Promise.allSettled(stopping)) {
				if (result.status === "rejected") console.error(`omp-agents: stopping a session's process failed: ${errorText(result.reason)}`);
			}
		}
		for (const each of found.values()) each.items = each.items.filter(item => !due.has(item.id)).sort((a, b) => b.memoryBytes - a.memoryBytes);
		if (listeners) await this.#fillOtherPorts(found, listeners);
		return found;
	}

	/**
	 * Each process tree whose root launchd or init adopted and whose environment names an omp session file, with that file:
	 * a server a command started with `nohup … &` outlives the command, so it runs under no omp. A tree that holds one of
	 * `ompPids` or this server is a keeper's or the dashboard's own, never a job. A process's file is read once, when a sample
	 * first finds it adopted.
	 */
	async #detached(table: ProcessTable, ompPids: number[]): Promise<{ file: string; rows: ProcessRow[] }[]> {
		const roots = [...table.values()].filter(row => row.ppid === 1 && !row.command.includes(OMP_WORKER_PREFIX));
		const unread = roots.filter(row => !this.#adoptedFiles.has(`${row.pid} ${row.started}`)).map(row => row.pid);
		if (unread.length > 0) {
			// A failed read leaves the processes unread, so the next sample reads them again.
			const read = await this.#deps.readSessionFiles(unread);
			if (read) for (const row of roots) if (unread.includes(row.pid)) this.#adoptedFiles.set(`${row.pid} ${row.started}`, read.get(row.pid) ?? null);
		}
		const keys = new Set(roots.map(row => `${row.pid} ${row.started}`));
		for (const key of this.#adoptedFiles.keys()) if (!keys.has(key)) this.#adoptedFiles.delete(key);
		const skip = new Set([...ompPids, process.pid]);
		const trees: { file: string; rows: ProcessRow[] }[] = [];
		for (const row of roots) {
			const file = this.#adoptedFiles.get(`${row.pid} ${row.started}`);
			if (!file) continue;
			const rows = [row, ...[...descendants(table, row.pid).keys()].flatMap(pid => table.get(pid) ?? [])];
			if (!rows.some(each => skip.has(each.pid))) trees.push({ file, rows });
		}
		return trees;
	}

	/**
	 * Sets each session's `otherPorts`: every port in `listeners` but its own servers' and those another checkout of the
	 * same app listens on, such as your own server on the app's usual port, so only those count as the session's app.
	 */
	async #fillOtherPorts(found: Sample, listeners: Map<number, number[]>): Promise<void> {
		const listening = new Map<number, number[]>();
		for (const [pid, ports] of listeners) for (const port of ports) listening.set(port, [...(listening.get(port) ?? []), pid]);
		const ownPorts = new Map([...found].map(([id, each]) => [id, new Set(each.items.flatMap(item => (item.shared ? [] : item.ports)))]));
		const appOfPid = new Map<number, string>();
		if ([...ownPorts.values()].some(ports => ports.size > 0)) {
			const cwds = await this.#deps.readCwds([...listeners.keys()]);
			await Promise.all(
				[...cwds].map(async ([pid, cwd]) => {
					const app = await this.#appOf(cwd);
					if (app !== null) appOfPid.set(pid, app);
				}),
			);
		}
		for (const [id, each] of found) {
			const own = ownPorts.get(id)!;
			const apps = new Set([...own].flatMap(port => (listening.get(port) ?? []).flatMap(pid => appOfPid.get(pid) ?? [])));
			each.otherPorts = [...listening]
				.filter(([port, pids]) => !own.has(port) && !pids.some(pid => apps.has(appOfPid.get(pid) ?? "")))
				.map(([port]) => port)
				.sort((a, b) => a - b);
		}
	}

	#appOf(dir: string): Promise<string | null> {
		let app = this.#apps.get(dir);
		if (!app) this.#apps.set(dir, (app = this.#deps.appOf(dir)));
		return app;
	}

	/** When the idle stop ends `item`: `timeout` minutes after it started or the last session it serves went idle; `null` while one of them is busy. */
	#stopsAt(item: Item, timeout: number): number | null {
		if (item.serves.some(session => session.status !== "idle")) return null;
		return Math.max(item.startedAt, ...item.serves.map(session => this.#idleSince.get(session.instanceId) ?? item.startedAt)) + timeout * 60_000;
	}

	#stopTarget(target: Target): Promise<void> {
		return target.kind === "job" ? this.#deps.stopProcesses(new Map(target.members)) : this.#deps.stopService(target.unit);
	}
}

/** Whether a command that names session file `file` ran in session `own` or in one of its subagents, whose files omp keeps in a directory named after `own`. */
const startedIn = (file: string, own: string): boolean => file === own || file.startsWith(`${own.replace(/\.jsonl$/, "")}/`);

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
	return [...sample].map(([instanceId, found]) => ({
		instanceId,
		omp: found.omp,
		processes: found.items.map(({ target: _target, serves: _serves, ...shown }) => shown),
		otherPorts: found.otherPorts,
	}));
}

/** The TCP ports each process listens on, read without blocking the server; `null` when `lsof` failed. */
export async function readListeningPorts(): Promise<Map<number, number[]> | null> {
	try {
		const lsof = await run(LISTENERS_ARGV, { timeoutMs: 10_000 });
		// lsof exits 1 when it finds no listener.
		if (lsof.code === 0 || lsof.code === 1) return parseListeners(lsof.stdout);
	} catch {
		// `lsof` is not installed. Linux still has the sockets in /proc.
	}
	if (process.platform !== "linux") return null;
	try {
		return listeningPortsIn("/proc");
	} catch {
		return null;
	}
}

/** The working directory of each of `pids` that still runs, read without blocking the server; empty when `lsof` failed. */
export async function readCwds(pids: readonly number[]): Promise<Map<number, string>> {
	if (pids.length === 0) return new Map();
	try {
		const lsof = await run(cwdsArgv(pids), { timeoutMs: 10_000 });
		// lsof exits 1 when one of the pids has exited since.
		if (lsof.code === 0 || lsof.code === 1) return parseCwds(lsof.stdout);
	} catch {
		// `lsof` is not installed.
	}
	if (process.platform !== "linux") return new Map();
	try {
		return cwdsIn("/proc", pids);
	} catch {
		return new Map();
	}
}

/** The omp session file in the environment of each of `pids` that an omp bash tool started, read without blocking the server; `null` when the read failed. */
export async function readSessionFiles(pids: readonly number[]): Promise<Map<number, string> | null> {
	if (process.platform === "linux") {
		try {
			return sessionFilesIn("/proc", pids);
		} catch {
			return null;
		}
	}
	try {
		const ps = await run(environmentsArgv(pids), { timeoutMs: 10_000 });
		// ps exits 1 when one of the pids has exited since.
		if (ps.code === 0 || ps.code === 1) return parseSessionFiles(ps.stdout, process.env.XPC_SERVICE_NAME);
	} catch {
		// `ps` timed out.
	}
	return null;
}

/** The repository `dir` is in and where in it, so every checkout of one app answers the same; `null` outside git. */
export async function readAppOf(dir: string): Promise<string | null> {
	const git = await run(["git", "-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-prefix"], { timeoutMs: 10_000 }).catch(() => null);
	return git?.code === 0 ? git.stdout.trim() : null;
}

/** Stops `processes` by {@link terminate}, which reads `ps` without blocking the server. */
export const stopProcesses = (processes: Processes): Promise<void> => terminate(processes, STOP_GRACE_MS);
