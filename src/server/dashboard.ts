/**
 * The dashboard behind the server: the registries and stores, the live sessions and the views on them, and the loops and
 * inboxes that keep them current. It builds its parts in dependency order, each handed the parts above it.
 * Two edges point down, closing the only cycles: a live session's update reaches the views, the broadcasts, the Bots,
 * and the loops through its live-update handler, and a notice change reaches the broadcasts that read the notices.
 * No constructor calls either; nothing follows the registry, watches a directory, or publishes before {@link Dashboard.start}.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { Server } from "bun";
import { ForeignUsage } from "../foreign/usage";
import { flushJsonFiles } from "../fs";
import { GmailAccounts, GmailClient } from "../gmail";
import { accountClients, createGoogleAccounts } from "../google-accounts";
import { GoogleCalendarClient, GoogleCalendars } from "../google-calendar";
import { loadPullRequests, mergedPullRequests, repoOf } from "../pull-requests";
import { createIntegrations, type Integrations, integrationFetch, integrationSignedIn } from "../integrations";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { answerDiscussion } from "../omp/discussion";
import { agentDir } from "../omp/config";
import { type HostSnapshot, listHosts } from "../omp/collab";
import { findMcpServers } from "../omp/mcp";
import { ompDaemons } from "../omp/daemons";
import { ompSandboxes } from "../omp/isolation";
import { installedOmp, latestOmp, updateOmp } from "../omp/release";
import { renameSessionFile } from "../omp/sessions";
import { listPrice, readCreditRuns, stopStats } from "../omp/stats";
import { activityDb, botInboxDir, botsDir, botsFile, calendarsFile, directoryOf, displayPath, googleAccountsFile, HOME, interruptedFile, localEventsFile, mergesFile, noticesFile, oldGoogleFile, oldWorkspacesFile, pinsFile, preferencesFile, processesFile, reviewDraftsFile, routineInboxDir, routinesFile, scheduledFile, sessionEndInboxDir, serverLockFile, settingsSyncFile, settingsSyncRepo, sourceControlFile, userNoteInboxDir, userNotesFile, userTodoInboxDir, userTodosFile, workspacesFile } from "../paths";
import { listReviewComments, listReviews, postReview, readReviewTarget, viewerLogin } from "../pull-request-review";
import { GITHUB_MERGES, readPullRequestStates } from "../pull-request-merge";
import { checkOutPullRequest } from "../pull-request-checkout";
import { rebasePullRequest } from "../pull-request-rebase";
import { replayComparison, replayDetail } from "../replay";
import { canonical, worktreeAt } from "../git";
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
import { Bots } from "./bots";
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
import { ACTIVITY_KINDS, DASHBOARD_KINDS, EVENT_KINDS, Notices, PROVIDER_KINDS, STOPPED_KINDS, UPDATE_KINDS } from "./notices";
import { OwnerLock } from "../../templates/omp/agent/extensions/github/owner-lock";
import { PinsFile } from "./pins-file";
import { PreferencesFile } from "./preferences-file";
import { ProcessSettingsFile } from "./process-settings-file";
import { readProcessTable, SessionProcessWatch, stopProcesses } from "./session-processes";
import { ReviewDrafts } from "./review-drafts";
import { ReviewDraftsFile } from "./review-drafts-file";
import { RoutineRunner } from "./routine-runner";
import { eventSightings, gmailSightings, pullRequestSightings, SLACK_SCOPE, slackSightings, TriggerWatch } from "./routine-triggers";
import { RoutineInbox } from "./routine-inbox";
import { RoutinesFile } from "./routines-file";
import { ScheduledFile } from "./scheduled-file";
import { AutoContinue, occupiedBy } from "./auto-continue";
import { ScheduledRunner } from "./scheduled-runner";
import { createRoutes, type Routes } from "./routes";
import type { SelfUpdate } from "./self-update";
import { endSession } from "./session-end";
import { SessionFiles } from "./session-files";
import { RequestLedger } from "./request-ledger";
import { ACTIVITY_KEPT_DAYS, ActivityStore } from "./activity-store";
import { DAY_MS } from "../shared/days";
import { Discussions } from "./discussions";
import { createClientHandler } from "./socket";
import { botExtension } from "./resources";
import { createStarter, reattachAll, type SessionJoin } from "./start";
import { NoteInbox } from "./note-inbox";
import { TodoInbox } from "./todo-inbox";
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
	readonly #routines = new RoutinesFile(routinesFile);
	readonly #scheduled = new ScheduledFile(scheduledFile);
	readonly #workspaces: WorkspacesFile;
	readonly #pins = new PinsFile(pinsFile);
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
	readonly #sourceControl = new SourceControl(sourceControlFile);
	readonly #settingsSync: SettingsSync;
	readonly #calendars = new CalendarsFile(calendarsFile);
	readonly #integrations: Integrations = createIntegrations(createGoogleAccounts(new GoogleAccountsFile(googleAccountsFile)));
	readonly #localEvents = new LocalEventsFile(localEventsFile);
	/** The terminal panel's shells, which the server's `/ws/terminal` upgrades open and attach to. */
	readonly terminals = new Terminals();
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	readonly #stopping = new AbortController();
	/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the todo and note inboxes. */
	readonly #ownerLock: OwnerLock;
	readonly #google: GoogleCalendars;
	readonly #gmail = new GmailAccounts(accountClients("gmail", (fetch, account) => new GmailClient(fetch, account)));
	readonly #sessions: LiveSessions;
	readonly #views: Views;
	readonly #pathFor: (view: View) => string | null;
	readonly #notices: Notices;
	readonly #broadcasts: Broadcasts;
	readonly #lists: ListRegistry;
	readonly #todoInbox: TodoInbox;
	readonly #noteInbox: NoteInbox;
	readonly #routineInbox: RoutineInbox;
	readonly #botInbox: BotInbox;
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
	readonly #discussions = new Discussions(answerDiscussion);
	readonly #activity = new ActivityStore(activityDb);
	readonly #selfUpdate: SelfUpdate;
	/** The server, from {@link start} on; until then there is no socket to publish to. */
	#publisher: Publisher | null = null;
	/** Why the last registry listing failed, shown with the roster. */
	#rosterError: string | null = null;
	/** Whether the registry was listed since the last poll tick found no listener. */
	#registryFresh = false;
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
				dashboardCommits: () => selfUpdate.newCommits(),
				updateDashboard: () => selfUpdate.update(),
				pullRequests: async () => {
					const list = await loadPullRequests(this.knownCwds(), false);
					const agent = agentOn(sessions.rows(files.factsOf));
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
					const events = this.#localEvents.value.flatMap(({ id, title, when }) =>
						when.allDay ? [] : [{ ref: `local/${id}`, title, start: when.start, end: when.end, calendar: null, color: null, url: null }],
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
										when.allDay ? [] : [{ ref: `google/${account}/${calendarId}/${eventId}`, title, start: when.start, end: when.end, calendar, color, url }],
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
				now: Date.now,
			},
			() => this.#broadcasts.pushList("notices"),
		));
		const lists = (this.#lists = new ListRegistry({
			"user-todos": { msg: () => ({ t: "user-todos", list: todos.value }), apply: change => todos.apply(change) },
			"user-notes": { msg: () => ({ t: "user-notes", list: notes.value }), apply: change => notes.apply(change) },
			// Every routine belongs to a Bot, so a save for a Bot that is gone saves nothing.
			routines: {
				msg: () => ({ t: "routines", routines: routines.value }),
				apply: change => (change.op === "save" && !this.#botsFile.value.some(({ id }) => id === change.routine.botId) ? false : routines.apply(change, Date.now())),
			},
			scheduled: { msg: () => ({ t: "scheduled", sends: scheduled.value }), apply: change => scheduled.apply(change, Date.now()) },
			workspaces: {
				msg: () => {
					const [added, hidden] = [workspaces.value.added, workspaces.value.hidden].map(cwds => cwds.map(cwd => ({ cwd, cwdDisplay: displayPath(cwd) })));
					return { t: "workspaces", list: { added, hidden } };
				},
				apply: change => workspaces.apply(change),
			},
			pins: { msg: () => ({ t: "pins", sessionIds: pins.value }), apply: change => pins.apply(change) },
			preferences: { msg: () => ({ t: "preferences", values: this.#preferences.value }), apply: change => this.#preferences.apply(change) },
			notices: { msg: () => ({ t: "notices", list: notices.list }) },
			merges: { msg: () => ({ t: "merges", list: [...this.#mergeQueue.list] }) },
			"review-drafts": { msg: () => ({ t: "review-drafts", list: this.#reviewDrafts.list }), apply: edit => this.#reviewDrafts.edit(edit) },
			bots: {
				msg: () => this.#bots.msg(),
				apply: change => {
					// Deleting a Bot deletes its routines, first, so a crash between the two saves leaves no routine without its Bot.
					if (change.op === "remove" && routines.removeBot(change.id)) this.#broadcasts.pushList("routines");
					return this.#botsFile.apply(change, new Date().toISOString());
				},
			},
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
		this.#usage = new UsagePoll({ refresh: () => broadcasts.refreshUsage(), checkNotices: () => notices.check(PROVIDER_KINDS) });
		this.#todoInbox = new TodoInbox(userTodoInboxDir, change => lists.apply("user-todos", change), { active: () => ownerLock.held });
		this.#noteInbox = new NoteInbox(userNoteInboxDir, change => lists.apply("user-notes", change), { active: () => ownerLock.held });
		this.#routineInbox = new RoutineInbox(routineInboxDir, () => routines.value, change => lists.apply("routines", change), { active: () => ownerLock.held });
		this.#botInbox = new BotInbox(botInboxDir, () => this.#botsFile.value, change => lists.apply("bots", change), { active: () => ownerLock.held });
		const starter = createStarter({
			sessions,
			pathFor,
			savedFile: files.pathOf,
			factsFor: files.factsOf,
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
			joinFor: request => this.#joinFor(request),
		});
		const occupants = new WorktreeOccupants();
		const worktrees = (this.#worktrees = new Worktrees({
			knownCwds: () => this.knownCwds(),
			activity: () => files.activity(),
			serverCwd: process.cwd(),
			mergedPullRequests,
			live: () => occupants.snapshot(sessions.rows(files.factsOf), (host, agentId) => sessions.get(host.instanceId)?.transcriptPath(agentId, files.pathOf) ?? null),
		}));
		this.#isolationSweep = new IsolationSweep({ ...ompSandboxes(), inUse: () => worktrees.inUse(), now: Date.now });
		this.#processWatch = new SessionProcessWatch({
			...ompDaemons(),
			readTable: readProcessTable,
			stopProcesses,
			sessions: () => sessions.rows(files.factsOf),
			now: Date.now,
			owner: () => ownerLock.held,
			stopIdleAfterMinutes: () => {
				this.#processSettings.reload();
				return this.#processSettings.value.stopIdleAfterMinutes;
			},
		});
		const startSession = (this.#startSession = request => worktrees.start(() => starter(request), request.kind === "replay" || request.kind === "new" && request.branch !== null));
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
			paths: { extension: botExtension, botsFile, botInboxDir, botsDir, routinesFile, routineInboxDir },
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
				sessions.rows(files.factsOf).flatMap(host =>
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
			onUsageTick: () => this.#usage.tick(broadcasts.listening()),
			onMinuteTick: async () => {
				// Every server shows the sends, and the one that owns the unattended work sends them and saves what it did.
				scheduled.reload();
				broadcasts.pushList("scheduled");
				await notices.check([...EVENT_KINDS, ...STOPPED_KINDS]);
				this.#fireTriggers();
				if (!this.#claimUnattendedWork()) return;
				this.#clearOldDone();
				// It reads every sandbox's checkout, which takes minutes, so the routines and sends after it do not wait for it.
				void this.#isolationSweep.tick();
				await scheduledRunner.tick();
				await runner.tick();
				await this.#mergeCleanup.tick();
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
				await renameSessionFile(saved.path, title);
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
			discussions: this.#discussions,
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
			files: { worktrees: this.#worktrees, terminals: this.terminals },
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
				settings: () => {
					this.#processSettings.reload();
					return this.#processSettings.value;
				},
				changeSettings: settings => {
					this.#processSettings.apply(settings);
					return this.#processSettings.value;
				},
			},
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
		// Before the runners recover, so a session that survived counts as neither interrupted nor stopped with the server.
		await reattachAll(this.#sessions, request => this.#joinFor(request), survived => this.#interrupted.recover(survived));
		this.#reattached.resolve();
		this.#broadcasts.syncRoster();
		this.#loops.watch();
		if (this.#ownerLock.acquire()) {
			this.#migrateRoutines();
			this.#runner.recover();
			this.#scheduledRunner.recover();
		} else {
			const owner = this.#ownerLock.holder();
			console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the todo and note inboxes; this one takes over when it exits.`);
		}
		this.#todoInbox.watch();
		this.#noteInbox.watch();
		this.#routineInbox.watch();
		this.#botInbox.watch();
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
		this.#todoInbox.stop();
		this.#noteInbox.stop();
		this.#routineInbox.stop();
		this.#botInbox.stop();
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
		if (!this.#registryFresh) void this.#listRegistry();
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
		this.#discussions.close(ws);
	}

	/** Directories sessions ran in: live ones first, then saved ones newest first. */
	knownCwds(): string[] {
		return [...new Set([...this.#sessions.cwds(), ...this.#files.cwds()].filter(Boolean))];
	}

	#workspaceCwds(): string[] {
		const { added, hidden } = this.#workspaces.value;
		return [...new Set([...this.knownCwds(), ...added])].filter(cwd => !hidden.includes(cwd));
	}

	/** Where every live session's update goes: the views, the broadcasts, the Bots, and the loops. */
	#onLiveUpdate(instanceId: string, update: SessionUpdate): void {
		switch (update.kind) {
			case "roster":
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
				this.#reviewDrafts.exited(instanceId);
				// Its last turn may have remembered something.
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				this.#bots.exited(instanceId);
				this.#sessions.remove(instanceId);
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
				if (this.#sessions.markRead(instanceId)) this.#broadcasts.rosterChanged();
				// Whoever prompted, the session works again; its own continue, already claimed, stays.
				const sessionId = this.#sessions.get(instanceId)?.sessionId;
				if (sessionId) this.#autoContinue.turnStarted(sessionId);
				// Its row moves up with the prompt that started the turn.
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				return;
			}
			case "turn-ended": {
				this.#sessions.markUnread(instanceId, update.reply);
				// A session started here that a usage limit or a transient fault stopped is held for its continue.
				const sessionId = this.#sessions.started(instanceId)?.sessionId;
				if (sessionId) this.#autoContinue.turnEnded(sessionId, update.failure);
				this.#broadcasts.rosterChanged();
				if (this.#bots.changed(instanceId)) this.#broadcasts.pushList("bots");
				return;
			}
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

	/** Deletes the activity rows older than {@link ACTIVITY_KEPT_DAYS}. */
	#pruneActivity(): void {
		this.#activity.prune(Date.now() - ACTIVITY_KEPT_DAYS * DAY_MS);
	}

	/** How `request` joins the server: as a Review session, as a Bot's conversation, both, or plain. */
	#joinFor(request: StartRequest): SessionJoin {
		const joins = [this.#reviewDrafts.join(request), this.#bots.join(request)];
		return {
			rpc: { args: joins.flatMap(join => join.rpc.args), tools: joins.flatMap(join => join.rpc.tools) },
			attach: session => {
				for (const join of joins) join.attach(session);
			},
		};
	}

	/**
	 * Ends `session` as **End session** does, then removes the linked worktree it worked in: the one its bash calls last ran in, else its own directory's.
	 * The continue it waits on goes with it.
	 */
	async #endLive(session: LiveSession): Promise<void> {
		const { sessionId } = session;
		await endSession({ sessionId, workDir: this.#files.factsOf(sessionId).worktree ?? session.cwd, end: () => session.end() }, dir => this.#worktrees.removeCheckout(dir));
		this.#autoContinue.cancel(sessionId);
	}

	/** Takes over routines and the todo and note inboxes when the server that ran them is gone; whether this server runs them. */
	#claimUnattendedWork(): boolean {
		const was = this.#ownerLock.held;
		const owns = this.#ownerLock.acquire();
		if (owns && !was) {
			console.log("omp-agents: this server now runs routines and the todo and note inboxes.");
			// What the server that ran them saved since this one started.
			this.#routines.reload();
			this.#bots.reload();
			this.#migrateRoutines();
			this.#todos.reload();
			this.#notes.reload();
			this.#broadcasts.pushList("routines");
			this.#broadcasts.pushList("bots");
			this.#broadcasts.pushList("user-todos");
			this.#broadcasts.pushList("user-notes");
			this.#runner.recover();
			this.#scheduledRunner.recover();
			void this.#todoInbox.drain();
			void this.#noteInbox.drain();
			void this.#routineInbox.drain();
			void this.#botInbox.drain();
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
		this.#registryFresh = true;
		const joinedOrLeft = this.#sessions.follow(hosts);
		// A terminal session that asked to end before the registry listed it.
		void this.#endInbox.drain();
		// Every listing can change a host's row or the registry error; only a session that joins or leaves changes the past list.
		this.#broadcasts.pushRoster();
		if (joinedOrLeft) this.#broadcasts.pushPast();
	}
}
