/**
 * The dashboard behind the server: the registries and stores, the live sessions and the views on them, and the loops and
 * inboxes that keep them current. It builds its parts in dependency order, each handed the parts above it.
 * Two edges point down, closing the only cycles: a live session's update reaches the views, the broadcasts, the routines,
 * and the loops through its live-update handler, and a notice change reaches the broadcasts that read the notices.
 * No constructor calls either; nothing follows the registry, watches a directory, or publishes before {@link Dashboard.start}.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { homedir } from "node:os";
import type { Server } from "bun";
import { ForeignUsage } from "../foreign/usage";
import { flushJsonFiles } from "../fs";
import { gitCheckout } from "../git";
import { GmailClient } from "../gmail";
import { GoogleCalendarClient } from "../google-calendar";
import { loadPullRequestDetail, loadPullRequests } from "../pull-requests";
import { loadTickets } from "../tickets";
import { integrationFetch, integrationSignedIn } from "../integrations";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { type HostSnapshot, listHosts } from "../omp/collab";
import { connectedRoles } from "../omp/models";
import { installedOmp, latestOmp, updateOmp } from "../omp/release";
import { sessionsDir } from "../omp/sessions";
import { listPrice, readCreditRuns, stopStats } from "../omp/stats";
import { calendarsFile, directoryOf, displayPath, interruptedFile, localEventsFile, noticesFile, oldGoogleFile, pinsFile, presetsFile, projectNotesDir, projectsFile, routinesFile, scheduledFile, sessionEndInboxDir, serverLockFile, sourceControlFile, userTodoInboxDir, userTodosFile, workspacesFile } from "../paths";
import { replayComparison, replayDetail } from "../replay";
import { canonical, worktreeAt } from "../git";
import { runShell } from "../proc";
import { SourceControl } from "../source-control";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT } from "../routines";
import { SESSION_FORMATS } from "../session-formats";
import { modelUpdates, upgradeModel } from "../settings";
import { agentOn } from "../shared/moves";
import { type SessionPreset, starterPresets } from "../shared/presets";
import type { ServerMsg } from "../shared/protocol";
import type { StartRequest, StartResult, View } from "../shared/sessions";
import { waitingOnYou } from "../slack-messages";
import { Terminals } from "../terminals";
import { DONE_KEPT_HOURS, startChanges } from "../user-todos";
import { Worktrees } from "../worktrees";
import { Broadcasts } from "./broadcasts";
import { CalendarsFile } from "./calendars-file";
import { EndInbox } from "./end-inbox";
import type { Guards } from "./http";
import { InterruptedSessions } from "./interrupted";
import { ListRegistry } from "./list-registry";
import { LocalEventsFile } from "./local-events-file";
import { LiveSessions, type SessionUpdate } from "./live-sessions";
import { Loops } from "./loops";
import { ACTIVITY_KINDS, EVENT_KINDS, Notices, PROJECT_KINDS, PROVIDER_KINDS, UPDATE_KINDS } from "./notices";
import { OwnerLock } from "./owner-lock";
import { PinsFile } from "./pins-file";
import { PresetsFile } from "./presets-file";
import { seedNotes } from "./project-notes";
import { ProjectRunner, projectsExtensionArgs, type RunnerSession } from "./project-runner";
import { ProjectWatch } from "./project-watch";
import { ProjectsFile } from "./projects-file";
import { RoutineRunner } from "./routine-runner";
import { RoutinesFile } from "./routines-file";
import { ScheduledFile } from "./scheduled-file";
import { ScheduledRunner } from "./scheduled-runner";
import { createRoutes, type Routes } from "./routes";
import { endSession } from "./session-end";
import { SessionFiles } from "./session-files";
import { RequestLedger } from "./request-ledger";
import { createClientHandler } from "./socket";
import { createStarter, type Starter } from "./start";
import { TodoInbox } from "./todo-inbox";
import { UserTodosFile } from "./user-todos-file";
import { type Socket, Views } from "./views";
import { parseClientMsg } from "./wire";
import { adoptOldWorkspaces, WorkspacesFile } from "./workspaces-file";

/** What the dashboard publishes through once the server listens. */
type Publisher = Pick<Server<unknown>, "publish" | "subscriberCount">;

