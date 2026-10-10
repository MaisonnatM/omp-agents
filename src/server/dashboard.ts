/**
 * The dashboard behind the server: the registries and stores, the live sessions and the views on them, and the loops and
 * inboxes that keep them current. It builds its parts in dependency order, each handed the parts above it.
 * Two edges point down, closing the only cycles: a live session's update reaches the views, the broadcasts, the routines,
 * and the loops through its live-update handler, and a notice change reaches the broadcasts that read the notices.
 * No constructor calls either; nothing follows the registry, watches a directory, or publishes before {@link Dashboard.start}.
 */
import { rmSync } from "node:fs";
import type { Server } from "bun";
import { flushJsonFiles } from "../fs";
import { GoogleCalendarReader } from "../google-calendar";
import { loadPullRequests } from "../pull-requests";
import { integrationServer } from "../integrations";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { findMcpServer, mcpSignedIn, readWithMcpSignIn } from "../omp/mcp";
import { type HostSnapshot, listHosts } from "../omp/collab";
import { installedOmp, latestOmp, updateOmp } from "../omp/release";
import { sessionsDir } from "../omp/sessions";
import { stopStats } from "../omp/stats";
import { calendarsFile, directoryOf, displayPath, interruptedFile, noticesFile, oldGoogleFile, pinsFile, projectsFile, routinesFile, sessionEndInboxDir, serverLockFile, userTodoInboxDir, userTodosFile } from "../paths";
import { runShell } from "../proc";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT } from "../routines";
import { modelUpdates, upgradeModel } from "../settings";
import { MCP_SERVICES } from "../shared/accounts";
import { agentOn } from "../shared/moves";
import type { PinChange } from "../shared/pins";
import type { StartRequest, StartResult, View } from "../shared/sessions";
import { waitingOnYou } from "../slack-messages";
import { Terminals } from "../terminals";
import { DONE_KEPT_HOURS, startChanges } from "../user-todos";
import type { UserTodoChange } from "../user-todos-shared";
import { Worktrees } from "../worktrees";
import { Broadcasts } from "./broadcasts";
import { CalendarsFile } from "./calendars-file";
import { EndInbox } from "./end-inbox";
import type { Guards } from "./http";
import { InterruptedSessions } from "./interrupted";
import { LiveSessions, type SessionUpdate } from "./live-sessions";
import { Loops } from "./loops";
import { ACTIVITY_KINDS, Notices, UPDATE_KINDS } from "./notices";
import { OwnerLock } from "./owner-lock";
import { PinsFile } from "./pins-file";
import { ProjectsFile } from "./projects-file";
import { RoutineRunner } from "./routine-runner";
import { RoutinesFile } from "./routines-file";
import { createRoutes, type Routes } from "./routes";
import { endSession } from "./session-end";
import { SessionFiles } from "./session-files";
import { type ClientHandler, createClientHandler } from "./socket";
import { createStarter } from "./start";
import { TodoInbox } from "./todo-inbox";
import { UserTodosFile } from "./user-todos-file";
import { type Socket, send, Views } from "./views";
import { parseClientMsg } from "./wire";

/** What the dashboard publishes through once the server listens. */
type Publisher = Pick<Server<unknown>, "publish" | "subscriberCount">;

