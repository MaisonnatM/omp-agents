/** Starting a dashboard session: a new one, a fork of a transcript, or a past session resumed. All three spawn omp the same way. */
import { withPinnedSkill } from "../commands";
import { DashboardSession, type DashboardUpdate, recordedCwd } from "../dashboard-session";
import { checkoutDir, worktreeAt } from "../git";
import { errorText } from "../json";
import { endedTurn, skipRefused } from "../live-session";
import { type AdmittedLaunch, keptSessions, type RpcLaunch } from "../omp/rpc";
import { continuationOf } from "../omp/sessions";
import { directoryOf, displayPath } from "../paths";
import { formatOf } from "../session-formats";
import { type PromptImage, type SessionFacts, type StartFailure, type StartRequest, type StartResult, type TaskOwner, type View } from "../shared/sessions";
import { pullRequestTask, taskConflict, taskIdentity, ticketTask } from "../task-claims";
import { portFromEnv } from "./address";
import type { LiveSessions } from "./live-sessions";
import type { PrivateSessions } from "./private-sessions";
import { UntrustedProjectError } from "./project-trust-file";

/** How a start joins the server: what omp launches with, and what links the session once it is in the registry, before its first prompt. */
export interface SessionJoin {
	rpc: RpcLaunch;
	attach(session: { instanceId: string; sessionId: string; cwd: string }): void;
}

interface Started {
	session: DashboardSession;
	/** The text of the prompt a fork branched at. */
	prompt: string | null;
	/** A new session's first message, sent once the session is in the registry. */
	first?: { text: string; images: PromptImage[] };
	discard?: () => Promise<void>;
}

type Outcome = { started: Started; join: SessionJoin } | StartFailure;

type Spawn = (instanceId: string, emit: (update: DashboardUpdate) => void, rpc: AdmittedLaunch) => Promise<Started>;

export interface StartEnv {
	sessions: LiveSessions;
	/** The file a view reads, or `null` while it is not known. */
	pathFor(view: View): string | null;
	/** The file of past session `sessionId`, or `null` while it is not listed. */
	savedFile(sessionId: string): string | null;
	/** Saved explicit task links; a failed lookup must throw rather than launch unclaimed. */
	factsFor(sessionId: string): SessionFacts;
	/** Called once a started session is in the registry. */
	onStarted(): void;
	/** The workspace directory `cwd` counts in, asking git when it was not asked about yet. */
	workspaceOf(cwd: string): Promise<string>;
	/** Links todo `todoId` to session `sessionId`, which a new session started for it, and moves a todo not started yet to In Progress. */
	linkTodo(todoId: string, sessionId: string): void;
	/** How a start, or the resume of an attached session, joins the server as session `instanceId`. */
	joinFor(request: StartRequest, instanceId: string): SessionJoin;
	/** Lets omp spawn in `cwd`, or throws {@link UntrustedProjectError} while its project's agent code is not trusted as it is now. */
	admit(cwd: string): Promise<void>;
	privateSessions: Pick<PrivateSessions, "launch" | "holds">;
}

export type Starter = (request: StartRequest) => Promise<StartResult>;

