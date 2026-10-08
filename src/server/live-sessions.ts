/** Every session the dashboard can drive, in one registry: terminal sessions it joined, and sessions it started. */
import { forgetSession } from "../commands";
import { DashboardSession, type DashboardUpdate, newInstanceId } from "../dashboard-session";
import { SessionGuest } from "../guest";
import type { LiveSession, LiveUpdate } from "../live-session";
import type { HostSnapshot } from "../omp/collab";
import { displayPath } from "../paths";
import { type RosterHost, type SessionFacts, type WorkItem, worksOn } from "../shared/sessions";

export type SessionUpdate = LiveUpdate | DashboardUpdate;

/** `facts` with `subject` first among the session's links, unless its tool calls named it already. */
export function withSubject(facts: SessionFacts, subject: WorkItem | undefined): SessionFacts {
	if (!subject || worksOn(facts, subject)) return facts;
	return subject.kind === "ticket" ? { ...facts, tickets: [subject.id, ...facts.tickets] } : { ...facts, pullRequests: [{ ...subject.pr, link: "worked" }, ...facts.pullRequests] };
}

export class LiveSessions {
	readonly #sessions = new Map<string, LiveSession>();
	/** What the sessions started from a quick action work on, by instance id, for as long as they run. */
	readonly #subjects = new Map<string, WorkItem>();
	/**
	 * The sessions by the session file they continue, the earliest added first. A session's id changes when omp moves it to
	 * another file or the registry lists its host on another session, so the index is rebuilt where either can happen.
	 */
	#bySessionId = new Map<string, LiveSession>();
	readonly #onUpdate: (instanceId: string, update: SessionUpdate) => void;

	constructor(onUpdate: (instanceId: string, update: SessionUpdate) => void) {
		this.#onUpdate = onUpdate;
	}

	get(instanceId: string): LiveSession | undefined {
		return this.#sessions.get(instanceId);
	}

	/** The live session that continues session file `sessionId`. */
	bySessionId(sessionId: string): LiveSession | undefined {
		return this.#bySessionId.get(sessionId);
	}

	/** Session `instanceId` when this dashboard started it: only those switch models and thinking levels. */
	started(instanceId: string): DashboardSession | undefined {
		const session = this.#sessions.get(instanceId);
		return session instanceof DashboardSession ? session : undefined;
	}

	/** An instance id with the emitter its session reports through, decided before the session spawns so that nothing it reports precedes it. */
	allocate(): { instanceId: string; emit: (update: SessionUpdate) => void } {
		const instanceId = newInstanceId();
		return {
			instanceId,
			emit: update => {
				if (update.kind === "switched") this.#reindex();
				this.#onUpdate(instanceId, update);
			},
		};
	}

	/** Lists `session`; `false` when it already finished, as a process that exited between its spawn and now, which would stay listed with no one to remove it. */
	add(session: LiveSession, subject: WorkItem | null): boolean {
		if (session.finished(Date.now())) return false;
		this.#sessions.set(session.instanceId, session);
		if (subject) this.#subjects.set(session.instanceId, subject);
		this.#reindex();
		return true;
	}

	remove(instanceId: string): void {
		if (!this.#sessions.delete(instanceId)) return;
		this.#subjects.delete(instanceId);
		this.#reindex();
		forgetSession(instanceId);
	}

	#reindex(): void {
		const index = new Map<string, LiveSession>();
		for (const session of this.#sessions.values()) if (!index.has(session.sessionId)) index.set(session.sessionId, session);
		this.#bySessionId = index;
	}

	/** Each session's roster row, with its `cwdDisplay` and what the session files' index knows of it. */
	rows(factsOf: (sessionId: string) => SessionFacts): RosterHost[] {
		return [...this.#sessions.values()].map(session => ({
			...session.row(),
			cwdDisplay: displayPath(session.cwd),
			...withSubject(factsOf(session.sessionId), this.#subjects.get(session.instanceId)),
		}));
	}

	/** The ids of the sessions that run now, which are not past sessions. */
	sessionIds(): Set<string> {
		return new Set([...this.#sessions.values()].map(session => session.sessionId));
	}

	/** The running sessions that this dashboard started, each with whether its turn runs (or waits on a question). */
	startedHere(): Map<string, boolean> {
		return new Map([...this.#sessions.values()].flatMap(session => (session instanceof DashboardSession ? [[session.sessionId, session.status !== "idle"] as const] : [])));
	}

	/** The directories running sessions work in. */
	cwds(): string[] {
		return [...this.#sessions.values()].map(session => session.cwd);
	}

	/** Follow the registry: drop what it no longer lists or let go of, join new hosts. Whether a session joined or left. */
	follow(hosts: HostSnapshot[]): boolean {
		const before = this.#sessions.size;
		const listed = new Map(hosts.map(host => [host.instanceId, host]));
		const now = Date.now();
		for (const [instanceId, session] of this.#sessions) {
			session.follow(listed);
			if (session.finished(now)) this.remove(instanceId);
		}
		const kept = this.#sessions.size;
		for (const host of hosts) {
			if (!this.#sessions.has(host.instanceId)) {
				this.#sessions.set(host.instanceId, new SessionGuest(host, update => this.#onUpdate(host.instanceId, update)));
			}
		}
		this.#reindex();
		return kept !== before || this.#sessions.size !== kept;
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.#sessions.values()].map(session => session.dispose()));
	}
}