/** Everything the server serves, built once at startup; {@link Dashboard.start} sets it going and {@link Dashboard.stop} stops it. */
export class Dashboard {
	readonly #files = new SessionFiles();
	readonly #foreignUsage = new ForeignUsage(SESSION_FORMATS, listPrice);
	readonly #interrupted = new InterruptedSessions(interruptedFile);
	readonly #todos = new UserTodosFile(userTodosFile);
	readonly #routines = new RoutinesFile(routinesFile);
	readonly #scheduled = new ScheduledFile(scheduledFile);
	readonly #workspaces: WorkspacesFile;
	readonly #projects: ProjectsFile;
	readonly #pins = new PinsFile(pinsFile);
	readonly #presets = new PresetsFile(presetsFile);
	readonly #sourceControl = new SourceControl(sourceControlFile);
	readonly #calendars = new CalendarsFile(calendarsFile);
	readonly #localEvents = new LocalEventsFile(localEventsFile);
	/** The terminal panel's shells, which the server's `/ws/terminal` upgrades open and attach to. */
	readonly terminals = new Terminals();
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	readonly #stopping = new AbortController();
	/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the todo inbox. */
	readonly #ownerLock: OwnerLock;
	readonly #google: GoogleCalendarClient;
	readonly #gmail = new GmailClient(integrationFetch("gmail"));
	readonly #sessions: LiveSessions;
	readonly #views: Views;
	readonly #pathFor: (view: View) => string | null;
	readonly #notices: Notices;
	readonly #broadcasts: Broadcasts;
	readonly #lists: ListRegistry;
	readonly #todoInbox: TodoInbox;
	readonly #worktrees: Worktrees;
	readonly #startSession: (request: StartRequest) => Promise<StartResult>;
	readonly #endInbox: EndInbox;
	readonly #runner: RoutineRunner;
	readonly #scheduledRunner: ScheduledRunner;
	readonly #projectRunner: ProjectRunner;
	readonly #projectWatch: ProjectWatch;
	readonly #loops: Loops;
	readonly #requests: RequestLedger;
	/** The server, from {@link start} on; until then there is no socket to publish to. */
	#publisher: Publisher | null = null;
	/** Why the last registry listing failed, shown with the roster. */
	#rosterError: string | null = null;
	/** Whether the registry was listed since the last poll tick found no listener. */
	#registryFresh = false;
	/** Whether the activity was checked since the last activity tick found no listener. */
	#activityFresh = false;
	#usage: Extract<ServerMsg, { t: "usage" }> | null = null;