/** Everything the server serves, built once at startup; {@link Dashboard.start} sets it going and {@link Dashboard.stop} stops it. */
export class Dashboard {
	readonly #files = new SessionFiles();
	readonly #interrupted = new InterruptedSessions(interruptedFile);
	readonly #todos = new UserTodosFile(userTodosFile);
	readonly #routines = new RoutinesFile(routinesFile);
	readonly #projects = new ProjectsFile(projectsFile);
	readonly #pins = new PinsFile(pinsFile);
	readonly #calendars = new CalendarsFile(calendarsFile);
	/** The terminal panel's shells, which the server's `/ws/terminal` upgrades open and attach to. */
	readonly terminals = new Terminals();
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	readonly #stopping = new AbortController();
	/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the todo inbox. */
	readonly #ownerLock: OwnerLock;
	readonly #google: GoogleCalendarReader;
	readonly #sessions: LiveSessions;
	readonly #views: Views;
	readonly #notices: Notices;
	readonly #broadcasts: Broadcasts;
	readonly #todoInbox: TodoInbox;
	readonly #worktrees: Worktrees;
	readonly #startSession: (request: StartRequest) => Promise<StartResult>;
	readonly #endInbox: EndInbox;
	readonly #runner: RoutineRunner;
	readonly #loops: Loops;
	readonly #handleClientMsg: ClientHandler;
	/** The server, from {@link start} on; until then there is no socket to publish to. */
	#publisher: Publisher | null = null;
	/** Why the last registry listing failed, shown with the roster. */
	#rosterError: string | null = null;
	/** Whether the registry was listed since the last poll tick found no listener. */
	#registryFresh = false;
	/** Whether the activity was checked since the last activity tick found no listener. */
	#activityFresh = false;