/** Runs `start` requests; one ready session per success, none on failure. */
export function createStarter(env: StartEnv): Starter {
	const { sessions } = env;
	/** Past sessions being resumed, so a second click starts no second omp on the same file. */
	const resuming = new Set<string>();

	/** Spawns `request`'s session through `spawn`, with the join of the instance id it gets and the admission of its directory. */
	async function launch(request: StartRequest, failure: string, spawn: Spawn, allocated = sessions.allocate()): Promise<Outcome> {
		const { instanceId, emit } = allocated;
		const join = env.joinFor(request, instanceId);
		try {
			return { started: await spawn(instanceId, emit, { ...join.rpc, admit: env.admit }), join };
		} catch (err) {
			if (err instanceof UntrustedProjectError) return { error: err.message, trust: err.ask };
			return { error: `${failure}: ${errorText(err)}` };
		}
	}

	/**
	 * Owns a launch's task claim: reserves `identity` in `cwd`'s repository before `body` can check out or spawn, hands the
	 * claim to the session `body` started, and releases it whenever `body` started none.
	 */
	async function claimed(identity: string | null, cwd: string, body: (allocated: ReturnType<LiveSessions["allocate"]>) => Promise<Outcome>): Promise<Outcome> {
		const allocated = sessions.allocate();
		if (!identity) return body(allocated);
		try {
			const claim = await sessions.reserveTask(identity, allocated.instanceId, cwd, env.factsFor);
			if (claim) return { error: taskConflict(claim), owner: ownerOf(claim) };
		} catch (error) {
			return { error: `Cannot claim the task: ${errorText(error)}` };
		}
		const outcome = await body(allocated).catch((error: unknown) => {
			sessions.releaseTask(allocated.instanceId);
			throw error;
		});
		if (!("started" in outcome)) {
			sessions.releaseTask(allocated.instanceId);
			return outcome;
		}
		const { session, discard } = outcome.started;
		try {
			sessions.bindTask(session);
			return outcome;
		} catch (error) {
			// Never leave a writer running when its durable ownership could not be established.
			await session.end();
			sessions.releaseTask(allocated.instanceId);
			await discard?.();
			return { error: `Cannot register the session's task ownership: ${errorText(error)}` };
		}
	}

	/** The session that holds `claim`, named when this dashboard runs it. */
	function ownerOf(claim: { instanceId: string; cwd: string; port: number }): TaskOwner {
		const cwdDisplay = displayPath(claim.cwd);
		if (claim.port !== portFromEnv()) return { here: false, port: claim.port, cwdDisplay };
		return { here: true, instanceId: claim.instanceId, sessionName: sessions.started(claim.instanceId)?.sessionName ?? null, cwdDisplay };
	}

	/** Prepares a new, forked, or resumed session, which {@link launch} spawns. */
	async function spawnFor(request: StartRequest): Promise<Outcome> {
		switch (request.kind) {
			case "new": {
				const dir = await directoryOf(request.cwd);
				if (!dir) return { error: `${request.cwd.trim()} is not a directory.` };
				// omp writes a fresh session's file only with its first reply, so a first `!` command would show nowhere.
				if (request.prompt.startsWith("!")) return { error: "Start the session with a prompt. A ! command runs once omp has replied." };
				const { branch, model, thinking, skill, images } = request;
				return claimed(taskIdentity(request), dir, async allocated => {
					let cwd = dir;
					// A ticket names no repository, so its branch applies only when the workspace it starts from is a git checkout.
					if (branch && (branch.kind !== "work" || (await worktreeAt(dir)))) {
						try {
							cwd = await checkoutDir(dir, branch);
						} catch (err) {
							return { error: `Cannot check out ${branch.name}: ${errorText(err)}` };
						}
					}
					let text: string;
					try {
						text = await withPinnedSkill(cwd, skill, request.prompt);
					} catch (err) {
						return { error: `Cannot read the skills in ${cwd}: ${errorText(err)}` };
					}
					return launch(request, "Cannot start omp", async (id, emit, rpc) => {
						const { rpc: launched, discard } = request.private ? await env.privateSessions.launch(id, cwd, rpc) : { rpc, discard: undefined };
						try {
							return { session: await DashboardSession.start(id, cwd, model, thinking, launched, emit, request.private), prompt: null, first: { text, images }, discard };
						} catch (error) {
							await discard?.();
							throw error;
						}
					}, allocated);
				});
			}
			case "fork": {
				const source = env.pathFor(request.view);
				if (!source) return { error: "Cannot fork: this session's file is not known yet." };
				if (formatOf(source).source !== "omp") return { error: "Cannot fork: this session is read-only. Only omp sessions fork here." };
				if (env.privateSessions.holds(source)) return { error: "Cannot fork: a private session is deleted when it ends, so nothing copies it." };
				return launch(request, "Cannot fork", async (id, emit, rpc) => DashboardSession.fork(id, source, request.entryId, rpc, emit));
			}
			case "resume": {
				const { sessionId } = request;
				if (sessions.sessionIds().has(sessionId) || resuming.has(sessionId)) return { error: "This session is already running." };
				const asked = env.savedFile(sessionId);
				if (!asked) return { error: "Cannot resume: this session's file is not known." };
				if (formatOf(asked).source !== "omp") return { error: "Cannot resume: this session is read-only. Only omp sessions resume here." };
				resuming.add(sessionId);
				// The id of the copy this resume opens, held while it starts, as `sessionId` is.
				let held: string | null = null;
				try {
					let identity: string | null;
					let path: string;
					let cwd: string;
					try {
						// Where omp went on in a new file, resume opens that copy, as `omp --resume` does; omp's `switch_session` opens only the file it is given.
						const copy = await continuationOf(asked);
						if (copy) {
							if (sessions.sessionIds().has(copy.id) || resuming.has(copy.id)) return { error: "This session is already running." };
							held = copy.id;
							resuming.add(held);
						}
						path = copy?.path ?? asked;
						const facts = env.factsFor(sessionId);
						const ticket = facts.tickets[0];
						const pr = facts.pullRequests[0];
						identity = sessions.savedTask(sessionId) ?? (ticket ? ticketTask(ticket) : pr ? pullRequestTask(pr) : null);
						cwd = await recordedCwd(path);
					} catch (error) {
						return { error: `Cannot resume: ${errorText(error)}` };
					}
					return await claimed(identity, cwd, allocated => launch(request, "Cannot resume", async (id, emit, rpc) => ({ session: await DashboardSession.resume(id, path, rpc, emit), prompt: null }), allocated));
				} finally {
					resuming.delete(sessionId);
					if (held !== null) resuming.delete(held);
				}
			}
		}
	}

	return async request => {
		const outcome = await spawnFor(request);
		if ("error" in outcome) return { ok: false, ...outcome };
		const { session, prompt, first } = outcome.started;
		// A session whose omp exited since it spawned would stay in the roster with no one to remove it.
		if (!sessions.add(session, request.kind === "new" ? request.subject : null)) {
			sessions.releaseTask(session.instanceId);
			const cleanup = await Promise.resolve(outcome.started.discard?.()).then(() => "", error => `; ${errorText(error)}`);
			return { ok: false, error: `omp exited as the session started.${cleanup}` };
		}
		// The todo links first, so the session's first turn already knows the todo it works on.
		if (request.kind === "new" && request.todoId) env.linkTodo(request.todoId, session.sessionId);
		outcome.join.attach(session);
		// The new session's first message goes in once it is in the registry, where its events find their view.
		if (first) void session.prompt(null, first.text, first.images, "steer").catch(skipRefused);
		// Asked before the roster lists the session, so that its first row already counts in its workspace.
		const workspace = await env.workspaceOf(session.cwd);
		env.onStarted();
		return { ok: true, instanceId: session.instanceId, workspace, prompt };
	};
}

