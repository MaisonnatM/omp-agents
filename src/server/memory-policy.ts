/**
 * The memory policy: which automatic stops a sample makes, what stops next if memory pressure rises, and whether
 * unattended work may start. Pure, and the only file that holds a threshold or the ladder's order;
 * `SessionProcessWatch` reads the clocks, the keepers, and the memory, and applies what {@link decide} answers.
 * `docs/architecture/session-processes.md` says why each rung sits where it does.
 */
import type { KeptProcess } from "../keeper-link";
import type { PrivateDeleting } from "../shared/notices";
import type { ProcessSettings } from "../shared/processes";
import type { AutoStop, LadderEntry, MemoryReading, Owner, Pressure, StrayReason } from "../shared/resources";
import type { WatchedSession } from "./session-processes";

/** How long an omp no server lists runs before it is ended, whatever the pressure: long enough for a server restart to attach to it. */
export const STRAY_GRACE_MS = 10 * 60_000;
/** How long a stray must have been seen before pressure ends it early: a session's keeper is unlisted while the session starts or attaches. */
export const STRAY_SETTLE_MS = 60_000;
/** How long before a private session's idle stop deletes it the user is told. */
export const PRIVATE_NOTICE_MS = 5 * 60_000;
/** How long every session a process serves must have been idle before pressure stops it. */
const IDLE_PROCESS_MS = 5 * 60_000;
/** How long an ordinary session must have been settled before pressure ends it, by pressure. */
const SETTLED_MS = { warn: 20 * 60_000, critical: 2 * 60_000 } as const;
/** How long a private session must have been settled before critical pressure deletes it; warn never does. */
const PRIVATE_SETTLED_MS = 60 * 60_000;
/** How many ladder stops one sample makes, by pressure, before the next reading says whether more are needed. */
const PER_SAMPLE = { warn: 1, critical: 3 } as const;

/** A live session with its clocks and omp's memory. */
export interface PolicySession extends WatchedSession {
	/** Since when it has been idle; now while it is anything else. */
	idleSince: number;
	/** Since when it has been idle and waiting on no subagent or scheduled check; now while it is anything else. */
	settledSince: number;
	memoryBytes: number;
}

/** A job or service of live sessions, which the idle stop and rung 2 stop. */
export interface PolicyItem {
	id: string;
	label: string;
	/** The live sessions it serves: its own session, or every session of its project for a shared service. */
	instanceIds: string[];
	memoryBytes: number;
	startedAt: number;
	shared: boolean;
}

/** An omp no server of this port lists, with why, since when this server has seen it, and its keeper's tree's memory. */
export interface PolicyStray extends KeptProcess {
	reason: StrayReason;
	firstSeen: number;
	memoryBytes: number;
}

export interface PolicyInput {
	now: number;
	/** `null` before the first reading, which counts as `unknown`. */
	reading: MemoryReading | null;
	settings: ProcessSettings;
	sessions: readonly PolicySession[];
	items: readonly PolicyItem[];
	strays: readonly PolicyStray[];
}

/** One automatic stop, with the owner and memory the stop log records. */
export type Stop = { owner: Owner; memoryBytes: number; because: AutoStop["because"] } & (
	| { kind: "item"; id: string }
	| { kind: "session"; instanceId: string }
	| { kind: "stray"; keeper: KeptProcess }
);

export interface Decision {
	pressure: Pressure;
	/** What to stop now: the idle stops and stray grace first, then the ladder's share under pressure. */
	stops: Stop[];
	/** What pressure stops next, in order: the warn rungs while pressure is normal, warn, or unknown, the critical ones under critical. */
	ladder: LadderEntry[];
	/** When the idle stop ends each job or service, by its id; `null` while a session it serves is busy or the idle stop is off. */
	stopsAt: ReadonlyMap<string, number | null>;
	/** The private sessions whose idle stop deletes them within {@link PRIVATE_NOTICE_MS}, which the bell names. */
	warnings: PrivateDeleting[];
	/** Why unattended work waits; `null` when it may start. */
	holdsUnattended: string | null;
}

const sessionOwner = (session: PolicySession): Owner => ({ kind: "session", instanceId: session.instanceId, title: session.title, private: session.private });
const itemOwner = (item: PolicyItem): Owner => ({ kind: "process", id: item.id, instanceId: item.instanceIds[0] ?? "", label: item.label });
const strayOwner = (stray: PolicyStray): Owner => ({ kind: "stray", keeperId: stray.instanceId, port: stray.port, reason: stray.reason, startedAt: stray.startedAt });

const itemStop = (item: PolicyItem, because: AutoStop["because"]): Stop => ({ kind: "item", id: item.id, owner: itemOwner(item), memoryBytes: item.memoryBytes, because });
const sessionStop = (session: PolicySession, because: AutoStop["because"]): Stop => ({ kind: "session", instanceId: session.instanceId, owner: sessionOwner(session), memoryBytes: session.memoryBytes, because });
const strayStop = (stray: PolicyStray, because: AutoStop["because"]): Stop => {
	const { reason: _reason, firstSeen: _firstSeen, memoryBytes, ...keeper } = stray;
	return { kind: "stray", keeper, owner: strayOwner(stray), memoryBytes, because };
};