	constructor(port: number) {
		// An older version kept the workspace list in `projects.json`, so it moves before the projects load from that name.
		adoptOldWorkspaces(projectsFile, workspacesFile);
		const workspaces = (this.#workspaces = new WorkspacesFile(workspacesFile));
		const projects = (this.#projects = new ProjectsFile(projectsFile));
		const files = this.#files;
		const todos = this.#todos;
		const routines = this.#routines;
		const scheduled = this.#scheduled;
		const pins = this.#pins;
		const presets = this.#presets;
		const interrupted = this.#interrupted;
		const ownerLock = (this.#ownerLock = new OwnerLock(serverLockFile, port));
		// The calendars' secret addresses an older version kept read them; Google Calendar now reads through omp's sign-in.
		rmSync(oldGoogleFile, { force: true });
		const calendars = this.#calendars;
		this.#google = new GoogleCalendarClient(integrationFetch("google-calendar"), () => calendars.value);
		const sessions = (this.#sessions = new LiveSessions((instanceId, update) => this.#onLiveUpdate(instanceId, update)));
		const pathFor = (view: View): string | null =>
			view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
		this.#pathFor = pathFor;
		const views = (this.#views = new Views(
			pathFor,
			(topic, msg) => void this.#publisher?.publish(topic, JSON.stringify(msg)),
			instanceId => sessions.started(instanceId)?.starting ?? null,
		));
		const notices = (this.#notices = new Notices(
			noticesFile,
			{
				latestOmp,
				installedOmp,
				updateOmp,
				modelUpdates,
				upgradeModel,
				pullRequests: async () => ({ list: await loadPullRequests(this.knownCwds(), false), agent: agentOn(sessions.rows(files.factsOf)) }),
				slack: async () => ((await integrationSignedIn("slack")) ? waitingOnYou(integrationFetch("slack"), Date.now()) : []),
				plans: async () => {
					if (this.#usage === null) throw new Error("omp usage has not run yet");
					if (this.#usage.error !== null) throw new Error(this.#usage.error);
					return this.#usage.plans;
				},
				creditRuns: () => readCreditRuns(Date.now()),
				localEvents: () =>
					this.#localEvents.value.flatMap(({ id, title, when }) => (when.allDay ? [] : [{ ref: `local/${id}`, title, start: when.start, end: when.end, calendar: null, color: null, url: null }])),
				googleEvents: async (from, to) => {
					if (!(await integrationSignedIn("google-calendar"))) return [];
					const { events } = await this.#google.events(new Date(from), new Date(to));
					return events.flatMap(({ calendarId, eventId, title, calendar, color, url, when }) =>
						when.allDay ? [] : [{ ref: `google/${calendarId}/${eventId}`, title, start: when.start, end: when.end, calendar, color, url }],
					);
				},
				projects: () => this.#projectRunner.noticeFacts(),
				now: Date.now,
			},
			() => this.#broadcasts.pushList("notices"),
		));
		const lists = (this.#lists = new ListRegistry({
			"user-todos": { msg: () => ({ t: "user-todos", list: todos.value }), apply: change => todos.apply(change) },
			routines: { msg: () => ({ t: "routines", routines: routines.value }), apply: change => routines.apply(change, Date.now()) },
			scheduled: { msg: () => ({ t: "scheduled", sends: scheduled.value }), apply: change => scheduled.apply(change, Date.now()) },
			workspaces: {
				msg: () => {
					const [added, hidden] = [workspaces.value.added, workspaces.value.hidden].map(cwds => cwds.map(cwd => ({ cwd, cwdDisplay: displayPath(cwd) })));
					return { t: "workspaces", list: { added, hidden } };
				},
				apply: change => workspaces.apply(change),
			},
			pins: { msg: () => ({ t: "pins", sessionIds: pins.value }), apply: change => pins.apply(change) },
			presets: { msg: () => ({ t: "presets", presets: presets.value }), apply: change => presets.apply(change) },
			projects: {
				msg: () => ({ t: "projects", projects: projects.value }),
				apply: change => {
					const changed = projects.apply(change);
					if (changed) this.#projectRunner.settle(change.id);
					return changed;
				},
			},
			notices: { msg: () => ({ t: "notices", list: notices.list }) },
		}, kind => this.#broadcasts.pushList(kind)));
		const broadcasts = (this.#broadcasts = new Broadcasts({
			roster: () => ({ hosts: sessions.rows(files.factsOf), error: this.#rosterError }),
			past: () => files.past(sessions.sessionIds(), id => interrupted.has(id)),
			lists,
			publish: (topic, json) => void this.#publisher?.publish(topic, json),
			subscriberCount: topic => this.#publisher?.subscriberCount(topic) ?? 0,
			beforeRosterPush: () => views.sync(),
			saveRunning: () => interrupted.setRunning(sessions.startedHere()),
		}));
		this.#todoInbox = new TodoInbox(userTodoInboxDir, change => lists.apply("user-todos", change), { active: () => ownerLock.held });
		const starter = createStarter({
			sessions,
			pathFor,
			savedFile: files.pathOf,
			mayDiscardReplay: async cwd => {
				const at = await worktreeAt(cwd);
				if (!at?.linked) return "This is not a registered linked worktree.";
				const plan = await this.#worktrees.preview({ repository: await canonical(at.common), path: await canonical(at.top) });
				return plan.blockers.length ? plan.blockers.map(blocker => blocker.message).join(" ") : plan.kind === "unreadable" ? "The checkout could not be inspected." : null;
			},
			onStarted: () => broadcasts.syncRoster(),
			linkTodo: (todoId, sessionId) => {
				for (const change of startChanges(todos.value, todoId, sessionId, new Date().toISOString())) lists.apply("user-todos", change);
			},
			projects: { launchFor: (request, project) => this.#projectRunner.launchFor(request, project) },
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
		const startWith: Starter = (request, project) => worktrees.start(() => starter(request, project), request.kind === "replay" || request.kind === "new" && request.branch !== null);
		const startSession = (this.#startSession = request => startWith(request, null));
		/** The live session that continues `sessionId`, else that session resumed; rejects when it does not resume. */
		const reach = async (sessionId: string): Promise<LiveSession> => {
			const live = sessions.bySessionId(sessionId);
			if (live) return live;
			const result = await startSession({ kind: "resume", sessionId });
			if (!result.ok) throw new Error(`Cannot resume the session: ${result.error}`);
			const resumed = sessions.get(result.instanceId);
			if (!resumed) throw new Error("The session exited as it resumed.");
			return resumed;
		};
		this.#endInbox = new EndInbox(sessionEndInboxDir, {
			end: async sessionId => {
				const session = sessions.bySessionId(sessionId);
				// Every server follows a terminal session, so only the owner acts on its request; a session started here is this server's alone.
				if (!session || (!sessions.started(session.instanceId) && !ownerLock.held)) return false;
				await this.#endLive(session);
				return true;
			},
		});
		/** The saved preset `id`, read fresh, or `null` when there is none. */
		const preset = (id: string): SessionPreset | null => {
			presets.reload();
			return presets.value.find(candidate => candidate.id === id) ?? null;
		};
		/** The branch checked out in `cwd`, or `null` outside git or on a detached head. */
		const checkedOut = async (cwd: string): Promise<string | null> => {
			const dir = await directoryOf(cwd);
			return dir ? gitCheckout(dir).then(checkout => checkout?.branch ?? null, () => null) : null;
		};
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
			onChange: () => broadcasts.pushList("routines"),
			changePins: change => void lists.apply("pins", change),
			preset,
			checkedOut,
			notifyProject: (projectId, event) => this.#projectRunner.notify(projectId, event),
		}));
		const scheduledRunner = (this.#scheduledRunner = new ScheduledRunner({
			file: scheduled,
			start: startSession,
			reach,
			now: Date.now,
			onChange: () => broadcasts.pushList("scheduled"),
		}));
		const runnerSession = (session: LiveSession): RunnerSession => {
			const { status, requests } = session.row();
			return { sessionId: session.sessionId, status, requests, prompt: text => session.prompt(null, text, [], "followUp"), answer: (requestId, answer) => session.answer(requestId, answer) };
		};
		const liveRunner = (session: LiveSession | undefined): RunnerSession | null => (session ? runnerSession(session) : null);
		const projectRunner = (this.#projectRunner = new ProjectRunner({
			file: projects,
			start: startWith,
			session: instanceId => liveRunner(sessions.get(instanceId)),
			bySessionId: sessionId => liveRunner(sessions.bySessionId(sessionId)),
			reach: async sessionId => runnerSession(await reach(sessionId)),
			end: async sessionId => {
				const session = sessions.bySessionId(sessionId);
				if (session) await this.#endLive(session);
			},
			interrupted: sessionId => interrupted.has(sessionId),
			stoppedWithServer: sessionId => interrupted.stoppedWithServer(sessionId),
			preset,
			checkedOut,
			extensionArgs: projectsExtensionArgs,
			seedNotes: (id, name, goal) => seedNotes(projectNotesDir(id), name, goal),
			now: Date.now,
			newId: randomUUID,
			onChange: () => broadcasts.pushList("projects"),
		}));
		this.#projectWatch = new ProjectWatch({
			projects: () => projects.value,
			pullRequestsOf: sessionId => files.factsOf(sessionId).pullRequests,
			detail: pr => loadPullRequestDetail(pr, true),
			tickets: async () => (await loadTickets(true)).tickets,
			notify: (projectId, event) => projectRunner.notify(projectId, event),
		});
		this.#loops = new Loops(SESSION_FORMATS, {
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
			onUsageTick: async () => {
				this.#usage = await broadcasts.refreshUsage();
				await notices.check(PROVIDER_KINDS);
			},
			onMinuteTick: async () => {
				// Every server shows the sends, and the one that owns the unattended work sends them and saves what it did.
				scheduled.reload();
				broadcasts.pushList("scheduled");
				presets.reload();
				broadcasts.pushList("presets");
				await notices.check([...EVENT_KINDS, ...PROJECT_KINDS]);
				if (!this.#claimUnattendedWork()) return;
				this.#clearOldDone();
				await scheduledRunner.tick();
				await runner.tick();
				await this.#projectWatch.tick();
			},
			onNoticeTick: () => notices.check(UPDATE_KINDS),
			onActivityTick: async () => {
				if (broadcasts.listening()) await this.#checkActivity();
				else this.#activityFresh = false;
			},
			onPullTick: async () => {
				if (ownerLock.held) await this.#sourceControl.pull(this.#workspaceCwds());
			},
		});
		this.#requests = new RequestLedger(createClientHandler({
			sessions,
			views,
			start: startSession,
			createProject: spec => projectRunner.create(spec),
			lists,
			end: async instanceId => {
				const session = sessions.get(instanceId);
				if (session) await this.#endLive(session);
			},
			dismissInterrupted(sessionId) {
				if (interrupted.dismiss(sessionId)) broadcasts.pushPast();
			},
			stoppedMidTurn: sessionId => interrupted.stoppedMidTurn(sessionId),
			sendScheduledNow: id => scheduledRunner.sendNow(id),
			runRoutine: id => runner.runNow(id),
			changeNotices: (ids, op) => notices.apply(ids, op),
			}),
			(t, error) => console.error(`omp-agents: ${t} failed: ${errorText(error)}`),
		);
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
				addedCwds: () => this.#workspaces.value.added,
				changeWorkspaces: change => void this.#lists.apply("workspaces", change),
				savedOf: files.savedOf,
				foreignUsage: () => this.#foreignUsage.read(),
				placeOf(sessionId) {
					const file = files.pathOf(sessionId);
					const saved = files.savedOf(sessionId);
					if (!file || !saved) return null;
					return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd };
				},
				learnHeads(repo, pullRequests) {
					if (files.facts.learnHeads(repo, pullRequests)) broadcasts.pushAll();
				},
				projectNotesDir: id => (this.#projects.get(id) ? projectNotesDir(id) : null),
				replayDetail: async (view, turnId) => {
					const file = this.#pathFor(view);
					if (!file) throw new Error("The source session file is unavailable.");
					return replayDetail(file, turnId);
				},
				replayComparison: async view => {
					const file = this.#pathFor(view);
					if (!file) throw new Error("The replay session file is unavailable.");
					return replayComparison(file);
				},
				searchConversations: query => files.searchConversations(query),
				sourceControl: () => this.#sourceControl.answer(this.#workspaceCwds()),
				changeAutoPull: change => {
					if (this.#sourceControl.apply(change) && this.#ownerLock.held) void this.#sourceControl.pull(this.#workspaceCwds());
				},
			},
			calendar: {
				google: this.#google,
				setCalendarShown: (id, shown) => this.#calendars.apply(id, shown),
				localEvents: this.#localEvents,
			},
			gmail: this.#gmail,
			files: { worktrees: this.#worktrees, terminals: this.terminals },
			todos: { list: () => this.#todos.value, change: change => void this.#lists.apply("user-todos", change) },
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
			this.#scheduledRunner.recover();
			this.#projectRunner.recover();
		} else {
			const owner = this.#ownerLock.holder();
			console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the todo inbox; this one takes over when it exits.`);
		}
		this.#todoInbox.watch();
		this.#endInbox.watch();
		await this.#rescanFiles();
		await this.#listRegistry();
		void this.#seedPresets();
		if (this.#ownerLock.held) this.#clearOldDone();
		this.#loops.start();
	}

	/**
	 * Stops everything that runs on its own first, so no tick publishes while the rest shuts down; then ends the sessions
	 * started here, hangs up on the shells, writes what the stores have not, and stops the routine commands still running.
	 */
	async stop(): Promise<void> {
		this.#loops.stop();
		this.#projectRunner.stop();
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
		this.#requests.open(ws);
		this.#broadcasts.open(ws);
		// The registry was not polled while nobody listened; list it now rather than at the next tick.
		if (!this.#registryFresh) void this.#listRegistry();
		if (!this.#activityFresh) void this.#checkActivity();
	}

	/** A message on a dashboard socket; one that is not a client message is dropped. */
	message(ws: Socket, raw: string | Buffer): void {
		const frame = parseClientMsg(raw)?.ok;
		if (frame) void this.#requests.handle(ws, frame);
	}

	/** A dashboard socket closed: it watches no view any more, and its page's requests wait for its next socket. */
	close(ws: Socket): void {
		this.#views.watch(ws, [], []);
		this.#requests.close(ws);
	}

	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[] {
		return [...new Set([...this.#sessions.cwds(), ...this.#files.cwds()].filter(Boolean))];
	}

	#workspaceCwds(): string[] {
		const { added, hidden } = this.#workspaces.value;
		return [...new Set([...this.knownCwds(), ...added])].filter(cwd => !hidden.includes(cwd));
	}

	/** Where every live session's update goes: the views, the broadcasts, the routines, the projects, and the loops. */
	#onLiveUpdate(instanceId: string, update: SessionUpdate): void {
		switch (update.kind) {
			case "roster":
				this.#runner.observe(instanceId);
				this.#projectRunner.observe(instanceId);
				this.#broadcasts.rosterChanged();
				return;
			case "event":
				this.#views.applyEvent(instanceId, update.event);
				return;
			case "starting":
				this.#views.starting(instanceId);
				return;
			case "note":
				this.#views.note(instanceId, update.agentId, update.level, update.text);
				return;
			case "exited": {
				// Only a session this dashboard started reports its exit.
				const sessionId = this.#sessions.get(instanceId)?.sessionId;
				if (sessionId && !update.ended) this.#interrupted.interrupt(sessionId);
				this.#projectRunner.exited(instanceId);
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
				this.#projectRunner.switched(instanceId);
				return;
			case "turn-ended":
				this.#projectRunner.turnEnded(instanceId, update.reply);
				return;
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	}

	/** Moves todos checked over {@link DONE_KEPT_HOURS} ago to the archive. */
	#clearOldDone(): void {
		this.#lists.apply("user-todos", { op: "clear-done", categoryId: null, before: new Date(Date.now() - DONE_KEPT_HOURS * 3_600_000).toISOString() });
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
			this.#projects.reload();
			this.#broadcasts.pushList("routines");
			this.#broadcasts.pushList("user-todos");
			this.#broadcasts.pushList("projects");
			this.#runner.recover();
			this.#scheduledRunner.recover();
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

	async #seedPresets(): Promise<void> {
		const roles = await connectedRoles(homedir()).catch(() => []);
		if (this.#presets.seed(starterPresets(roles))) this.#broadcasts.pushList("presets");
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
