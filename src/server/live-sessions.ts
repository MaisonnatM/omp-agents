/** Every session the dashboard can drive, in one registry: terminal sessions it joined, and sessions it started. */
import { forgetSession } from "../commands";
import { DashboardSession, type DashboardUpdate, newInstanceId } from "../dashboard-session";
import { JsonFile } from "../fs";
import { SessionGuest } from "../guest";
import { repositoryAt } from "../git";
import { arrayOf, decoder, fields, isNumber, isString, nullable, optional } from "../json";
import { type EndedTurn, endedTurn, type LiveSession, type LiveUpdate } from "../live-session";
import type { HostSnapshot } from "../omp/collab";
import { displayPath, unreadFile } from "../paths";
import { oneLine } from "../session-entries";
import { type RosterHost, type SessionFacts, type UnreadTurn, type WorkItem, worksOn } from "../shared/sessions";
import { pullRequestTask, TaskClaims, ticketTask } from "../task-claims";
import { portFromEnv } from "./address";
import { TurnWaits } from "./turn-waits";

export type SessionUpdate = LiveUpdate | DashboardUpdate;

/** An unread turn with the instance id of the session that ended it, as the unread file holds it. */
type SavedTurn = { instanceId: string } & UnreadTurn;

/**
 * The turns no page read yet, and when the server that saved them last saved, until which it heard every turn of the
 * sessions it followed end, since it saves each turn it hears end at once. A file an older server saved leaves it out.
 */
interface SavedUnread {
	turns: SavedTurn[];
	heardUntil?: number;
}

const isSavedUnread = fields<SavedUnread>({
	turns: arrayOf(fields<SavedTurn>({ instanceId: isString, at: isNumber, reply: nullable(isString) })),
	heardUntil: optional(isNumber),
});