const keyOf = (stop: Pick<Stop, "kind"> & ({ id: string } | { instanceId: string } | { keeper: KeptProcess })): string =>
	"id" in stop ? `item ${stop.id}` : "keeper" in stop ? `stray ${stop.keeper.port} ${stop.keeper.instanceId}` : `session ${stop.instanceId}`;

const WAITS: Record<Exclude<Pressure, "normal">, string> = {
	warn: "Memory is under pressure, so unattended work waits until it eases.",
	critical: "Memory pressure is critical, so unattended work waits until it eases.",
	unknown: "Memory pressure could not be read, so unattended work waits until it can.",
};

/** When the idle stop ends `item`: the setting's minutes after it started or the last session it serves went idle; `null` while one of them is busy. */
function idleStopAt(item: PolicyItem, sessions: ReadonlyMap<string, PolicySession>, timeoutMs: number): number | null {
	const serves = item.instanceIds.flatMap(id => sessions.get(id) ?? []);
	if (serves.some(session => session.status !== "idle")) return null;
	return Math.max(item.startedAt, ...serves.map(session => session.idleSince)) + timeoutMs;
}

/** What pressure at `level` may stop, cheapest loss first, as stops that pressure names. */
function ladderOf(input: PolicyInput, level: "warn" | "critical", sessions: ReadonlyMap<string, PolicySession>): { entry: LadderEntry; stop: Stop }[] {
	const { now } = input;
	const because: Pressure = level;
	const strays = input.strays
		.filter(stray => stray.reason !== "foreign-live" && now - stray.firstSeen >= STRAY_SETTLE_MS)
		.toSorted((a, b) => b.memoryBytes - a.memoryBytes)
		.map(stray => ({ entry: { owner: strayOwner(stray), rung: 0 as const, memoryBytes: stray.memoryBytes }, stop: strayStop(stray, because) }));
	// Rung 1, MCP servers idle in settled sessions, waits on omp starting them lazily.
	const items = input.items
		.filter(item => {
			const serves = item.instanceIds.flatMap(id => sessions.get(id) ?? []);
			return serves.length > 0 && serves.every(session => session.status === "idle" && !session.waitsOnWork && now - session.idleSince >= IDLE_PROCESS_MS);
		})
		.toSorted((a, b) => b.memoryBytes - a.memoryBytes)
		.map(item => ({ entry: { owner: itemOwner(item), rung: 2 as const, memoryBytes: item.memoryBytes }, stop: itemStop(item, because) }));
	const settled = (rung: 3 | 4, afterMs: number) =>
		input.sessions
			.filter(session => session.stopsWhenIdle && session.private === (rung === 4) && session.status === "idle" && !session.waitsOnWork && now - session.settledSince >= afterMs)
			.toSorted((a, b) => a.settledSince - b.settledSince)
			.map(session => ({ entry: { owner: sessionOwner(session), rung, memoryBytes: session.memoryBytes }, stop: sessionStop(session, because) }));
	return [...strays, ...items, ...settled(3, SETTLED_MS[level]), ...(level === "critical" ? settled(4, PRIVATE_SETTLED_MS) : [])];
}

/**
 * The stops, the ladder, and the admission of one sample. Whatever the pressure, the idle stops run on the settings'
 * timers, a private session included, with a notice {@link PRIVATE_NOTICE_MS} before; and an omp no live server lists is
 * ended after {@link STRAY_GRACE_MS}. Under warn or critical, the ladder's first 1 or 3 owners stop too; under unknown,
 * the ladder stops nothing. Only normal pressure admits unattended work.
 */
export function decide(input: PolicyInput): Decision {
	const { now, settings } = input;
	const pressure = input.reading?.pressure ?? "unknown";
	const sessions = new Map(input.sessions.map(session => [session.instanceId, session]));
	const stops: Stop[] = [];
	const stopsAt = new Map<string, number | null>();
	const minutes = settings.stopIdleAfterMinutes;
	for (const item of input.items) {
		const at = minutes === null ? null : idleStopAt(item, sessions, minutes * 60_000);
		stopsAt.set(item.id, at);
		if (at !== null && at <= now) stops.push(itemStop(item, "idle"));
	}
	const warnings: Decision["warnings"] = [];
	const hours = settings.stopIdleSessionsAfterHours;
	if (hours !== null) {
		for (const session of input.sessions) {
			if (!session.stopsWhenIdle) continue;
			const deletesAt = session.settledSince + hours * 3_600_000;
			if (deletesAt <= now) stops.push(sessionStop(session, "idle"));
			else if (session.private && deletesAt - PRIVATE_NOTICE_MS <= now) warnings.push({ sessionId: session.sessionId, title: session.title, deletesAt });
		}
	}
	for (const stray of input.strays) if (stray.reason !== "foreign-live" && now - stray.firstSeen >= STRAY_GRACE_MS) stops.push(strayStop(stray, "stray"));

	const stopping = new Set(stops.map(keyOf));
	const ladder = ladderOf(input, pressure === "critical" ? "critical" : "warn", sessions).filter(({ stop }) => !stopping.has(keyOf(stop)));
	if (pressure === "warn" || pressure === "critical") stops.push(...ladder.slice(0, PER_SAMPLE[pressure]).map(({ stop }) => stop));
	return { pressure, stops, ladder: ladder.map(({ entry }) => entry), stopsAt, warnings, holdsUnattended: pressure === "normal" ? null : WAITS[pressure] };
}