	constructor(port: number) {
		const files = this.#files;
		const todos = this.#todos;
		const routines = this.#routines;
		const projects = this.#projects;
		const pins = this.#pins;
		const interrupted = this.#interrupted;
		const ownerLock = (this.#ownerLock = new OwnerLock(serverLockFile, port));
		// The calendars' secret addresses an older version kept read them; Google Calendar now reads through omp's sign-in.
		rmSync(oldGoogleFile, { force: true });
		const calendars = this.#calendars;
		this.#google = new GoogleCalendarReader(async url => readWithMcpSignIn(await integrationServer("google-calendar"), url), () => calendars.hidden);
		const sessions = (this.#sessions = new LiveSessions((instanceId, update) => this.#onLiveUpdate(instanceId, update)));
		const pathFor = (view: View): string | null =>
			view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
		const views = (this.#views = new Views(pathFor, (topic, msg) => void this.#publisher?.publish(topic, JSON.stringify(msg))));
		const notices = (this.#notices = new Notices(
			noticesFile,
			{
				latestOmp,
				installedOmp,
				updateOmp,
				modelUpdates,
				upgradeModel,
				pullRequests: async () => ({ list: await loadPullRequests(this.knownCwds(), false), agent: agentOn(sessions.rows(files.factsOf)) }),
				async slack() {
					const slack = await findMcpServer(MCP_SERVICES.slack.host);
					return slack && (await mcpSignedIn(slack)) ? waitingOnYou(url => readWithMcpSignIn(slack, url), Date.now()) : [];
				},
				now: Date.now,
			},
			() => this.#broadcasts.pushNotices(),
		));
		const broadcasts = (this.#broadcasts = new Broadcasts({
			roster: () => ({ hosts: sessions.rows(files.factsOf), error: this.#rosterError }),
			past: () => files.past(sessions.sessionIds(), id => interrupted.has(id)),
			userTodosMsg: () => ({ t: "user-todos", list: todos.list }),
			routinesMsg: () => ({ t: "routines", routines: routines.routines }),
			projectsMsg: () => {
				const [added, hidden] = [projects.list.added, projects.list.hidden].map(cwds => cwds.map(cwd => ({ cwd, cwdDisplay: displayPath(cwd) })));
				return { t: "projects", list: { added, hidden } };
			},
			pinsMsg: () => ({ t: "pins", sessionIds: pins.sessionIds }),
			noticesMsg: () => ({ t: "notices", list: notices.list }),
			publish: (topic, json) => void this.#publisher?.publish(topic, json),
			subscriberCount: topic => this.#publisher?.subscriberCount(topic) ?? 0,
			beforeRosterPush: () => views.sync(),
			saveRunning: () => interrupted.setRunning(sessions.startedHere()),
		}));
		this.#todoInbox = new TodoInbox(userTodoInboxDir, change => this.#applyTodo(change), { active: () => ownerLock.held });
		const starter = createStarter({
			sessions,
			pathFor,
			savedFile: files.pathOf,
			onStarted: () => broadcasts.syncRoster(),
			linkTodo: (todoId, sessionId) => {
				for (const change of startChanges(todos.list, todoId, sessionId, new Date().toISOString())) this.#applyTodo(change);
			},
		});
		const worktrees = (this.#worktrees = new Worktrees({
			knownCwds: () => this.knownCwds(),
			activity: () => files.activity(),
			serverCwd: process.cwd(),
			live() {
				return sessions.rows(files.factsOf).map(host => ({
					cwd: host.cwd,
					unknownAgents: host.control.phase !== "live" || host.agents.some(agent => (host.source === "terminal" ? agent.status !== "aborted" : agent.status === "running")),
				}));
			},
		}));
		const startSession = (this.#startSession = request => worktrees.start(() => starter(request), request.kind === "new" && request.branch !== null));
		this.#endInbox = new EndInbox(sessionEndInboxDir, {
			end: async sessionId => {
				const session = sessions.bySessionId(sessionId);
				// Every server follows a terminal session, so only the owner acts on its request; a session started here is this server's alone.
				if (!session || (!sessions.started(session.instanceId) && !ownerLock.held)) return false;
				await this.#endLive(session);
				return true;
			},
		});
		const stopping = this.#stopping.signal;
		const runner = (this.#runner = new RoutineRunner({
			file: routines,
			start: startSession,
			session(instanceId) {
				const session = sessions.get(instanceId);
				return session ? { status: session.row().status, sessionId: session.sessionId, end: () => session.end() } : null;
			},
			now: Date.now,
			async exec(command, cwd) {
				const dir = await directoryOf(cwd);
				if (!dir) throw new Error(`${cwd.trim()} is not a directory.`);
				return runShell(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS, maxOutput: MAX_COMMAND_OUTPUT, signal: stopping });
			},
			onChange: () => broadcasts.pushRoutines(),
			changePins: change => void this.#applyPinChange(change),
		}));
		this.#loops = new Loops(sessionsDir, {
			onRegistryTick: async () => {
				if (broadcasts.listening()) await this.#listRegistry();
				else this.#registryFresh = false;
			},
			onFileChange(path) {
				views.poke(path);
				return files.touch(path);
			},
			onListRefresh: async () => {
				if (await files.refresh()) this.#onFilesChanged();
			},
			onRescanTick: () => this.#rescanFiles(),
			onUsageTick: () => broadcasts.refreshUsage(),
			onMinuteTick: async () => {
				if (!this.#claimUnattendedWork()) return;
				this.#clearOldDone();
				await runner.tick();
			},
			onNoticeTick: () => notices.check(UPDATE_KINDS),
			onActivityTick: async () => {
				if (broadcasts.listening()) await this.#checkActivity();
				else this.#activityFresh = false;
			},
		});
		this.#handleClientMsg = createClientHandler({
			sessions,
			views,
			start: startSession,
			end: async instanceId => {
				const session = sessions.get(instanceId);
				if (session) await this.#endLive(session);
			},
			dismissInterrupted(sessionId) {
				if (interrupted.dismiss(sessionId)) broadcasts.pushPast();
			},
			stoppedMidTurn: sessionId => interrupted.stoppedMidTurn(sessionId),
			changeTodo: (ws, change) => {
				if (!this.#applyTodo(change)) send(ws, { t: "user-todos", list: todos.list });
			},
			changeRoutine(ws, change) {
				if (routines.apply(change, Date.now())) broadcasts.pushRoutines();
				else send(ws, { t: "routines", routines: routines.routines });
			},
			changePins: (ws, change) => {
				if (!this.#applyPinChange(change)) send(ws, { t: "pins", sessionIds: pins.sessionIds });
			},
			runRoutine: id => runner.runNow(id),
			changeNotices: (ids, op) => notices.apply(ids, op),
		});
	}

	/** The HTTP API over this dashboard, admitted by `guards`. */
	routes(guards: Guards): Routes {
		const files = this.#files;
		const sessions = this.#sessions;
		const broadcasts = this.#broadcasts;
		return createRoutes({
			guards,
			sessions: {
				knownCwds: () => this.knownCwds(),
				addedCwds: () => this.#projects.list.added,
				changeProjects: change => {
					if (this.#projects.apply(change)) broadcasts.pushProjects();
				},
				savedOf: files.savedOf,
				placeOf(sessionId) {
					const file = files.pathOf(sessionId);
					const saved = files.savedOf(sessionId);
					if (!file || !saved) return null;
					return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd };
				},
				learnHeads(repo, pullRequests) {
					if (files.facts.learnHeads(repo, pullRequests)) broadcasts.pushAll();
				},
			},
			integrations: {
				google: this.#google,
				setCalendarShown: (id, shown) => this.#calendars.setShown(id, shown),
			},
			files: { worktrees: this.#worktrees, terminals: this.terminals },
		});
	}

	/**
	 * Starts following omp: watches the session files and the inboxes, takes the owner lock when it is free, lists the
	 * files and the registry, and starts the loops; `publisher` is the server now listening.
	 */
	async start(publisher: Publisher): Promise<void> {
		this.#publisher = publisher;
		this.#loops.watch();
		if (this.#ownerLock.acquire()) {
			this.#runner.recover();
		} else {
			const owner = this.#ownerLock.holder();
			console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the todo inbox; this one takes over when it exits.`);
		}
		this.#todoInbox.watch();
		this.#endInbox.watch();
		await this.#rescanFiles();
		await this.#listRegistry();
		if (this.#ownerLock.held) this.#clearOldDone();
		this.#loops.start();
	}

	/**
	 * Stops everything that runs on its own first, so no tick publishes while the rest shuts down; then ends the sessions
	 * started here, hangs up on the shells, writes what the stores have not, and stops the routine commands still running.
	 */
	async stop(): Promise<void> {
		this.#loops.stop();
		this.#todoInbox.stop();
		this.#endInbox.stop();
		await this.#sessions.dispose();
		this.terminals.dispose();
		stopStats();
		flushJsonFiles();
		// Last, right before exit, so a stopped command's result is not saved as one stopped at its time limit.
		this.#stopping.abort();
	}

	/** What must happen however the process exits, even on a crash: the stores' pending writes, and the owner lock released. */
	exited(): void {
		flushJsonFiles();
		this.#ownerLock.release();
	}

	/** A dashboard socket opened. */
	open(ws: Socket): void {
		this.#broadcasts.open(ws);
		// The registry was not polled while nobody listened; list it now rather than at the next tick.
		if (!this.#registryFresh) void this.#listRegistry();
		if (!this.#activityFresh) void this.#checkActivity();
	}

	/** A message on a dashboard socket; one that is not a client message is dropped. */
	message(ws: Socket, raw: string | Buffer): void {
		const msg = parseClientMsg(raw)?.ok;
		if (msg) this.#handleClientMsg(ws, msg).catch((err: unknown) => console.error(`omp-agents: ${msg.t} failed: ${errorText(err)}`));
	}

	/** A dashboard socket closed: it watches no view any more. */
	close(ws: Socket): void {
		this.#views.watch(ws, []);
	}

	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[] {
		return [...new Set([...this.#sessions.cwds(), ...this.#files.cwds()].filter(Boolean))];
	}

	/** Where every live session's update goes: the views, the broadcasts, the routines, and the loops. */
	#onLiveUpdate(instanceId: string, update: SessionUpdate): void {
		switch (update.kind) {
			case "roster":
				this.#runner.observe(instanceId);
				this.#broadcasts.rosterChanged();
				return;
			case "event":
				this.#views.applyEvent(instanceId, update.event);
				return;
			case "note":
				this.#views.note(instanceId, update.agentId, update.level, update.text);
				return;
			case "exited": {
				// Only a session this dashboard started reports its exit.
				const sessionId = this.#sessions.get(instanceId)?.sessionId;
				if (sessionId && !update.ended) this.#interrupted.interrupt(sessionId);
				this.#sessions.remove(instanceId);
				this.#broadcasts.syncRoster();
				void this.#loops.listNow();
				return;
			}
			case "written":
				this.#loops.fileChanged(update.path);
				return;
			case "switched":
				// Before the edited prompt's events, so they land in the new file's transcript.
				this.#views.sync();
				this.#broadcasts.syncRoster();
				return;
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	}

	/** Applies `change` to the list, and sends every socket the list when it changed; whether it did. */
	#applyTodo(change: UserTodoChange): boolean {
		const changed = this.#todos.apply(change);
		if (changed) this.#broadcasts.pushUserTodos();
		return changed;
	}

	/** Moves todos checked over {@link DONE_KEPT_HOURS} ago to the archive. */
	#clearOldDone(): void {
		this.#applyTodo({ op: "clear-done", categoryId: null, before: new Date(Date.now() - DONE_KEPT_HOURS * 3_600_000).toISOString() });
	}

	/** Applies `change` to the pins, and sends every socket the pins when they changed; whether they did. */
	#applyPinChange(change: PinChange): boolean {
		const changed = this.#pins.apply(change);
		if (changed) this.#broadcasts.pushPins();
		return changed;
	}

	/** Ends `session` as **End session** does, then removes the linked worktree it worked in: the one its bash calls last ran in, else its own directory's. */
	#endLive(session: LiveSession): Promise<void> {
		return endSession(
			{ sessionId: session.sessionId, workDir: this.#files.factsOf(session.sessionId).worktree ?? session.cwd, end: () => session.end() },
			dir => this.#worktrees.removeCheckout(dir),
		);
	}

	/** Takes over routines and the todo inbox when the server that ran them is gone; whether this server runs them. */
	#claimUnattendedWork(): boolean {
		const was = this.#ownerLock.held;
		const owns = this.#ownerLock.acquire();
		if (owns && !was) {
			console.log("omp-agents: this server now runs routines and the todo inbox.");
			// What the server that ran them saved since this one started.
			this.#routines.reload();
			this.#todos.reload();
			this.#broadcasts.pushRoutines();
			this.#broadcasts.pushUserTodos();
			this.#runner.recover();
			void this.#todoInbox.drain();
		}
		return owns;
	}

	/** Checks the pull requests and Slack for the bell. */
	#checkActivity(): Promise<void> {
		this.#activityFresh = true;
		return this.#notices.check(ACTIVITY_KINDS);
	}

	/** The session list changed: views may now find their file, and the past list is out of date. */
	#onFilesChanged(): void {
		this.#views.sync();
		this.#broadcasts.pushPast();
		// The first scan reads every transcript; the list shows before it finishes.
		void this.#files.refreshFacts().then(changed => {
			if (changed) this.#broadcasts.pushAll();
		});
	}

	/** List every session file again, for the changes the watcher did not report. */
	async #rescanFiles(): Promise<void> {
		if (await this.#files.scan()) this.#onFilesChanged();
	}

	/** Lists the registry and follows it; its changes reach every socket. */
	async #listRegistry(): Promise<void> {
		let hosts: HostSnapshot[];
		try {
			hosts = await listHosts();
			this.#rosterError = null;
		} catch (err) {
			hosts = [];
			this.#rosterError = errorText(err);
		}
		this.#registryFresh = true;
		const joinedOrLeft = this.#sessions.follow(hosts);
		// A terminal session that asked to end before the registry listed it.
		void this.#endInbox.drain();
		// Every listing can change a host's row or the registry error; only a session that joins or leaves changes the past list.
		this.#broadcasts.pushRoster();
		if (joinedOrLeft) this.#broadcasts.pushPast();
	}
}
