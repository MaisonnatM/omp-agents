/**
 * The dashboard behind the server: the registries and stores, the live sessions and the views on them, and the loops and
 * inboxes that keep them current. It builds its parts in dependency order, each handed the parts above it.
 * Two edges point down, closing the only cycles: a live session's update reaches the views, the broadcasts, the Bots,
 * and the loops through its live-update handler, and a notice change reaches the broadcasts that read the notices.
 * No constructor calls either; nothing follows the registry, watches a directory, or publishes before {@link Dashboard.start}.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import type { Server } from "bun";
import { ForeignUsage } from "../foreign/usage";
import { flushJsonFiles } from "../fs";
import { fullyAwake } from "../full-wake";
import { GmailAccounts, GmailClient } from "../gmail";
import { accountClients, createGoogleAccounts } from "../google-accounts";
import { GoogleCalendarClient, GoogleCalendars } from "../google-calendar";
import { loadPullRequests, mergedPullRequests, repoOf } from "../pull-requests";
import { createIntegrations, type Integrations, integrationFetch, integrationSignedIn } from "../integrations";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { startDictation } from "../omp/dictation";
import { agentDir } from "../omp/config";
import { type HostSnapshot, listHosts } from "../omp/collab";
import { findMcpServers } from "../omp/mcp";
import { ompDaemons, startOwnedService } from "../omp/daemons";
import { ompSandboxes } from "../omp/isolation";
import { installedOmp, latestOmp, updateOmp } from "../omp/release";
import { keptSessions } from "../omp/rpc";
import { renameSessionFile } from "../omp/sessions";
import { listPrice, readCreditRuns, stopStats } from "../omp/stats";
import { activityDb, botInboxDir, botsDir, botsFile, calendarsFile, directoryOf, displayPath, eventInboxDir, googleAccountsFile, HOME, interruptedFile, localEventsFile, mergesFile, noticesFile, oldGoogleFile, oldWorkspacesFile, personalDir, pinsFile, preferencesFile, privateSessionsDir, processesFile, projectTrustFile, reviewDraftsFile, routineInboxDir, routinesFile, scheduledFile, shepherdInboxDir, sessionEndInboxDir, serverLockFile, settingsSyncFile, settingsSyncRepo, signInInboxDir, sourceControlFile, sportFile, sportInboxDir, sportThumbsDir, userNoteInboxDir, userNotesFile, userTodoInboxDir, userTodosFile, workspaceFor, workspacesFile } from "../paths";
import { listReviewComments, listReviews, postReview, readReviewTarget, viewerLogin } from "../pull-request-review";
import { GITHUB_MERGES, readPullRequestStates } from "../pull-request-merge";
import { checkOutPullRequest } from "../pull-request-checkout";
import { rebasePullRequest } from "../pull-request-rebase";
import { worktreeAt } from "../git";
import { runShell } from "../proc";
import type { ServedBuild } from "../served-build";
import { SourceControl } from "../source-control";
import { SettingsSync, syncStores } from "../settings-sync";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT, watchedKinds } from "../routines";
import { SESSION_FORMATS } from "../session-formats";
import { modelUpdates, upgradeModel } from "../settings";
import { MCP_SERVICES } from "../shared/accounts";
import { agentOn } from "../shared/moves";
import type { StartRequest, StartResult, View } from "../shared/sessions";
import { waitingOnYou } from "../slack-messages";
import { Terminals } from "../terminals";
import { DONE_KEPT_HOURS, startChanges } from "../user-todos";
import { Worktrees } from "../worktrees";
import { WorktreeOccupants } from "./worktree-occupants";
import { BotInbox } from "./bot-inbox";
import { Bots, startingRoutine } from "./bots";
import { BotsFile } from "./bots-file";
import { Broadcasts } from "./broadcasts";
import { CalendarsFile } from "./calendars-file";
import { EndInbox } from "./end-inbox";
import type { Guards } from "./http";
import { InterruptedSessions } from "./interrupted";
import { IsolationSweep } from "./isolation-sweep";
import { ListRegistry } from "./list-registry";
import { GoogleAccountsFile } from "./google-accounts-file";
import { LocalEventsFile } from "./local-events-file";
import { LiveSessions, type SessionUpdate } from "./live-sessions";
import { Loops, repeat } from "./loops";
import { MergeCleanup } from "./merge-cleanup";
import { MergeQueue } from "./merge-queue";
import { ACTIVITY_KINDS, DASHBOARD_KINDS, EVENT_KINDS, Notices, PROVIDER_KINDS, SIGN_IN_KINDS, STOPPED_KINDS, UPDATE_KINDS } from "./notices";
import { OwnerLock } from "../../templates/omp/agent/extensions/github/owner-lock";
import { isPersonalDir, personalJoin, personalMessage } from "./personal";
import { PinsFile } from "./pins-file";
import { SignInInbox } from "./sign-in-inbox";
import { PrivateSessions } from "./private-sessions";
import { PreferencesFile } from "./preferences-file";
import { ProcessSettingsFile } from "./process-settings-file";
import { startDevServer } from "./dev-server";
import { readProcessTable } from "../process-census";
import { readAppOf, readCwds, readListeningPorts, SessionProcessWatch, stopProcesses } from "./session-processes";
import { ReviewDrafts } from "./review-drafts";
import { ReviewDraftsFile } from "./review-drafts-file";
import { RoutineRunner } from "./routine-runner";
import { eventSightings, gmailSightings, pullRequestSightings, SLACK_SCOPE, slackSightings, TriggerWatch } from "./routine-triggers";
import { RoutineInbox } from "./routine-inbox";
import { ShepherdInbox } from "./shepherd-inbox";
import { unapprovedChange } from "../pull-request-approval";
import { configAt } from "../../templates/omp/agent/extensions/land/gate";
import { RoutinesFile } from "./routines-file";
import { ScheduledFile } from "./scheduled-file";
import { AutoContinue, occupiedBy } from "./auto-continue";
import { ScheduledRunner } from "./scheduled-runner";
import type { Routes } from "./route-kit";
import { createRoutes } from "./routes";
import type { SelfUpdate } from "./self-update";
import { endSession } from "./session-end";
import { ProjectTrustFile } from "./project-trust-file";
import { SessionMoves } from "./session-moves";
import { SessionFiles } from "./session-files";
import { RequestLedger } from "./request-ledger";
import { ACTIVITY_KEPT_DAYS, ActivityStore } from "./activity-store";
import { DAY_MS } from "../shared/days";
import { Dictation } from "./dictation";
import { createClientHandler } from "./socket";
import { botExtension, designerExtension, shepherdExtension } from "./resources";
import { createStarter, reattachAll, type SessionJoin } from "./start";
import { EventInbox } from "./event-inbox";
import { NoteInbox } from "./note-inbox";
import { TodoInbox } from "./todo-inbox";
import { SportFile } from "./sport-file";
import type { JsonInboxDir } from "./json-inbox";
import { SportInbox } from "./sport-inbox";
import { UserNotesFile } from "./user-notes-file";
import { UserTodosFile } from "./user-todos-file";
import { UsagePoll } from "./usage-poll";
import { type Socket, Views } from "./views";
import { parseClientMsg } from "./wire";
import { adoptOldWorkspaces, WorkspacesFile } from "./workspaces-file";

/** What the dashboard publishes through once the server listens. */
type Publisher = Pick<Server<unknown>, "publish" | "subscriberCount">;

