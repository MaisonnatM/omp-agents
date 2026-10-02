/** Every session the dashboard can drive, in one registry: terminal sessions it joined, and sessions it started. */
import { forgetSession } from "../commands";
import { DashboardSession, type DashboardUpdate, newInstanceId } from "../dashboard-session";
import { SessionGuest } from "../guest";
import type { LiveSession, LiveUpdate, SessionFacts } from "../live-session";
import type { HostSnapshot } from "../omp/collab";
import type { RosterHost } from "../shared";

export type SessionUpdate = LiveUpdate | DashboardUpdate;

export class LiveSessions {
	readonly #sessions = new Map<string, LiveSession>();
	readonly #onUpdate: (instanceId: string, update: SessionUpdate) => void;

	constructor(onUpdate: (instanceId: string, update: SessionUpdate) => void) {
		this.#onUpdate = onUpdate;
	}

	get(instanceId: string): LiveSession | undefined {
		return this.#sessions.get(instanceId);
	}

	/** An instance id with the emitter its session reports through, decided before the session spawns so that nothing it reports precedes it. */
	allocate(): { instanceId: string; emit: (update: SessionUpdate) => void } {
		const instanceId = newInstanceId();
		return { instanceId, emit: update => this.#onUpdate(instanceId, update) };
	}

	add(session: LiveSession): void {
		this.#sessions.set(session.instanceId, session);
	}

	remove(instanceId: string): void {
		if (this.#sessions.delete(instanceId)) forgetSession(instanceId);
	}

	rows(factsOf: (sessionId: string) => SessionFacts): RosterHost[] {
		return [...this.#sessions.values()].map(session => session.row(factsOf(session.sessionId)));
	}

	/** The ids of the sessions that run now, which are not past sessions. */
	sessionIds(): Set<string> {
		return new Set([...this.#sessions.values()].map(session => session.sessionId));
	}

	/** The ids of the running sessions that this dashboard started. */
	startedHere(): Set<string> {
		return new Set([...this.#sessions.values()].flatMap(session => (session instanceof DashboardSession ? [session.sessionId] : [])));
	}

	/** The directories running sessions work in. */
	cwds(): string[] {
		return [...this.#sessions.values()].map(session => session.cwd);
	}

	/** Follow the registry: drop what it no longer lists, join new hosts. */
	follow(hosts: HostSnapshot[]): void {
		const listed = new Map(hosts.map(host => [host.instanceId, host]));
		for (const [instanceId, session] of this.#sessions) if (!session.follow(listed)) this.remove(instanceId);
		for (const host of hosts) {
			if (!this.#sessions.has(host.instanceId)) {
				this.#sessions.set(host.instanceId, new SessionGuest(host, update => this.#onUpdate(host.instanceId, update)));
			}
		}
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.#sessions.values()].map(session => session.dispose()));
	}
}
