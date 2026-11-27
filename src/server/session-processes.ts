/**
 * What each live session runs besides omp: its jobs, the process groups under its omp, and its services, the `proc` units
 * omp's daemon runs in its project; and the strays, the omps a keeper runs that no server lists. The watch lists them,
 * stops one on request, reads the computer's memory each sample, and applies what the memory policy (`memory-policy.ts`)
 * decides: the idle stops, the end of a stray past its grace, and the pressure ladder. It also stops what a session that
 * left the roster leaves behind. Every automatic stop goes through it; `docs/architecture/session-processes.md` says
 * what counts and why.
 */
import type { KeptProcess } from "../keeper-link";
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
import type { AutoStop, Footprint, MemoryReading, Owner, ResourceSample, ResourcesView, StrayReason } from "../shared/resources";
import type { HostStatus } from "../shared/sessions";
import { errorText } from "../json";
import { decide, type Decision, type PolicyStray, type Stop } from "./memory-policy";

/** How long a stopped job gets to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;

/** How old a sample {@link SessionProcessWatch.list} answers from may be, so every open window's CPU card shares one `ps` and `lsof`. */
export const LIST_REUSE_MS = 2_000;

/** The process id `PUT /api/session-processes/stop` takes, with a stray's keeper id as the instance id, to end that stray. */
export const STRAY_STOP_ID = "stray";

/** How many automatic stops {@link SessionProcessWatch.view} lists, newest first. */
const KEPT_STOPS = 100;

const OWNER_KINDS: readonly Owner["kind"][] = ["session", "stray", "mcp", "process", "heavy", "dashboard"];

/** A live session, as the roster has it. */
export interface WatchedSession {
	instanceId: string;
	/** What the roster calls it. */
	title: string;
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
	/** The idle session stop may end it: a session this server started, private or not. */
	stopsWhenIdle: boolean;
	/** Ending it deletes it. */
	private: boolean;
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
	/** Ends live session `instanceId`: its omp stops, its worktree stays, and it becomes a past session. */
	endSession(instanceId: string): Promise<void>;
	/** When omp last wrote live session `instanceId`'s file, which starts its idle clock when this server first sees it settled; `null` with no file. */
	lastWrittenAt(instanceId: string): number | null;
	now(): number;
	/** This server holds the owner lock, so it stops processes no one asked it to. */
	owner(): boolean;
	settings(): ProcessSettings;
	/** The computer's memory, from the reading before it; pressure `unknown` when it cannot be read. */
	readMemory(previous: MemoryReading | null): Promise<MemoryReading>;
	/** Every keeper running on this computer, whichever port's server started it. */
	readKeepers(): KeptProcess[];
	/** The port this server listens on, whose keepers the roster does not list are its own strays. */
	port: number;
	/** Ends a stray's omp through its keeper, and deletes its session when it is private; holds when repeated. */
	endStray(keeper: KeptProcess): Promise<void>;
	/** Keeps a sample, with the first automatic stop it made; the history thins samples to one a minute. */
	record(sample: ResourceSample, stop: AutoStop | null): void;
	/** The private sessions the idle session stop deletes within five minutes, as each sample with the owner lock finds them. */
	warn(warnings: Decision["warnings"]): void;
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

const memoryOf = (rows: ProcessRow[]): number => rows.reduce((sum, row) => sum + (row.footprintKb ?? row.rssKb) * 1024, 0);
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
	/** The last memory reading, which the next reading reads its swap rate and calm count from. */
	#reading: MemoryReading | null = null;
	/** What the memory policy answered the last sample. */
	#decision: Decision | null = null;
	/** The strays the last sample found. */
	#strays: PolicyStray[] = [];
	/** When this server first saw each stray, by port, keeper id, and keeper pid. */
	#straysSeen = new Map<string, number>();
	/** The memory each owner held at the last sample. */
	#footprints: Footprint[] = [];
	/** The automatic stops made, newest first, at most {@link KEPT_STOPS}. */
	#stops: AutoStop[] = [];

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

