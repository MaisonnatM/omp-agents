/** Every session the dashboard can drive, in one registry: terminal sessions it joined, and sessions it started. */
import { forgetSession } from "../commands";
import { DashboardSession, type DashboardUpdate, newInstanceId } from "../dashboard-session";
import { SessionGuest } from "../guest";
import { repositoryAt } from "../git";
import type { LiveSession, LiveUpdate } from "../live-session";
import type { HostSnapshot } from "../omp/collab";
import { displayPath } from "../paths";
import { oneLine } from "../session-entries";
import { type RosterHost, type SessionFacts, type UnreadTurn, type WorkItem, worksOn } from "../shared/sessions";
import { pullRequestTask, TaskClaims, ticketTask } from "../task-claims";
import { portFromEnv } from "./address";

export type SessionUpdate = LiveUpdate | DashboardUpdate;

/** `facts` with `subject` first among the session's links, unless its tool calls named it already. */
export function withSubject(facts: SessionFacts, subject: WorkItem | undefined): SessionFacts {
	if (!subject || worksOn(facts, subject)) return facts;
	return subject.kind === "ticket" ? { ...facts, tickets: [subject.id, ...facts.tickets] } : { ...facts, pullRequests: [{ ...subject.pr, link: "worked" }, ...facts.pullRequests] };
}

/** The first line of `reply` that holds text, as one summary line. */
function firstLine(reply: string | null): string | null {
	const line = reply?.split("\n").find(text => text.trim());
	return line ? oneLine(line) : null;
}

export class LiveSessions {
	readonly #sessions = new Map<string, LiveSession>();
	/** What the sessions started from a quick action work on, by instance id, for as long as they run. */
	readonly #subjects = new Map<string, WorkItem>();
	/** The turn each session ended since a page showed it in a focused window, by instance id. */
	readonly #unread = new Map<string, UnreadTurn>();
	/**
	 * The sessions by the session file they continue, the earliest added first. A session's id changes when omp moves it to
	 * another file or the registry lists its host on another session, so the index is rebuilt where either can happen.
	 */
	#bySessionId = new Map<string, LiveSession>();
	readonly #onUpdate: (instanceId: string, update: SessionUpdate) => void;
	readonly #taskClaims: TaskClaims;

	constructor(onUpdate: (instanceId: string, update: SessionUpdate) => void, taskClaims = new TaskClaims()) {
		this.#onUpdate = onUpdate;
		this.#taskClaims = taskClaims;
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

	/**
	 * An instance id with the emitter its session reports through, decided before the session spawns so that nothing it
	 * reports precedes it; a session a previous server started keeps its `instanceId`.
	 */
	allocate(instanceId = newInstanceId()): { instanceId: string; emit: (update: SessionUpdate) => void } {
		return {
			instanceId,
			emit: update => {
				if (update.kind === "switched") this.#reindex();
				this.#onUpdate(instanceId, update);
			},
		};
	}

	/**
	 * Reserves task `identity` in `cwd`'s repository for `instanceId` before any checkout or process can write, and answers
	 * the claim of whoever already works on it, a running session that predates claims included, or `null` once reserved.
	 */
	async reserveTask(identity: string, instanceId: string, cwd: string, factsOf: (sessionId: string) => SessionFacts) {
		const repository = await repositoryAt(cwd) ?? cwd;
		return await this.#runningTask(repository, identity, factsOf) ?? this.#taskClaims.claim(repository, identity, instanceId, cwd);
	}

	/** Includes terminal and pre-claim dashboard sessions already known by the running-session registry. */
	async #runningTask(repository: string, identity: string, factsOf: (sessionId: string) => SessionFacts) {
		for (const session of this.#sessions.values()) {
			if (session.finished(Date.now())) continue;
			const savedIdentity = this.#taskClaims.identityForInstance(session.instanceId);
			let matches = savedIdentity === identity;
			if (!savedIdentity) {
				const facts = withSubject(factsOf(session.sessionId), this.#subjects.get(session.instanceId));
				matches = facts.tickets.some(id => identity === ticketTask(id)) || facts.pullRequests.some(pr => identity === pullRequestTask(pr));
			}
			if (matches && (await repositoryAt(session.cwd) ?? session.cwd) === repository) {
				return { identity, instanceId: session.instanceId, sessionId: session.sessionId, cwd: session.cwd, port: portFromEnv() };
			}
		}
		return null;
	}

	/** The explicit startup identity retained by a saved session, before its inferred links. */
	savedTask(sessionId: string): string | null {
		return this.#taskClaims.identityForSession(sessionId);
	}

	/** Hands claim `instanceId` to its spawned session's process, which then owns it across dashboard restarts. */
	bindTask({ instanceId, pid, sessionId, cwd }: { instanceId: string; pid: number; sessionId: string; cwd: string }): void {
		this.#taskClaims.bind(instanceId, pid, sessionId, cwd);
	}

	/** Releases a failed launch as well as an ended session. */
	releaseTask(instanceId: string): void {
		this.#taskClaims.release(instanceId);
	}

	/** Session `instanceId` ended a turn with `reply`, which stays unread until a look or its next turn reads it. */
	markUnread(instanceId: string, reply: string | null): void {
		this.#unread.set(instanceId, { at: Date.now(), reply: firstLine(reply) });
	}

	/** A page showed session `instanceId` in a focused window, or its next turn started; whether it had a turn unread. */
	markRead(instanceId: string): boolean {
		return this.#unread.delete(instanceId);
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
		this.releaseTask(instanceId);
		if (!this.#sessions.delete(instanceId)) return;
		this.#subjects.delete(instanceId);
		this.#unread.delete(instanceId);
		this.#reindex();
		forgetSession(instanceId);
	}

	#reindex(): void {
		const index = new Map<string, LiveSession>();
		for (const session of this.#sessions.values()) if (!index.has(session.sessionId)) index.set(session.sessionId, session);
		this.#bySessionId = index;
	}

	/** Each session's roster row, with its `cwdDisplay`, its unread turn, and what the session files' index knows of it. */
	rows(factsOf: (sessionId: string) => SessionFacts): RosterHost[] {
		return [...this.#sessions.values()].map(session => ({
			...session.row(),
			cwdDisplay: displayPath(session.cwd),
			unread: this.#unread.get(session.instanceId) ?? null,
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