/** An ended turn as a row shows it unread. */
const unreadTurn = ({ at, reply }: EndedTurn): UnreadTurn => ({ at, reply: firstLine(reply) });

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
	/** The turn each session ended since a page showed it in a focused window, by instance id; {@link #unreadFile} keeps them across restarts. */
	readonly #unread = new Map<string, UnreadTurn>();
	readonly #unreadFile: JsonFile<SavedUnread>;
	/** The unread turn each session's running turn read as it started, by instance id, which a quiet end gives back. */
	readonly #readByTurn = new Map<string, UnreadTurn>();
	/** Whether each session's main agent waits on work it started, which its row's `turnWaits` shows. */
	readonly #turnWaits = new TurnWaits();
	/**
	 * The turns the previous server saved unread, with its `heardUntil`: `unrestored` until {@link restoreUnread} takes back
	 * those of the sessions this server attached to, then `listing` until the first registry listing after it, which
	 * {@link restoreListedUnread} restores the terminal sessions' at, then `restored`. Every save until then keeps the turns
	 * not taken back and that `heardUntil`, so nothing marked earlier writes over them.
	 */
	#restore: { phase: "unrestored" | "listing"; turns: Map<string, UnreadTurn>; heardUntil: number | undefined } | { phase: "restored" };
	/**
	 * The sessions by the session file they continue, the earliest added first. A session's id changes when omp moves it to
	 * another file or the registry lists its host on another session, so the index is rebuilt where either can happen.
	 */
	#bySessionId = new Map<string, LiveSession>();
	readonly #onUpdate: (instanceId: string, update: SessionUpdate) => void;
	readonly #taskClaims: TaskClaims;

	constructor(onUpdate: (instanceId: string, update: SessionUpdate) => void, taskClaims = new TaskClaims(), unreadPath = unreadFile) {
		this.#onUpdate = onUpdate;
		this.#taskClaims = taskClaims;
		this.#unreadFile = new JsonFile(unreadPath, { parse: decoder(isSavedUnread), holds: "a list of unread turns", onInvalid: "ignore" });
		const saved = this.#unreadFile.load();
		// A file an older server saved may hold more of each turn; only `at` and `reply` come back.
		const turns = new Map((saved?.turns ?? []).map(({ instanceId, at, reply }) => [instanceId, { at, reply }]));
		this.#restore = { phase: "unrestored", turns, heardUntil: saved?.heardUntil };
	}

	get(instanceId: string): LiveSession | undefined {
		return this.#sessions.get(instanceId);
	}

	/** The live session that continues session file `sessionId`. */
	bySessionId(sessionId: string): LiveSession | undefined {
		return this.#bySessionId.get(sessionId);
	}

	/** The last reply in session `sessionId`'s file, of its running or last turn, `null` when it has none; `savedFile` finds the file of one that no longer runs. */
	lastReply(sessionId: string, savedFile: (sessionId: string) => string | null): string | null {
		const file = this.#bySessionId.get(sessionId)?.transcriptPath(null, savedFile) ?? savedFile(sessionId);
		return file ? (endedTurn(file)?.reply ?? null) : null;
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

	/** Session `instanceId` ended `turn`, which stays unread until a look or its next turn reads it, across restarts. */
	markUnread(instanceId: string, turn: EndedTurn): void {
		this.#readByTurn.delete(instanceId);
		this.#unread.set(instanceId, unreadTurn(turn));
		this.#saveUnread();
	}

	/** A page showed session `instanceId` in a focused window; whether it had a turn unread. */
	markRead(instanceId: string): boolean {
		this.#readByTurn.delete(instanceId);
		if (!this.#unread.delete(instanceId)) return false;
		this.#saveUnread();
		return true;
	}

	/** Session `instanceId`'s main agent reported `event`; whether that changed its row's `turnWaits`. */
	heard(instanceId: string, event: unknown): boolean {
		return this.#turnWaits.heard(instanceId, event);
	}

	/** Session `instanceId` started a turn, which reads its unread turn unless the turn ends quietly; whether it had one. */
	turnStarted(instanceId: string): boolean {
		const turn = this.#unread.get(instanceId);
		if (!turn) return false;
		this.#unread.delete(instanceId);
		this.#readByTurn.set(instanceId, turn);
		this.#saveUnread();
		return true;
	}

	/**
	 * Session `instanceId` ended its turn: `turn` stays unread as {@link markUnread} keeps it, and a quiet turn, `null`, gives
	 * back the unread turn its start read, under its own `at`, which the page's alert already heard, so it raises none again.
	 */
	turnEnded(instanceId: string, turn: EndedTurn | null): void {
		const held = this.#readByTurn.get(instanceId);
		this.#readByTurn.delete(instanceId);
		if (turn) this.markUnread(instanceId, turn);
		else if (held) {
			this.#unread.set(instanceId, held);
			this.#saveUnread();
		}
	}

	/**
	 * The turns sessions `instanceIds` ended unread under the previous server come back, unless this server marked a newer
	 * one; the other saved turns wait for {@link restoreListedUnread}, since a terminal session may have ended them. Called
	 * once, by reattachAll.
	 */
	restoreUnread(instanceIds: ReadonlySet<string>): void {
		if (this.#restore.phase !== "unrestored") return;
		const { turns, heardUntil } = this.#restore;
		for (const instanceId of instanceIds) {
			const turn = turns.get(instanceId);
			if (!turn) continue;
			turns.delete(instanceId);
			if (!this.#unread.has(instanceId)) this.#unread.set(instanceId, turn);
		}
		this.#restore = { phase: "listing", turns, heardUntil };
	}

	/**
	 * At the first registry listing after {@link restoreUnread}, each terminal session of `hosts` gets back its unread turn:
	 * none while a turn runs; else the last turn of its session file, which `savedFile` finds by session id, when it came
	 * after the previous server's `heardUntil`, and none while the host cannot tell whether that turn still runs; else the
	 * turn saved before the restart. A session this server started is left as reattachAll settled it. The saved turns of
	 * the sessions it does not list are forgotten; a listing before {@link restoreUnread} or after the first changes nothing.
	 */
	restoreListedUnread(hosts: HostSnapshot[], savedFile: (sessionId: string) => string | null): void {
		if (this.#restore.phase !== "listing") return;
		const { turns, heardUntil } = this.#restore;
		this.#restore = { phase: "restored" };
		for (const host of hosts) {
			if (!(this.#sessions.get(host.instanceId) instanceof SessionGuest)) continue;
			const file = savedFile(host.sessionId);
			const missed = file === null || heardUntil === undefined ? null : endedTurn(file, heardUntil);
			// A running turn read the one before, as its `turn-started` would have, and a missed turn counts once the host says it ended.
			const turn = host.busy === true ? undefined : missed === null ? turns.get(host.instanceId) : host.busy === false ? unreadTurn(missed) : undefined;
			if (turn) this.#unread.set(host.instanceId, turn);
		}
		this.#saveUnread();
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
		this.#readByTurn.delete(instanceId);
		this.#turnWaits.forget(instanceId);
		if (this.#unread.delete(instanceId)) this.#saveUnread();
		this.#reindex();
		forgetSession(instanceId);
	}

	#reindex(): void {
		const index = new Map<string, LiveSession>();
		for (const session of this.#sessions.values()) if (!index.has(session.sessionId)) index.set(session.sessionId, session);
		this.#bySessionId = index;
	}

	#saveUnread(): void {
		const saved = this.#restore.phase === "restored" ? null : this.#restore;
		const turns = new Map([...(saved?.turns ?? []), ...this.#unread]);
		// Until the first listing after the restore, this server has heard no terminal session, so it keeps the previous server's time.
		const heardUntil = saved ? saved.heardUntil : Date.now();
		this.#unreadFile.save({ turns: [...turns].map(([instanceId, turn]) => ({ instanceId, ...turn })), heardUntil });
	}

	/** Each session's roster row, with its `cwdDisplay`, its unread turn, whether its turn waits, and what the session files' index knows of it, asked with the directory it runs in now. */
	rows(factsOf: (sessionId: string, cwd: string) => SessionFacts): RosterHost[] {
		return [...this.#sessions.values()].map(session => ({
			...session.row(),
			cwdDisplay: displayPath(session.cwd),
			unread: this.#unread.get(session.instanceId) ?? null,
			turnWaits: this.#turnWaits.waits(session.instanceId),
			...withSubject(factsOf(session.sessionId, session.cwd), this.#subjects.get(session.instanceId)),
		}));
	}

	/** The ids of the sessions that run now, which are not past sessions. */
	sessionIds(): Set<string> {
		return new Set([...this.#sessions.values()].map(session => session.sessionId));
	}

	/** The running sessions that this dashboard started, each with whether its turn runs (or waits on a question), leaving out private ones. */
	startedHere(): Map<string, boolean> {
		return new Map(
			[...this.#sessions.values()].flatMap(session => (session instanceof DashboardSession && !session.private ? [[session.sessionId, session.status !== "idle"] as const] : [])),
		);
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