/** A session attached to but not listed yet, which holds back what it reports until it is. */
interface Attached {
	session: DashboardSession;
	/** Passes on what the session reported while it attached, then lets each report through as it comes. */
	publish(): void;
}

/** Attaches to session `instanceId`, private when `isPrivate`; `null` when it cannot, which leaves its omp running for the next server. */
async function attach(sessions: LiveSessions, joinFor: StartEnv["joinFor"], instanceId: string, isPrivate: boolean): Promise<Attached | null> {
	const { emit } = sessions.allocate(instanceId);
	const held: DashboardUpdate[] = [];
	let report = (update: DashboardUpdate): void => void held.push(update);
	try {
		const session = await DashboardSession.reattach(instanceId, sessionId => joinFor({ kind: "resume", sessionId }, instanceId).rpc.tools, update => report(update), isPrivate);
		return {
			session,
			publish: () => {
				report = emit;
				for (const update of held.splice(0)) emit(update);
			},
		};
	} catch (err) {
		console.error(`omp-agents: cannot attach to session ${instanceId}: ${errorText(err)}`);
		return null;
	}
}

/**
 * Attaches to every session a previous server started whose omp still runs, and hands `recover` the session ids of
 * those that survived; it answers those whose turn ran when the last server stopped. Only then does it list each again,
 * under the instance id it had, with the turn it left unread, or the one it ended while no server listened, and pass
 * on what it reported, so no report reaches the server before it knows which sessions survived. One it reaches but
 * cannot attach to runs on unlisted, and the next server tries again. `isPrivate` tells the private ones.
 */
export async function reattachAll(
	sessions: LiveSessions,
	joinFor: StartEnv["joinFor"],
	isPrivate: (instanceId: string) => boolean,
	recover: (survived: ReadonlySet<string>) => ReadonlySet<string>,
): Promise<void> {
	const attached = (await Promise.all(keptSessions().map(instanceId => attach(sessions, joinFor, instanceId, isPrivate(instanceId))))).filter(
		(kept): kept is Attached => kept !== null && !kept.session.finished(),
	);
	const midTurn = recover(new Set(attached.map(({ session }) => session.sessionId)));
	sessions.restoreUnread(new Set(attached.map(({ session }) => session.instanceId)));
	for (const { session, publish } of attached) {
		sessions.bindTask(session);
		sessions.add(session, null);
		// Its turn ran when the last server stopped and ended while no server listened, so nobody heard its agent_end.
		const ended = midTurn.has(session.sessionId) && session.status === "idle" && session.sessionFile ? endedTurn(session.sessionFile) : null;
		if (ended) sessions.markUnread(session.instanceId, ended);
		joinFor({ kind: "resume", sessionId: session.sessionId }, session.instanceId).attach(session);
		publish();
	}
}