/** The hidden calendars of an account that hid none. */
const NO_HIDDEN: ReadonlySet<string> = new Set();
/** How often the merge queue looks at the pull requests it waits on: checks take minutes, and a click shows its first step at once. */
const MERGE_QUEUE_TICK_MS = 15_000;

/** Everything the server serves, built once at startup; {@link Dashboard.start} sets it going and {@link Dashboard.stop} stops it. */
export class Dashboard {
	readonly #files = new SessionFiles();
	readonly #foreignUsage = new ForeignUsage(SESSION_FORMATS, listPrice);
	readonly #interrupted = new InterruptedSessions(interruptedFile, () => void this.#notices.check(STOPPED_KINDS));
	readonly #todos = new UserTodosFile(userTodosFile);
	readonly #notes = new UserNotesFile(userNotesFile);
	readonly #sport = new SportFile(sportFile);
	readonly #routines = new RoutinesFile(routinesFile);
	readonly #scheduled = new ScheduledFile(scheduledFile);
	readonly #workspaces: WorkspacesFile;
	readonly #pins = new PinsFile(pinsFile);
	readonly #privateSessions = new PrivateSessions({ root: privateSessionsDir, unpin: sessionIds => void this.#lists.apply("pins", { op: "unpin", sessionIds }) });
	readonly #processSettings = new ProcessSettingsFile(processesFile);
	readonly #preferences = new PreferencesFile(preferencesFile);
	readonly #reviewDrafts = new ReviewDrafts({
		file: new ReviewDraftsFile(reviewDraftsFile),
		github: { target: readReviewTarget, reviews: listReviews, reviewComments: listReviewComments, viewer: viewerLogin, post: postReview },
		now: Date.now,
		onChange: () => this.#broadcasts.pushList("review-drafts"),
	});
	readonly #botsFile = new BotsFile(botsFile);
	readonly #bots: Bots;
	readonly #projectTrust = new ProjectTrustFile(projectTrustFile);
	readonly #admit = (dir: string): Promise<void> => this.#projectTrust.admit(dir);
	readonly #moves = new SessionMoves({
		session: instanceId => this.#sessions.started(instanceId),
		staysPut: request => this.#bots.botOf(request) !== null || isPersonalDir(this.#cwdOf(request)),
		admit: this.#admit,
	});
	readonly #personalJoin = personalJoin(request => this.#bots.botOf(request) !== null);
	readonly #sourceControl = new SourceControl(sourceControlFile);
	readonly #settingsSync: SettingsSync;
	readonly #calendars = new CalendarsFile(calendarsFile);
	readonly #googleAccounts = createGoogleAccounts(new GoogleAccountsFile(googleAccountsFile));
	readonly #integrations: Integrations = createIntegrations(this.#googleAccounts);
	readonly #localEvents = new LocalEventsFile(localEventsFile);
	/** The terminal panel's shells, which the server's `/ws/terminal` upgrades open and attach to. */
	readonly terminals = new Terminals();
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	readonly #stopping = new AbortController();
	/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the todo, note, and event inboxes. */
	readonly #ownerLock: OwnerLock;
	readonly #google: GoogleCalendars;
	readonly #gmail = new GmailAccounts(accountClients("gmail", (fetch, account) => new GmailClient(fetch, account)));
	readonly #sessions: LiveSessions;
	readonly #views: Views;
	readonly #notices: Notices;
	readonly #broadcasts: Broadcasts;
	readonly #lists: ListRegistry;
	/** The inboxes the owner applies, each a tool's changes to one of the dashboard's files. */
	readonly #inboxes: readonly JsonInboxDir<unknown>[];
	readonly #worktrees: Worktrees;
	/** omp's isolation sandboxes whose omp exited, removed once a day by the owner. */
	readonly #isolationSweep: IsolationSweep;
	/** What each live session runs besides omp, which it stops on request, when idle, and once the session left. */
	readonly #processWatch: SessionProcessWatch;
	readonly #startSession: (request: StartRequest) => Promise<StartResult>;
	readonly #reattached = Promise.withResolvers<void>();
	readonly #endInbox: EndInbox;
	readonly #runner: RoutineRunner;
	/** What the bell's checks saw last, which tells the routines' triggers what is new. */
	readonly #triggerWatch = new TriggerWatch();
	readonly #scheduledRunner: ScheduledRunner;
	readonly #autoContinue: AutoContinue;
	readonly #mergeQueue: MergeQueue;
	readonly #mergeCleanup: MergeCleanup;
	/** Stops the merge queue's loop, which {@link start} starts. */
	#stopMergeQueue = (): void => {};
	readonly #loops: Loops;
	readonly #requests: RequestLedger;
	readonly #dictation = new Dictation(startDictation);
	readonly #activity = new ActivityStore(activityDb);
	readonly #selfUpdate: SelfUpdate;
	/** The server, from {@link start} on; until then there is no socket to publish to. */
	#publisher: Publisher | null = null;
	/** Why the last registry listing failed, shown with the roster. */
	#rosterError: string | null = null;
	/**
	 * The registry listing: `unlisted` until {@link start} lists it, so a page that connects earlier neither lists nor
	 * follows the registry before reattachAll and the restore of the unread turns finish, nor before the session files are
	 * indexed, which the first listing reads; then `stale` once a poll tick found no listener, and `fresh` once listed again.
	 */
	#registry: "unlisted" | "fresh" | "stale" = "unlisted";
	/** Whether the activity was checked since the last activity tick found no listener. */
	#activityFresh = false;
	readonly #usage: UsagePoll;

	/** `selfUpdate` is **Update dashboard**, which pulls the checkout the server runs from and restarts the server. */
	constructor(port: number, selfUpdate: SelfUpdate) {
		this.#selfUpdate = selfUpdate;
		// An older version kept the workspace list in `projects.json`, so it moves first.
		adoptOldWorkspaces(oldWorkspacesFile, workspacesFile);
		const workspaces = (this.#workspaces = new WorkspacesFile(workspacesFile));
		// A sync, which runs only once the server listens, tells the pages that show a list it rewrote.
		const stores = syncStores(
			{ sourceControl: this.#sourceControl, notes: this.#notes, todos: this.#todos, preferences: this.#preferences, processes: this.#processSettings, workspaces, calendars: this.#calendars },
			HOME,
			list => this.#broadcasts.pushList(list),
		);
		this.#settingsSync = new SettingsSync(settingsSyncFile, settingsSyncRepo, { omp: agentDir, home: HOME, stores });
		const files = this.#files;
		const todos = this.#todos;
		const notes = this.#notes;
		const sport = this.#sport;
		const routines = this.#routines;
		const scheduled = this.#scheduled;
		const pins = this.#pins;
		const interrupted = this.#interrupted;
		const ownerLock = (this.#ownerLock = new OwnerLock(serverLockFile, port));
		// The calendars' secret addresses an older version kept read them; Google Calendar now reads through omp's sign-in.
		rmSync(oldGoogleFile, { force: true });
		const calendars = this.#calendars;
		this.#google = new GoogleCalendars(accountClients("google-calendar", (fetch, account) => new GoogleCalendarClient(fetch, account, () => calendars.value.get(account) ?? NO_HIDDEN)));
		const sessions = (this.#sessions = new LiveSessions((instanceId, update) => this.#onLiveUpdate(instanceId, update)));
		const { placement } = files.facts;
		const { factsOf } = files;
		const pathFor = (view: View): string | null =>
			view.kind === "past" ? files.pathOf(view.sessionId) : (sessions.get(view.instanceId)?.transcriptPath(view.agentId, files.pathOf) ?? null);
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
				dashboardCommits: () => selfUpdate.newCommits(),
				updateDashboard: () => selfUpdate.update(),
				pullRequests: async () => {
					const list = await loadPullRequests(this.knownWorkspaces(), false);
					const agent = agentOn(sessions.rows(factsOf));
					this.#triggerWatch.learn(pullRequestSightings(list, agent));
					return { list, agent };
				},
				slack: async () => {
					// Signed out, Slack answers nothing, so its next answer, once signed in, is a baseline rather than news.
					if (!(await integrationSignedIn("slack"))) {
						this.#triggerWatch.forgetScope(SLACK_SCOPE);
						return [];
					}
					const found = await waitingOnYou(integrationFetch("slack"), Date.now());
					this.#triggerWatch.learn(slackSightings(found));
					return found;
				},
				plans: async () => {
					const usage = this.#usage.report;
					if (usage === null) throw new Error("omp usage has not run yet");
					if (usage.error !== null) throw new Error(usage.error);
					return usage.plans;
				},
				creditRuns: () => readCreditRuns(Date.now()),
				localEvents: () => {
					const events = this.#localEvents.value.flatMap(({ id, title, when, sessionId }) =>
						when.allDay ? [] : [{ ref: `local/${id}`, title, start: when.start, end: when.end, calendar: null, color: null, url: null, sessionId }],
					);
					this.#triggerWatch.learn(eventSightings([{ scope: "event:local", events }], Date.now()));
					return events;
				},
				googleEvents: async (from, to) => {
					const accounts = (await this.#google.byAccount(new Date(from), new Date(to))).map(read => ({
						account: read.account,
						events:
							"error" in read
								? null
								: read.events.flatMap(({ account, calendarId, eventId, title, calendar, color, url, when }) =>
										when.allDay ? [] : [{ ref: `google/${account}/${calendarId}/${eventId}`, title, start: when.start, end: when.end, calendar, color, url, sessionId: null }],
									),
					}));
					this.#triggerWatch.learn(eventSightings(accounts.flatMap(({ account, events }) => (events ? [{ scope: `event:google/${account}`, events }] : [])), Date.now()));
					return accounts;
				},
				stoppedSessions: () =>
					interrupted.midTurn().map(sessionId => {
						const saved = files.savedOf(sessionId);
						return { sessionId, title: saved?.title ?? null, cwdDisplay: saved ? displayPath(saved.cwd) : null };
					}),
				signedOut: () => this.#googleAccounts.signedOut(),
				now: Date.now,
			},
			() => this.#broadcasts.pushList("notices"),
		));
		const lists = (this.#lists = new ListRegistry({
			"user-todos": { msg: () => ({ t: "user-todos", list: todos.value }), apply: change => todos.apply(change) },
			"user-notes": { msg: () => ({ t: "user-notes", list: notes.value }), apply: change => notes.apply(change) },
			sport: { msg: () => ({ t: "sport", state: sport.value }), apply: change => sport.apply(change) },
			// Every routine belongs to a Bot, so a save for a Bot that is gone saves nothing.
			routines: {
				msg: () => ({ t: "routines", routines: routines.value }),
				apply: change => (change.op === "save" && !this.#botsFile.value.some(({ id }) => id === change.routine.botId) ? false : routines.apply(change, Date.now())),
			},
			scheduled: { msg: () => ({ t: "scheduled", sends: scheduled.value }), apply: change => scheduled.apply(change, Date.now()) },
			workspaces: {
				msg: () => {
					const [added, hidden] = [workspaces.value.added, workspaces.value.hidden].map(cwds => cwds.map(workspaceFor));
					return { t: "workspaces", list: { added, hidden } };
				},
				apply: change => workspaces.apply(change),
			},
			"project-trust": { msg: () => ({ t: "project-trust", projects: this.#projectTrust.projects() }), apply: change => this.#projectTrust.apply(change) },
			pins: { msg: () => ({ t: "pins", sessionIds: pins.value }), apply: change => pins.apply(change) },
			preferences: { msg: () => ({ t: "preferences", values: this.#preferences.value }), apply: change => this.#preferences.apply(change) },
			notices: { msg: () => ({ t: "notices", list: notices.list }) },
			merges: { msg: () => ({ t: "merges", list: [...this.#mergeQueue.list] }) },
			personal: { msg: personalMessage },
			"review-drafts": { msg: () => ({ t: "review-drafts", list: this.#reviewDrafts.list }), apply: edit => this.#reviewDrafts.edit(edit) },
			bots: {
				msg: () => this.#bots.msg(),
				apply: change => {
					// Deleting a Bot deletes its routines, first, so a crash between the saves leaves none without its Bot.
					if (change.op === "remove" && routines.removeBot(change.id)) this.#broadcasts.pushList("routines");
					const created = change.op === "save" && !this.#botsFile.value.some(({ id }) => id === change.bot.id);
					if (!this.#botsFile.apply(change, new Date().toISOString())) return false;
					// A new PR shepherd starts with the routine that wakes it as what it watches changes, after the Bot it belongs to is saved.
					const routine = created ? startingRoutine[change.bot.kind]?.(change.bot.id) : null;
					if (routine && routines.apply({ op: "save", routine }, Date.now())) this.#broadcasts.pushList("routines");
					return true;
				},
			},
		}, kind => this.#broadcasts.pushList(kind)));
		const broadcasts = (this.#broadcasts = new Broadcasts({
			roster: () => ({ hosts: sessions.rows(factsOf), error: this.#rosterError }),
			past: () => files.past(sessions.sessionIds(), id => interrupted.has(id)),
			lists,
			publish: (topic, json) => void this.#publisher?.publish(topic, json),
			subscriberCount: topic => this.#publisher?.subscriberCount(topic) ?? 0,
			onRosterPush: () => {
				views.sync();
				void placement.place(sessions.cwds(), worktreeAt).then(placed => {
					if (placed) broadcasts.pushAll();
				});
			},
			saveRunning: () => interrupted.setRunning(sessions.startedHere()),
		}));
		this.#usage = new UsagePoll({ refresh: () => broadcasts.refreshUsage(), checkNotices: () => notices.check(PROVIDER_KINDS) });
		/** The workspace directory `cwd` counts in, asking git when it was not asked about yet. */
		const workspaceOf = async (cwd: string): Promise<string> => {
			await placement.place([cwd], worktreeAt);
			return placement.cwdOf(cwd);
		};
		const todoInbox = new TodoInbox(userTodoInboxDir, change => lists.apply("user-todos", change), workspaceOf, { active: () => ownerLock.held });
		const noteInbox = new NoteInbox(userNoteInboxDir, change => lists.apply("user-notes", change), { active: () => ownerLock.held });
		const sportInbox = new SportInbox(
			sportInboxDir,
			() => sport.value,
			changes => {
				for (const change of changes) lists.apply("sport", change);
				return sport.flush();
			},
			{ active: () => ownerLock.held },
		);
		const eventInbox = new EventInbox(eventInboxDir, () => this.#localEvents.value, change => this.#localEvents.apply(change), { active: () => ownerLock.held });
		const signInInbox = new SignInInbox(
			signInInboxDir,
			{
				report: async ({ account, at }) => {
					if (await this.#googleAccounts.reportSignedOut(account, at)) await notices.check(SIGN_IN_KINDS);
				},
			},
			{ active: () => ownerLock.held },
		);
		const routineInbox = new RoutineInbox(routineInboxDir, () => routines.value, change => lists.apply("routines", change), { active: () => ownerLock.held });
		const botInbox = new BotInbox(
			botInboxDir,
			{ bots: () => this.#botsFile.value, save: change => lists.apply("bots", change), tell: (to, text) => this.#bots.message(to, text), now: Date.now },
			{ active: () => ownerLock.held },
		);
		const starter = createStarter({
			sessions,
			pathFor,
			savedFile: files.pathOf,
			factsFor: factsOf,
			onStarted: () => broadcasts.syncRoster(),
			workspaceOf,
			linkTodo: (todoId, sessionId) => {
				for (const change of startChanges(todos.value, todoId, sessionId, new Date().toISOString())) lists.apply("user-todos", change);
			},
			joinFor: request => this.#joinFor(request),
			admit: this.#admit,
			privateSessions: this.#privateSessions,
		});
		const occupants = new WorktreeOccupants();
		const worktrees = (this.#worktrees = new Worktrees({
			knownCwds: () => this.knownWorkspaces(),
			activity: () => files.activity(),
			serverCwd: process.cwd(),
			mergedPullRequests,
			live: () => occupants.snapshot(sessions.rows(factsOf), (host, agentId) => sessions.get(host.instanceId)?.transcriptPath(agentId, files.pathOf) ?? null),
		}));
		this.#isolationSweep = new IsolationSweep({ ...ompSandboxes(), inUse: () => worktrees.inUse(), now: Date.now });
		this.#processWatch = new SessionProcessWatch({
			...ompDaemons(),
			readTable: readProcessTable,
			readPorts: readListeningPorts,
			readCwds,
			appOf: readAppOf,
			stopProcesses,
			sessions: () => sessions.rows(factsOf),
			now: Date.now,
			owner: () => ownerLock.held,
			stopIdleAfterMinutes: () => {
				this.#processSettings.reload();
				return this.#processSettings.value.stopIdleAfterMinutes;
			},
		});
		const startSession = (this.#startSession = request => worktrees.start(() => starter(request), request.kind === "new" && request.branch !== null));
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
		this.#bots = new Bots({
			file: this.#botsFile,
			start: startSession,
			live: sessionId => sessions.bySessionId(sessionId),
			session: instanceId => sessions.get(instanceId),
			savedFile: files.pathOf,
			paths: { extension: botExtension, botsFile, botInboxDir, botsDir, routinesFile, routineInboxDir, shepherdExtension, shepherdInboxDir, designerExtension },
			now: () => new Date().toISOString(),
			onChange: () => broadcasts.pushList("bots"),
		});
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
			now: Date.now,
			workspace: botId => this.#botsFile.value.find(({ id }) => id === botId)?.cwd ?? null,
			async exec(command, cwd, env) {
				const dir = await directoryOf(cwd);
				if (!dir) throw new Error(`${cwd.trim()} is not a directory.`);
				return runShell(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS, maxOutput: MAX_COMMAND_OUTPUT, signal: stopping, env });
			},
			fullyAwake,
			onChange: () => broadcasts.pushList("routines"),
			messageBot: (botId, text) => this.#bots.message(botId, text),
		}));
		const scheduledRunner = (this.#scheduledRunner = new ScheduledRunner({
			file: scheduled,
			start: startSession,
			reach,
			now: Date.now,
			onChange: () => broadcasts.pushList("scheduled"),
		}));
		const autoContinue = (this.#autoContinue = new AutoContinue({
			file: scheduled,
			plans: async () => {
				const { plans, error } = await this.#usage.fresh();
				if (error !== null) throw new Error(error);
				return plans;
			},
			now: Date.now,
			onChange: () => broadcasts.pushList("scheduled"),
		}));
		// Only the server that holds the owner lock steps the queue and takes the minute tick's look, so only it ends sessions after a merge, and only the ones it started.
		const mergeCleanup = (this.#mergeCleanup = new MergeCleanup({
			sessions: () =>
				sessions.rows(factsOf).flatMap(host =>
					sessions.started(host.instanceId) !== undefined && this.#sourceControl.cleanUp
						? [{ sessionId: host.sessionId, idle: host.status === "idle", occupied: occupiedBy(host.status, autoContinue.held(host.sessionId)), pullRequests: host.pullRequests, workDir: host.worktree ?? host.cwd, branch: host.branch?.linked ? host.branch.name : null }]
						: [],
				),
			states: readPullRequestStates,
			checkout: async dir => {
				const at = await worktreeAt(dir).catch(() => null);
				return at && { gitDir: at.common, repo: await repoOf(dir) };
			},
			end: async sessionId => {
				const session = sessions.bySessionId(sessionId);
				if (!session) throw new Error("It does not run.");
				await this.#endLive(session);
			},
			deleteBranch: (gitDir, branch, head) => worktrees.deleteMergedBranch(gitDir, branch, head),
		}));
		this.#mergeQueue = new MergeQueue({
			path: mergesFile,
			github: GITHUB_MERGES,
			now: Date.now,
			newId: randomUUID,
			active: () => ownerLock.held,
			onChange: () => broadcasts.pushList("merges"),
			onMerged: pr => void mergeCleanup.merged(pr),
		});
		const shepherdInbox = new ShepherdInbox(
			shepherdInboxDir,
			{
				bots: () => this.#botsFile.value,
				pullRequests: () => loadPullRequests(this.knownWorkspaces(), true),
				agent: () => agentOn(sessions.rows(factsOf)),
				start: startSession,
				queueMerge: change => this.#mergeQueue.apply(change),
				unapprovedChange,
				landTarget: cwd => configAt(cwd)?.target ?? null,
				tell: (botId, text) => this.#bots.message(botId, text),
			},
			{ active: () => ownerLock.held },
		);
		this.#inboxes = [todoInbox, noteInbox, sportInbox, eventInbox, signInInbox, routineInbox, botInbox, shepherdInbox];
		// Private sessions' files poke the views that follow them, but no format lists them, so they never show as past sessions.
		this.#loops = new Loops([...SESSION_FORMATS, { root: privateSessionsDir, createRoot: true }], {
			onRegistryTick: async () => {
				if (broadcasts.listening()) await this.#listRegistry();
				else this.#registry = "stale";
			},
			onFileChange(path) {
				views.poke(path);
				return files.touch(path);
			},
			onListRefresh: async () => {
				if (await files.refresh()) this.#onFilesChanged();
			},
			onRescanTick: () => this.#rescanFiles(),
			onUsageTick: () => this.#usage.tick(broadcasts.listening()),
			onMinuteTick: async () => {
				// Every server shows the sends, and the one that owns the unattended work sends them and saves what it did.
				scheduled.reload();
				broadcasts.pushList("scheduled");
				await notices.check([...EVENT_KINDS, ...STOPPED_KINDS, ...SIGN_IN_KINDS]);
				this.#fireTriggers();
				if (!this.#claimUnattendedWork()) return;
				this.#clearOldDone();
				// It reads every sandbox's checkout, which takes minutes, so the routines and sends after it do not wait for it.
				void this.#isolationSweep.tick();
				await scheduledRunner.tick();
				await runner.tick();
				await this.#mergeCleanup.tick();
				await this.#bots.stopIdle(Date.now());
			},
			onNoticeTick: () => notices.check(UPDATE_KINDS),
			onActivityTick: async () => {
				// The routines' triggers read these checks, so the server that runs them checks without a page too, but only what an enabled routine watches.
				const watched = ownerLock.held ? watchedKinds(routines.value) : [];
				const kinds = broadcasts.listening() ? ACTIVITY_KINDS : ACTIVITY_KINDS.filter(kind => watched.includes(kind));
				this.#activityFresh = kinds.length === ACTIVITY_KINDS.length;
				await Promise.all([kinds.length > 0 && notices.check(kinds), watched.includes("gmail") && this.#readMail()]);
				this.#fireTriggers();
			},
			onPullTick: async () => {
				if (ownerLock.held) await this.#sourceControl.pull(this.#workspaceCwds());
			},
			onDashboardTick: () => notices.check(DASHBOARD_KINDS),
			// Only the owner stops idle processes and what a gone session left, so only it needs the sessions' idle clocks.
			onProcessTick: async () => {
				if (ownerLock.held) await this.#processWatch.tick();
			},
			onDailyTick: async () => {
				if (ownerLock.held) this.#pruneActivity();
			},
		});
		this.#requests = new RequestLedger(createClientHandler({
			sessions,
			views,
			start: startSession,
			lists,
			end: async instanceId => {
				const session = sessions.get(instanceId);
				if (session) await this.#endLive(session);
			},
			dismissInterrupted(sessionId) {
				if (interrupted.dismiss(sessionId)) broadcasts.pushPast();
			},
			renamePast: async (sessionId, title) => {
				const saved = files.savedOf(sessionId);
				if (!saved) throw new Error("This session's file is gone.");
				if (saved.source !== "omp") throw new Error("Only omp sessions can be renamed here.");
				await renameSessionFile(saved.path, title, saved.cwd);
				files.touch(saved.path);
				if (await files.refresh()) this.#onFilesChanged();
			},
			markRead(instanceId) {
				if (sessions.markRead(instanceId)) broadcasts.rosterChanged();
			},
			stoppedMidTurn: sessionId => interrupted.stoppedMidTurn(sessionId),
			cancelContinue: sessionId => autoContinue.cancel(sessionId),
			sendScheduledNow: id => scheduledRunner.sendNow(id),
			runRoutine: id => runner.runNow(id),
			messageBot: async (id, text) => void (await this.#bots.message(id, text)),
			changeNotices: (ids, op) => notices.apply(ids, op),
			dictation: this.#dictation,
			activity: { owner: () => ownerLock.held, store: this.#activity },
			}),
			(t, error) => console.error(`omp-agents: ${t} failed: ${errorText(error)}`),
		);
	}

	/** The HTTP API over this dashboard, admitted by `guards`; `build` is what the server serves. */
	routes(guards: Guards, build: ServedBuild): Routes {
		const files = this.#files;
		const sessions = this.#sessions;
		const broadcasts = this.#broadcasts;
		return createRoutes({
			guards,
			sessions: {
				knownWorkspaces: () => this.knownWorkspaces(),
				addedCwds: () => this.#workspaces.value.added,
				changeWorkspaces: change => void this.#lists.apply("workspaces", change),
				changeProjectTrust: change => void this.#lists.apply("project-trust", change),
				summaryOf(sessionId) {
					const saved = files.savedOf(sessionId);
					return saved && { file: saved.path, title: saved.title, workspace: files.facts.placement.cwdOf(saved.cwd) };
				},
				foreignUsage: () => this.#foreignUsage.read(),
				placeOf(sessionId) {
					const file = files.pathOf(sessionId);
					const saved = files.savedOf(sessionId);
					if (!file || !saved) return null;
					return { file, dir: files.factsOf(sessionId).worktree ?? sessions.bySessionId(sessionId)?.cwd ?? saved.cwd, changedPaths: () => files.facts.changedPathsOf(file) };
				},
				learnHeads(repo, pullRequests) {
					if (files.facts.learnHeads(repo, pullRequests)) broadcasts.pushAll();
				},
				searchConversations: query => files.searchConversations(query),
				sourceControl: () => this.#sourceControl.answer(this.#workspaceCwds()),
				changeSourceControl: change => {
					if (this.#sourceControl.apply(change) && change.op !== "clean-up" && this.#ownerLock.held) void this.#sourceControl.pull(this.#workspaceCwds());
				},
			},
			integrations: this.#integrations,
			calendar: {
				google: this.#google,
				setCalendarShown: (account, id, shown) => this.#calendars.apply(account, id, shown),
				localEvents: this.#localEvents,
			},
			gmail: this.#gmail,
			files: { worktrees: this.#worktrees, terminals: this.terminals, fileDirsOf: files.fileDirsOf },
			storage: this.#isolationSweep,
			todos: { list: () => this.#todos.value, change: change => void this.#lists.apply("user-todos", change) },
			pullRequests: {
				changeMergeQueue: async change => {
					const merged = await this.#mergeQueue.apply(change);
					return { merges: [...this.#mergeQueue.list], merged };
				},
				previewReviewDraft: pr => this.#reviewDrafts.preview(pr),
				postReviewDraft: (pr, submit) => this.#reviewDrafts.post(pr, submit),
				checkOutPullRequest: checkout => checkOutPullRequest(checkout, this.#startSession),
				rebasePullRequest,
			},
			dashboard: { build, status: () => this.#selfUpdate.status(), update: () => this.#selfUpdate.update(), changelog: () => this.#selfUpdate.changelog() },
			sync: this.#settingsSync,
			activity: this.#activity,
			processes: {
				list: () => this.#processWatch.list(),
				stop: ({ instanceId, id }) => this.#processWatch.stop(instanceId, id),
				startServer: async instanceId => {
					const session = this.#sessions.get(instanceId);
					if (!session) throw new Error("That session no longer runs.");
					return startDevServer(session.sessionId, this.#files.factsOf(session.sessionId).worktree ?? session.cwd, startOwnedService);
				},
				settings: () => {
					this.#processSettings.reload();
					return this.#processSettings.value;
				},
				changeSettings: settings => {
					this.#processSettings.apply(settings);
					return this.#processSettings.value;
				},
			},
			sportThumbs: { dir: sportThumbsDir, fetch: url => fetch(url) },
		});
	}

	/** Settles once {@link start} attached to the sessions the last server left running and learned which survived. */
	get reattached(): Promise<void> {
		return this.#reattached.promise;
	}

	/**
	 * Starts following omp: attaches to the sessions the last server left running, watches the session files and the
	 * inboxes, takes the owner lock when it is free, lists the files, checks for the sessions that stopped mid-turn, lists
	 * the registry, and starts the loops; `publisher` is the server now listening.
	 */
	async start(publisher: Publisher): Promise<void> {
		this.#publisher = publisher;
		mkdirSync(personalDir, { recursive: true });
		// Before the runners recover, so a session that survived counts as neither interrupted nor stopped with the server.
		await reattachAll(this.#sessions, request => this.#joinFor(request), instanceId => this.#privateSessions.has(instanceId), survived => this.#interrupted.recover(survived));
		// A private session whose omp exited while no server ran is deleted, as its exit would have; one this server could not attach to runs on.
		const kept = new Set(keptSessions());
		await this.#privateSessions.sweep(instanceId => kept.has(instanceId) || this.#sessions.get(instanceId) !== undefined);
		this.#reattached.resolve();
		this.#broadcasts.syncRoster();
		this.#loops.watch();
		if (!this.#claimUnattendedWork()) {
			const owner = this.#ownerLock.holder();
			console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the todo, note, and event inboxes; this one takes over when it exits.`);
		}
		for (const inbox of this.#inboxes) inbox.watch();
		this.#endInbox.watch();
		await this.#rescanFiles();
		// Once the files are listed, so the notice names the sessions that stopped mid-turn with the last server.
		await this.#notices.check(STOPPED_KINDS);
		const [calendarServer] = await findMcpServers(MCP_SERVICES["google-calendar"].host);
		if (calendarServer) this.#calendars.adopt(calendarServer.name);
		await this.#listRegistry();
		if (this.#ownerLock.held) {
			this.#clearOldDone();
			this.#pruneActivity();
		}
		this.#loops.start();
		this.#stopMergeQueue = repeat("merge queue", () => this.#mergeQueue.tick(), MERGE_QUEUE_TICK_MS, 0);
	}

	/**
	 * Stops everything that runs on its own first, so no tick publishes while the rest shuts down; then lets go of the
	 * sessions started here, which run on for the next server, hangs up on the shells, writes what the stores have not,
	 * and stops the routine commands still running.
	 */
	async stop(): Promise<void> {
		this.#loops.stop();
		this.#stopMergeQueue();
		for (const inbox of this.#inboxes) inbox.stop();
		this.#endInbox.stop();
		await this.#sessions.dispose();
		this.terminals.dispose();
		stopStats();
		this.#activity.close();
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
		if (this.#registry === "stale") void this.#listRegistry();
		if (!this.#activityFresh) void this.#checkActivity();
		void this.#usage.opened();
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
		this.#dictation.close(ws);
	}

	/** The workspaces sessions count in: live ones first, then saved ones newest first. */
	knownWorkspaces(): string[] {
		const live = this.#sessions.cwds().map(this.#files.facts.placement.cwdOf);
		return [...new Set([...live, ...this.#files.workspaces()].filter(Boolean))];
	}

	#workspaceCwds(): string[] {
		const { added, hidden } = this.#workspaces.value;
		return [...new Set([...this.knownWorkspaces(), ...added])].filter(cwd => !hidden.includes(cwd));
	}

	/** Where every live session's update goes: the views, the broadcasts, the Bots, and the loops. */
	#onLiveUpdate(instanceId: string, update: SessionUpdate): void {
		switch (update.kind) {
			case "roster":
				this.#broadcasts.rosterChanged();
				return;
			case "event":
				this.#views.applyEvent(instanceId, update.event);
				this.#moves.heard(instanceId, update.event);
				if (this.#sessions.heard(instanceId, update.event)) this.#broadcasts.rosterChanged();
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
				const isPrivate = this.#sessions.started(instanceId)?.private === true;
				this.#reviewDrafts.exited(instanceId);
				this.#moves.exited(instanceId);
				// Its last turn may have remembered something.
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				this.#bots.exited(instanceId);
				this.#personalTurnEnded(instanceId);
				this.#sessions.remove(instanceId);
				// A private session lives exactly as long as its omp, so it is deleted rather than interrupted; the next server's sweep finishes a purge cut short.
				if (isPrivate) void this.#privateSessions.purge(instanceId).catch((err: unknown) => console.error(`omp-agents: deleting private session ${instanceId} failed: ${errorText(err)}`));
				else if (sessionId && !update.ended) this.#interrupted.interrupt(sessionId);
				this.#broadcasts.syncRoster();
				void this.#loops.listNow();
				return;
			}
			case "written":
				this.#loops.fileChanged(update.path);
				return;
			case "switched": {
				// Before the edited prompt's events, so they land in the new file's transcript.
				this.#views.sync();
				this.#broadcasts.syncRoster();
				const sessionId = this.#sessions.get(instanceId)?.sessionId;
				if (sessionId) {
					this.#reviewDrafts.switched(instanceId, sessionId);
					this.#bots.switched(instanceId, sessionId);
				}
				return;
			}
			case "turn-started": {
				if (this.#sessions.turnStarted(instanceId)) this.#broadcasts.rosterChanged();
				// Whoever prompted, the session works again; its own continue, already claimed, stays.
				const sessionId = this.#sessions.get(instanceId)?.sessionId;
				if (sessionId) this.#autoContinue.turnStarted(sessionId);
				// Its row moves up with the prompt that started the turn.
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				return;
			}
			case "turn-ended": {
				// A quiet turn, such as a Bot's routine run that found nothing, leaves the session as unread as before it.
				this.#sessions.turnEnded(instanceId, update.quiet ? null : { at: Date.now(), reply: update.reply });
				// A session started here that a usage limit or a transient fault stopped is held for its continue.
				const sessionId = this.#sessions.started(instanceId)?.sessionId;
				if (sessionId) this.#autoContinue.turnEnded(sessionId, update.failure);
				this.#broadcasts.rosterChanged();
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				this.#personalTurnEnded(instanceId);
				return;
			}
			default: {
				const unhandled: never = update;
				return unhandled;
			}
		}
	}

	/** Tells the page the personal memory may have changed when session `instanceId`, which ended a turn, runs in the personal directory. */
	#personalTurnEnded(instanceId: string): void {
		if (isPersonalDir(this.#sessions.get(instanceId)?.cwd)) this.#broadcasts.pushList("personal");
	}

	/** Moves todos checked over {@link DONE_KEPT_HOURS} ago to the archive. */
	#clearOldDone(): void {
		this.#lists.apply("user-todos", { op: "clear-done", categoryId: null, before: new Date(Date.now() - DONE_KEPT_HOURS * 3_600_000).toISOString() });
	}

	/** Deletes the activity rows older than {@link ACTIVITY_KEPT_DAYS}. */
	#pruneActivity(): void {
		this.#activity.prune(Date.now() - ACTIVITY_KEPT_DAYS * DAY_MS);
	}

	/** How `request` joins the server: as a Review session, as a Bot's conversation, both, or plain; any but a Bot's loads the personal extension, and any but a Bot's or a personal session can move itself. */
	#joinFor(request: StartRequest): SessionJoin {
		const joins = [this.#reviewDrafts.join(request), this.#bots.join(request), this.#moves.join(request), this.#personalJoin(request)];
		return {
			rpc: { args: joins.flatMap(join => join.rpc.args), tools: joins.flatMap(join => join.rpc.tools) },
			attach: session => {
				for (const join of joins) join.attach(session);
			},
		};
	}

	/** The directory `request`'s session starts in, `undefined` when the session it continues is gone. */
	#cwdOf(request: StartRequest): string | undefined {
		if (request.kind === "new") return request.cwd;
		if (request.kind === "resume") return this.#files.savedOf(request.sessionId)?.cwd;
		return request.view.kind === "live" ? this.#sessions.get(request.view.instanceId)?.cwd : this.#files.savedOf(request.view.sessionId)?.cwd;
	}

	/**
	 * Ends `session` as **End session** does, then removes the linked worktree it worked in: the one its bash calls last ran in, else its own directory's.
	 * The continue it waits on goes with it.
	 */
	async #endLive(session: LiveSession): Promise<void> {
		const { sessionId } = session;
		await endSession({ sessionId, workDir: this.#files.factsOf(sessionId).worktree ?? session.cwd, end: () => session.end() }, dir => this.#worktrees.removeCheckout(dir, `ended session ${sessionId}`));
		this.#autoContinue.cancel(sessionId);
	}

	/**
	 * Takes over routines and the todo, note, and event inboxes when no other server runs them, at start or on the minute
	 * tick after the server that ran them is gone, with the same steps either way; whether this server runs them. Losing
	 * them needs no step: every owner action checks the lock as it runs.
	 */
	#claimUnattendedWork(): boolean {
		const was = this.#ownerLock.held;
		const owns = this.#ownerLock.acquire();
		if (owns && !was) {
			console.log("omp-agents: this server now runs routines and the todo, note, and event inboxes.");
			// What the server that ran them saved since this one started.
			this.#routines.reload();
			this.#bots.reload();
			this.#migrateRoutines();
			this.#todos.reload();
			this.#notes.reload();
			this.#localEvents.reload();
			this.#broadcasts.pushList("routines");
			this.#broadcasts.pushList("bots");
			this.#broadcasts.pushList("user-todos");
			this.#broadcasts.pushList("user-notes");
			this.#runner.recover();
			this.#scheduledRunner.recover();
			for (const inbox of this.#inboxes) void inbox.drain();
			// It learned what the triggers see while another server ran routines, which that server fired.
			this.#triggerWatch.forget();
		}
		return owns;
	}

	/**
	 * Moves the routines of a file from before every routine had a Bot to their Bots, creating each Bot they need unless it
	 * exists. Only the server that runs routines saves the move, so another, such as a smoke run, never rewrites the files
	 * an older owner still reads; any server reads the routines moved, in memory.
	 */
	#migrateRoutines(): void {
		this.#routines.migrate(bot => {
			if (!this.#botsFile.value.some(({ id }) => id === bot.id)) this.#lists.apply("bots", { op: "save", bot });
		});
	}

	/** Starts the runs of the routines whose triggers the last check saw news for, on the server that runs routines; another server drops the news. */
	#fireTriggers(): void {
		const news = this.#triggerWatch.take();
		if (news.length > 0 && this.#ownerLock.held) void this.#runner.fire(news).catch((err: unknown) => console.error(`omp-agents: a triggered routine failed to start: ${errorText(err)}`));
	}

	/** Checks the pull requests and Slack for the bell and the routines' triggers. */
	async #checkActivity(): Promise<void> {
		this.#activityFresh = true;
		await this.#notices.check(ACTIVITY_KINDS);
		this.#fireTriggers();
	}

	/** Reads the Gmail inboxes for the routines' Gmail triggers; when every account fails, the watch keeps what it knew. */
	async #readMail(): Promise<void> {
		const answer = await this.#gmail.inbox().catch(() => null);
		if (answer) this.#triggerWatch.learn(gmailSightings(answer));
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
		this.#registry = "fresh";
		const joinedOrLeft = this.#sessions.follow(hosts);
		// Only a listing that worked knows which terminal sessions still run.
		if (this.#rosterError === null) this.#sessions.restoreListedUnread(hosts, this.#files.pathOf);
		// A terminal session that asked to end before the registry listed it.
		void this.#endInbox.drain();
		// Every listing can change a host's row or the registry error; only a session that joins or leaves changes the past list.
		this.#broadcasts.pushRoster();
		if (joinedOrLeft) this.#broadcasts.pushPast();
	}
}