	/** Stops session `instanceId`'s process `id`, or ends stray `instanceId` when `id` is {@link STRAY_STOP_ID}, unless it no longer runs; answers what every live session runs after. */
	stop(instanceId: string, id: string): Promise<LiveSessionProcesses[]> {
		return this.#lane.run(async () => {
			const sample = await this.#fresh();
			if (id === STRAY_STOP_ID) {
				// Another live server's keeper is that server's to end.
				const stray = this.#strays.find(each => each.instanceId === instanceId && each.reason !== "foreign-live");
				if (stray) await this.#deps.endStray(stray);
			} else {
				const item = sample.get(instanceId)?.items.find(each => each.id === id);
				if (item) await this.#stopTarget(item.target);
			}
			return answerOf(await this.#fresh());
		});
	}

	/**
	 * Whether work may start now: what the user starts always does, while unattended work, a Board task's or a routine's
	 * run, waits under any pressure but normal, with the reason the memory policy gives.
	 */
	admit(kind: "interactive" | "unattended"): { go: true } | { go: false; reason: string } {
		if (kind === "interactive") return { go: true };
		const holds = this.#decision ? this.#decision.holdsUnattended : "Memory has not been read yet, so unattended work waits until it is.";
		return holds === null ? { go: true } : { go: false, reason: holds };
	}

	/** The memory reading, who holds memory, what pressure stops next, and the automatic stops, from a sample under {@link LIST_REUSE_MS} old. */
	view(): Promise<ResourcesView> {
		const asked = this.#deps.now();
		return this.#lane.run(async () => {
			const last = this.#last;
			if (!last || last.at <= asked - LIST_REUSE_MS) await this.#fresh();
			return { reading: this.#reading, footprints: this.#footprints, ladder: this.#decision?.ladder ?? [], stops: this.#stops, heavy: { slots: 0, running: 0, queued: 0 } };
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
		const [table, services, projectDirs, listeners, reading] = await Promise.all([
			this.#deps.readTable(),
			this.#deps.readServices(),
			Promise.all(sessions.map(session => this.#deps.projectDir(session.cwd))),
			this.#deps.readPorts(),
			this.#deps.readMemory(this.#reading),
		]);
		this.#reading = reading;
		if (!table) throw new Error("ps failed, so no session's processes are known");
		const portsOf = (rows: ProcessRow[]): number[] => [...new Set(rows.flatMap(row => listeners?.get(row.pid) ?? []))].sort((a, b) => a - b);
		const now = this.#deps.now();
		const owner = this.#deps.owner();
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

		const items = new Map<string, Item>();
		for (const each of found.values()) for (const item of each.items) items.set(item.id, item);
		const keepers = this.#deps.readKeepers();
		const strays = (this.#strays = this.#findStrays(keepers, table, listeners, live, now));
		const decision = (this.#decision = decide({
			now,
			reading,
			settings: this.#deps.settings(),
			sessions: sessions.map(session => ({
				...session,
				idleSince: this.#idleSince.get(session.instanceId)!,
				settledSince: this.#settledSince.get(session.instanceId)!,
				memoryBytes: found.get(session.instanceId)!.omp.memoryBytes,
			})),
			items: [...items.values()].map(item => ({ id: item.id, label: item.label, instanceIds: item.serves.map(session => session.instanceId), memoryBytes: item.memoryBytes, startedAt: item.startedAt, shared: item.shared })),
			strays,
		}));
		for (const item of items.values()) item.stopsAt = owner ? (decision.stopsAt.get(item.id) ?? null) : null;
		// Only the owner stops what no one asked it to; a server that never holds the lock still ends the omps it started and no longer lists.
		const applied = decision.stops.filter(stop => owner || (stop.kind === "stray" && stop.keeper.port === this.#deps.port && stop.because === "stray"));
		if (owner) this.#deps.warn(decision.warnings);
		const cleanup = owner ? [...orphans, ...left.flatMap((seen): Target[] => (seen.jobs.size > 0 ? [{ kind: "job", members: seen.jobs }] : []))] : [];
		const results = await Promise.allSettled([...applied.map(stop => this.#apply(stop, items)), ...cleanup.map(target => this.#stopTarget(target))]);
		const made: AutoStop[] = [];
		const stopped = new Set<string>();
		results.forEach((result, index) => {
			const stop = applied[index];
			if (result.status === "rejected") console.error(`omp-agents: ${stop ? "an automatic stop" : "stopping a session's process"} failed: ${errorText(result.reason)}`);
			else if (stop) {
				made.push({ owner: stop.owner, at: now, memoryBytes: stop.memoryBytes, because: stop.because });
				if (stop.kind === "item") stopped.add(stop.id);
			}
		});
		this.#stops = [...made, ...this.#stops].slice(0, KEPT_STOPS);
		for (const each of found.values()) each.items = each.items.filter(item => !stopped.has(item.id)).sort((a, b) => b.memoryBytes - a.memoryBytes);
		this.#footprints = footprintsOf(sessions, found, strays, keepers, table);
		const byClass = Object.fromEntries(OWNER_KINDS.map(kind => [kind, 0])) as Record<Owner["kind"], number>;
		for (const { owner: who, memoryBytes } of this.#footprints) byClass[who.kind] += memoryBytes;
		this.#deps.record({ at: now, reading, byClass, jetsam: [] }, made[0] ?? null);
		if (listeners) await this.#fillOtherPorts(found, listeners);
		return found;
	}

	/**
	 * The keepers no server lists, with why and since when this server sees them: one in this port's directory whose
	 * session the roster does not list, one of a port no process listens on, or one of a port another server listens on,
	 * which is that server's. Without `lsof`, every other port counts as listened on.
	 */
	#findStrays(keepers: KeptProcess[], table: ProcessTable, listeners: Map<number, number[]> | null, listed: ReadonlySet<string>, now: number): PolicyStray[] {
		const listening = new Set([...(listeners?.values() ?? [])].flat());
		const seen = new Map<string, number>();
		const strays = keepers.flatMap((keeper): PolicyStray[] => {
			const own = keeper.port === this.#deps.port;
			if (own && listed.has(keeper.instanceId)) return [];
			const reason: StrayReason = own ? "unattached" : listeners && !listening.has(keeper.port) ? "orphan-port" : "foreign-live";
			const key = `${keeper.port} ${keeper.instanceId} ${keeper.keeperPid}`;
			const firstSeen = this.#straysSeen.get(key) ?? now;
			seen.set(key, firstSeen);
			return [{ ...keeper, reason, firstSeen, memoryBytes: memoryOf(treeOf(table, keeper.keeperPid)) }];
		});
		this.#straysSeen = seen;
		return strays;
	}

	#apply(stop: Stop, items: ReadonlyMap<string, Item>): Promise<void> {
		if (stop.kind === "item") return this.#stopTarget(items.get(stop.id)!.target);
		if (stop.kind === "session") return this.#deps.endSession(stop.instanceId);
		return this.#deps.endStray(stop.keeper);
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
			// Only the listeners' directories stay cached, so a long-running server does not keep every directory it ever read.
			const dirs = new Set(cwds.values());
			for (const dir of this.#apps.keys()) if (!dirs.has(dir)) this.#apps.delete(dir);
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

	#stopTarget(target: Target): Promise<void> {
		return target.kind === "job" ? this.#deps.stopProcesses(new Map(target.members)) : this.#deps.stopService(target.unit);
	}
}

/** Whether a command that names session file `file` ran in session `own` or in one of its subagents, whose files omp keeps in a directory named after `own`. */
const startedIn = (file: string, own: string): boolean => file === own || file.startsWith(`${own.replace(/\.jsonl$/, "")}/`);

/** Process `pid` and every process under it that still runs. */
const treeOf = (table: ProcessTable, pid: number): ProcessRow[] => [pid, ...descendants(table, pid).keys()].flatMap(each => table.get(each) ?? []);

/** Who held memory at a sample: each live session's omp, each of its processes once, each stray, and the server outside its keepers. */
function footprintsOf(sessions: readonly WatchedSession[], found: Sample, strays: readonly PolicyStray[], keepers: readonly KeptProcess[], table: ProcessTable): Footprint[] {
	const footprints: Footprint[] = [];
	const items = new Map<string, Item>();
	for (const session of sessions) {
		const each = found.get(session.instanceId)!;
		footprints.push({ owner: { kind: "session", instanceId: session.instanceId, title: session.title, private: session.private }, memoryBytes: each.omp.memoryBytes, processCount: each.omp.processCount, stoppable: false });
		for (const item of each.items) if (!items.has(item.id)) items.set(item.id, item);
	}
	for (const item of items.values()) {
		footprints.push({ owner: { kind: "process", id: item.id, instanceId: item.serves[0]!.instanceId, label: item.label }, memoryBytes: item.memoryBytes, processCount: item.processCount, stoppable: true });
	}
	for (const stray of strays) {
		footprints.push({
			owner: { kind: "stray", keeperId: stray.instanceId, port: stray.port, reason: stray.reason, startedAt: stray.startedAt },
			memoryBytes: stray.memoryBytes,
			processCount: treeOf(table, stray.keeperPid).length,
			stoppable: stray.reason !== "foreign-live",
		});
	}
	// A keeper this server started is its child until the server restarts; its tree is the session's or the stray's.
	const kept = new Set(keepers.flatMap(keeper => treeOf(table, keeper.keeperPid).map(row => row.pid)));
	const server = treeOf(table, process.pid).filter(row => !kept.has(row.pid));
	footprints.push({ owner: { kind: "dashboard", part: "server" }, memoryBytes: memoryOf(server), processCount: server.length, stoppable: false });
	return footprints.sort((a, b) => b.memoryBytes - a.memoryBytes);
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
