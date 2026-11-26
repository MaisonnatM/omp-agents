/**
 * The dashboard behind the server: the registries and stores, the live sessions and the views on them, and the loops and
 * inboxes that keep them current. It builds its parts in dependency order, each handed the parts above it.
 * Two edges point down, closing the only cycles: a live session's update reaches the views, the broadcasts, the Bots,
 * and the loops through its live-update handler, and a notice change reaches the broadcasts that read the notices.
 * No constructor calls either; nothing follows the registry, watches a directory, or publishes before {@link Dashboard.start}.
 */
import { join } from "node:path";
import type { Server } from "bun";
import { ForeignUsage } from "../foreign/usage";
import { flushJsonFiles } from "../fs";
import { mergedPullRequests } from "../pull-requests";
import { createIntegrations, type Integrations } from "../integrations";
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import { startDictation } from "../omp/dictation";
import { agentDir } from "../omp/config";
import { type HostSnapshot, listHosts } from "../omp/collab";
import { ompSandboxes } from "../omp/isolation";
import { keptSessions } from "../omp/rpc";
import { renameSessionFile } from "../omp/sessions";
import { listPrice, stopStats } from "../omp/stats";
import { activityDb, botInboxDir, botsDir, botsFile, endedWorktreesFile, HOME, interruptedFile, machineFile, noticesFile, oldWorkspacesFile, pinsFile, preferencesFile, privateSessionsDir, processesFile, projectTrustFile, pullRequestWatchesFile, reviewDraftsFile, routineInboxDir, routinesFile, scheduledFile, shepherdInboxDir, sessionEndInboxDir, serverLockFile, settingsSyncFile, settingsSyncRepo, sourceControlFile, workspaceFor, workspacesFile } from "../paths";
import { type ModuleChanges, type ModuleRun, isStoredModuleId, moduleJoins, openModules, type StoredModuleId } from "../modules";
import { listReviewComments, listReviews, postReview, readReviewTarget, viewerLogin } from "../pull-request-review";
import { worktreeAt } from "../git";
import type { ServedBuild } from "../served-build";
import { SourceControl } from "../source-control";
import { SettingsSync, syncStores, thisMachine } from "../settings-sync";
import { watchedKinds } from "../routines";
import { SESSION_FORMATS } from "../session-formats";
import type { ScheduledCheck, StartRequest, StartResult, View } from "../shared/sessions";
import { nextSendTo } from "../shared/scheduled";
import { inAppData } from "../shared/workspaces";
import { Terminals } from "../terminals";
import { Worktrees } from "../worktrees";
import { WorktreeOccupants } from "./worktree-occupants";
import { Bots, startingRoutine } from "./bots";
import { BotsFile } from "./bots-file";
import { Broadcasts } from "./broadcasts";
import { EndInbox } from "./end-inbox";
import type { Guards } from "./http";
import { InterruptedSessions } from "./interrupted";
import { IsolationSweep } from "./isolation-sweep";
import { ListRegistry } from "./list-registry";
import { LiveSessions, type SessionUpdate } from "./live-sessions";
import { liveUpdateHandler } from "./live-update";
import { Loops, repeat } from "./loops";
import type { MergeCleanup } from "./merge-cleanup";
import type { MergeQueue } from "./merge-queue";
import { ACTIVITY_KINDS, DASHBOARD_KINDS, HEALTH_KINDS, Notices, PROVIDER_KINDS, STOPPED_KINDS, UPDATE_KINDS } from "./notices";
import { noticeSources } from "./notice-sources";
import { OwnerLock } from "../../templates/omp/agent/extensions/github/owner-lock";
import { PinsFile } from "./pins-file";
import { PrivateSessions } from "./private-sessions";
import { PreferencesFile } from "./preferences-file";
import { ProcessSettingsFile } from "./process-settings-file";
import type { SessionProcessWatch } from "./session-processes";
import { sessionProcessWatch } from "./session-process-watch";
import { ReviewDrafts } from "./review-drafts";
import { ReviewDraftsFile } from "./review-drafts-file";
import type { RoutineRunner } from "./routine-runner";
import { TriggerWatch } from "./routine-triggers";
import { RoutinesFile } from "./routines-file";
import { ScheduledFile } from "./scheduled-file";
import type { AutoContinue } from "./auto-continue";
import type { ScheduledRunner } from "./scheduled-runner";
import type { Routes } from "./route-kit";
import type { PhoneAccessRoutesEnv } from "./phone-access-routes";
import { createRoutes } from "./routes";
import { dashboardRouteEnv } from "./dashboard-route-env";
import type { SelfUpdate } from "./self-update";
import { EndedWorktrees, endSession, restoreEndedWorktree } from "./session-end";
import { ProjectTrustFile } from "./project-trust-file";
import { SessionFollowUps } from "./session-follow-ups";
import { PullRequestWatches, PullRequestWatchesFile } from "./pull-request-watches";
import { SessionMoves } from "./session-moves";
import { SessionWaits } from "./session-waits";
import { SessionFiles } from "./session-files";
import { RequestLedger } from "./request-ledger";
import { ACTIVITY_KEPT_DAYS, ActivityStore } from "./activity-store";
import { DAY_MS } from "../shared/days";
import { Dictation } from "./dictation";
import { createClientHandler } from "./socket";
import { botExtension, designerExtension, shepherdExtension } from "./resources";
import { createStarter, reattachAll, type SessionJoin } from "./start";
import type { JsonInboxDir } from "./json-inbox";
import { unattendedWork } from "./unattended-work";
import { UsagePoll } from "./usage-poll";
import { type Socket, Views } from "./views";
import { parseClientMsg } from "./wire";
import { adoptOldWorkspaces, WorkspacesFile } from "./workspaces-file";

/** What the dashboard publishes through once the server listens. */
type Publisher = Pick<Server<unknown>, "publish" | "subscriberCount">;

/** How often the merge queue looks at the pull requests it waits on: checks take minutes, and a click shows its first step at once. */
const MERGE_QUEUE_TICK_MS = 15_000;

/** Everything the server serves, built once at startup; {@link Dashboard.start} sets it going and {@link Dashboard.stop} stops it. */
export class Dashboard {
	readonly #files = new SessionFiles();
	readonly #foreignUsage = new ForeignUsage(SESSION_FORMATS, listPrice);
	readonly #interrupted = new InterruptedSessions(interruptedFile, () => void this.#notices.check(STOPPED_KINDS));
	readonly #endedWorktrees = new EndedWorktrees(endedWorktreesFile);
	readonly #modules = openModules();
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
	readonly #onLiveUpdate: (instanceId: string, update: SessionUpdate) => void;
	readonly #takeOver: () => void;
	readonly #moves = new SessionMoves({
		session: instanceId => this.#sessions.started(instanceId),
		staysPut: request => this.#bots.botOf(request) !== null,
		admit: this.#admit,
	});
	readonly #waits = new SessionWaits({
		hosts: () => this.#sessions.rows(this.#files.factsOf),
		reply: sessionId => this.#sessions.lastReply(sessionId, this.#files.pathOf),
		isBot: request => this.#bots.botOf(request) !== null,
	});
	readonly #followUps = new SessionFollowUps({
		hosts: () => this.#sessions.rows(this.#files.factsOf),
		isBot: request => this.#bots.botOf(request) !== null,
		schedule: change => this.#lists.apply("scheduled", change),
		now: Date.now,
	});
	/** The pull requests sessions watch, which the activity check's list wakes them about; the constructor builds it once it can reach a session. */
	readonly #prWatches: PullRequestWatches;
	readonly #sourceControl = new SourceControl(sourceControlFile);
	readonly #settingsSync: SettingsSync;
	readonly #integrations: Integrations = createIntegrations();
	/** The terminal panel's shells, which the server's `/ws/terminal` upgrades open and attach to. */
	readonly terminals = new Terminals();
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	readonly #stopping = new AbortController();
	/** Which of the servers beside each other, such as a smoke run on another port, runs routines and the file inboxes. */
	readonly #ownerLock: OwnerLock;
	/** Whether this server may take the owner lock; a server an omp session started, such as a smoke run, never does. */
	readonly #unattended: boolean;
	readonly #sessions: LiveSessions;
	readonly #views: Views;
	readonly #notices: Notices;
	readonly #broadcasts: Broadcasts;
	readonly #lists: ListRegistry;
	/** The inboxes the owner applies, each a tool's changes to one of the dashboard's files. */
	readonly #inboxes: readonly JsonInboxDir<unknown>[];
	/** What the modules do on their own, such as the Board's auto-start, wake, and lease sweep, by module id. */
	#moduleRuns: ReadonlyMap<StoredModuleId, ModuleRun> = new Map();
	readonly #worktrees: Worktrees;
	/** omp's isolation sandboxes whose omp exited, removed once a day by the owner. */
	readonly #isolationSweep: IsolationSweep;
	/** What each live session runs besides omp, which it stops on request, when idle, and once the session left; it also ends sessions left idle for hours. */
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

	/**
	 * `selfUpdate` is **Update dashboard**, which pulls the checkout the server runs from and restarts the server.
	 * `unattended` is false for a server an omp session started, which then never runs routines, Bots, or the file inboxes.
	 */
	constructor(port: number, selfUpdate: SelfUpdate, unattended = true) {
		this.#selfUpdate = selfUpdate;
		this.#unattended = unattended;
		// An older version kept the workspace list in `projects.json`, so it moves first.
		adoptOldWorkspaces(oldWorkspacesFile, workspacesFile);
		const workspaces = (this.#workspaces = new WorkspacesFile(workspacesFile));
		// A sync, which runs only once the server listens, tells the pages that show a list it rewrote.
		const stores = syncStores(
			{ sourceControl: this.#sourceControl, preferences: this.#preferences, processes: this.#processSettings, workspaces, bots: this.#botsFile, botsDir, routines: this.#routines, machine: thisMachine(machineFile), projects: this.#modules.projects },
			HOME,
			list => {
				// Every Bot memory is read again, since a sync may have rewritten them.
				if (list === "bots") this.#bots.forgetRead();
				this.#broadcasts.pushList(list);
			},
		);
		this.#settingsSync = new SettingsSync(settingsSyncFile, settingsSyncRepo, { omp: agentDir, home: HOME, stores });
		const files = this.#files;
		const modules = this.#modules;
		const routines = this.#routines;
		const scheduled = this.#scheduled;
		const pins = this.#pins;
		const interrupted = this.#interrupted;
		const ownerLock = (this.#ownerLock = new OwnerLock(serverLockFile, port));
		const prWatchesFile = new PullRequestWatchesFile(pullRequestWatchesFile);
		const scheduledCheck = (sessionId: string): ScheduledCheck | null => {
			const at = nextSendTo(scheduled.value, sessionId);
			if (at !== null) return { kind: "send", at };
			const prs = prWatchesFile.value.filter(watch => watch.sessionId === sessionId).map(watch => ({ pr: watch.pr, checks: watch.seen?.checks ?? null }));
			return prs.length > 0 ? { kind: "pull-request", prs } : null;
		};
		const sessions = (this.#sessions = new LiveSessions((instanceId, update) => this.#onLiveUpdate(instanceId, update), undefined, undefined, scheduledCheck));
		const { placement } = files.facts;
		const { factsOf } = files;
		const pathFor = (view: View): string | null =>
			view.kind === "past" ? files.pathOf(view.sessionId) : sessions.transcriptPath(view.instanceId, view.agentId, files.pathOf);
		const views = (this.#views = new Views(
			pathFor,
			(topic, msg) => void this.#publisher?.publish(topic, JSON.stringify(msg)),
			instanceId => sessions.started(instanceId)?.starting ?? null,
		));
		const notices = (this.#notices = new Notices(
			noticesFile,
			noticeSources({
				selfUpdate,
				knownWorkspaces: () => this.knownWorkspaces(),
				hosts: () => sessions.rows(factsOf),
				triggerWatch: this.#triggerWatch,
				learnWatches: list => this.#prWatches.learn(list),
				pushRoster: () => this.#broadcasts.pushRoster(),
				usage: () => this.#usage,
				files,
				interrupted,
				routines,
			}),
			() => this.#broadcasts.pushList("notices"),
		));
		const lists = (this.#lists = new ListRegistry({
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
			jobs: { msg: () => ({ t: "jobs", jobs: this.#sessions.jobs() }) },
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
		}, modules, kind => {
			this.#broadcasts.pushList(kind);
			if (isStoredModuleId(kind)) this.#moduleRuns.get(kind)?.changed();
		}));
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
			onRosterChange: () => this.#waits.check(),
			saveRunning: () => interrupted.setRunning(sessions.startedHere()),
		}));
		this.#usage = new UsagePoll({ refresh: () => broadcasts.refreshUsage(), checkNotices: () => notices.check(PROVIDER_KINDS) });
		const workspaceOf = (cwd: string): Promise<string> => placement.workspaceOf(cwd, worktreeAt);
		// Applies a module change and writes it now, so an inbox file is deleted, and a new session's first turn reads it, only once it is on disk; a refused change throws.
		const applyModuleNow = <I extends StoredModuleId>(id: I, change: ModuleChanges[I]): boolean => {
			lists.applyModule(id, change);
			return modules[id].flush();
		};
		const starter = createStarter({
			sessions,
			pathFor,
			savedFile: files.pathOf,
			factsFor: factsOf,
			onStarted: () => broadcasts.syncRoster(),
			workspaceOf,
			joinProject: (projectId, sessionId) => applyModuleNow("projects", { op: "join", projectId, sessionId }),
			joinFor: (request, instanceId) => this.#joinFor(request, instanceId),
			admit: this.#admit,
			restoreWorktree: sessionIds => this.#worktrees.checkout(() => restoreEndedWorktree(this.#endedWorktrees.of(sessionIds))),
			privateSessions: this.#privateSessions,
			watcherOf: pr => this.#prWatches.watcherOf(pr),
		});
		const occupants = new WorktreeOccupants();
		const worktrees = (this.#worktrees = new Worktrees({
			knownCwds: () => this.knownWorkspaces(),
			activity: () => files.activity(),
			serverCwd: process.cwd(),
			mergedPullRequests,
			live: () => occupants.snapshot(sessions.rows(factsOf), (host, agentId) => sessions.transcriptPath(host.instanceId, agentId, files.pathOf)),
		}));
		this.#isolationSweep = new IsolationSweep({ ...ompSandboxes(), inUse: () => worktrees.inUse(), now: Date.now });
		this.#processWatch = sessionProcessWatch({
			sessions,
			hosts: () => sessions.rows(factsOf),
			pathOf: files.pathOf,
			bots: () => this.#bots,
			owner: () => ownerLock.held,
			processSettings: this.#processSettings,
		});
		const startSession = (this.#startSession = async request => {
			// Outside the checkout chain: resuming an owner restores its worktree through that chain.
			if (request.kind === "new")
				for (const sessionId of await starter.ownersOf(request)) {
					try {
						return await starter.followUp(await reach(sessionId), request);
					} catch (error) {
						// A watcher whose file is gone owns nothing; any other owner's failure is the answer, not a second session.
						if (sessions.bySessionId(sessionId) || files.pathOf(sessionId) !== null) return { ok: false, error: errorText(error) };
					}
				}
			return worktrees.start(() => starter(request), request.kind === "new" && request.branch !== null);
		});
		/** The live session that continues `sessionId`, else that session resumed; rejects when it does not resume. */
		const reach = async (sessionId: string): Promise<LiveSession> => {
			const live = sessions.bySessionId(sessionId);
			if (live) return live;
			const result = await worktrees.start(() => starter({ kind: "resume", sessionId }), false);
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
			paths: { extension: botExtension, botsFile, botInboxDir, botsDir, routinesFile, routineInboxDir, shepherdExtension, shepherdInboxDir, designerExtension, sessionArchiveDir: join(agentDir, "session-archive") },
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
		const work = unattendedWork({
			sessions,
			hosts: () => sessions.rows(factsOf),
			modules,
			applyModuleNow,
			lists,
			broadcasts,
			routines,
			scheduled,
			triggerWatch: this.#triggerWatch,
			botsFile: this.#botsFile,
			bots: this.#bots,
			sourceControl: this.#sourceControl,
			worktrees,
			usage: this.#usage,
			start: startSession,
			reach,
			endLive: session => this.#endLive(session),
			workspaceOf,
			knownWorkspaces: () => this.knownWorkspaces(),
			owner: () => ownerLock.held,
			admit: this.#admit,
			stopping: this.#stopping.signal,
		});
		const { runner, scheduledRunner, autoContinue } = work;
		this.#runner = runner;
		this.#scheduledRunner = scheduledRunner;
		this.#moduleRuns = work.moduleRuns;
		this.#takeOver = work.takeOver;
		this.#autoContinue = autoContinue;
		this.#mergeCleanup = work.mergeCleanup;
		this.#mergeQueue = work.mergeQueue;
		this.#inboxes = work.inboxes;
		this.#prWatches = new PullRequestWatches({
			file: prWatchesFile,
			hosts: () => sessions.rows(factsOf),
			isBot: request => this.#bots.botOf(request) !== null,
			wake: async (sessionId, text) => (await reach(sessionId)).prompt(null, text, [], "followUp"),
			active: () => ownerLock.held,
			now: Date.now,
		});
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
				await notices.check(STOPPED_KINDS);
				this.#fireTriggers();
				if (!this.#claimUnattendedWork()) return;
				// It reads every sandbox's checkout, which takes minutes, so the routines and sends after it do not wait for it.
				void this.#isolationSweep.tick();
				await scheduledRunner.tick();
				await runner.tick();
				await this.#mergeCleanup.tick();
				await this.#bots.stopIdle(Date.now());
			},
			onNoticeTick: () => notices.check(UPDATE_KINDS),
			onActivityTick: async () => {
				// The routines' triggers and the pull request watches read these checks, so the server that runs them checks without a page too, but only what they watch.
				const watched = ownerLock.held ? [...watchedKinds(routines.value), ...(this.#prWatches.watching() ? ["pull-request" as const] : [])] : [];
				const kinds = broadcasts.listening() ? ACTIVITY_KINDS : ACTIVITY_KINDS.filter(kind => watched.includes(kind));
				this.#activityFresh = kinds.length === ACTIVITY_KINDS.length;
				if (kinds.length > 0) await notices.check(kinds);
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
				if (!ownerLock.held) return;
				this.#pruneActivity();
				await notices.check(HEALTH_KINDS);
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
			restartBot: async id => {
				await this.#bots.restart(id);
				if (await files.refresh()) this.#onFilesChanged();
			},
			changeNotices: (ids, op) => notices.apply(ids, op),
			dictation: this.#dictation,
			owner: () => ownerLock.held,
			activity: this.#activity,
			}),
			(t, error) => console.error(`omp-agents: ${t} failed: ${errorText(error)}`),
		);
		this.#onLiveUpdate = liveUpdateHandler({
			sessions,
			views,
			moves: this.#moves,
			waits: this.#waits,
			broadcasts,
			reviewDrafts: this.#reviewDrafts,
			bots: this.#bots,
			privateSessions: this.#privateSessions,
			interrupted,
			loops: this.#loops,
			autoContinue,
			routines,
			pathOf: files.pathOf,
		});
	}

	/** The HTTP API over this dashboard, admitted by `guards`; `build` is what the server serves. */
	routes(guards: Guards, build: ServedBuild, phoneAccess: PhoneAccessRoutesEnv): Routes {
		return createRoutes(
			dashboardRouteEnv(
				{
					files: this.#files,
					sessions: this.#sessions,
					broadcasts: this.#broadcasts,
					lists: this.#lists,
					workspaces: this.#workspaces,
					foreignUsage: this.#foreignUsage,
					sourceControl: this.#sourceControl,
					ownerLock: this.#ownerLock,
					integrations: this.#integrations,
					worktrees: this.#worktrees,
					terminals: this.terminals,
					isolationSweep: this.#isolationSweep,
					mergeQueue: this.#mergeQueue,
					reviewDrafts: this.#reviewDrafts,
					startSession: this.#startSession,
					selfUpdate: this.#selfUpdate,
					settingsSync: this.#settingsSync,
					activity: this.#activity,
					processWatch: this.#processWatch,
					processSettings: this.#processSettings,
					knownWorkspaces: () => this.knownWorkspaces(),
					workspaceCwds: () => this.#workspaceCwds(),
				},
				guards,
				build,
				phoneAccess,
			),
		);
	}

	/** Settles once {@link start} attached to the sessions the last server left running and learned which survived. */
	get reattached(): Promise<void> {
		return this.#reattached.promise;
	}

	/**
	 * Starts following omp: attaches to the sessions the last server left running, watches the session files, lists the
	 * files, takes the owner lock when it is free, watches the inboxes, checks for the sessions that stopped mid-turn, lists
	 * the registry, and starts the loops; `publisher` is the server now listening.
	 */
	async start(publisher: Publisher): Promise<void> {
		this.#publisher = publisher;
		// Before the runners recover, so a session that survived counts as neither interrupted nor stopped with the server.
		await reattachAll(this.#sessions, (request, instanceId) => this.#joinFor(request, instanceId), instanceId => this.#privateSessions.has(instanceId), survived => this.#interrupted.recover(survived));
		// A private session whose omp exited while no server ran is deleted, as its exit would have; one this server could not attach to runs on.
		const kept = new Set(keptSessions());
		await this.#privateSessions.sweep(instanceId => kept.has(instanceId) || this.#sessions.get(instanceId) !== undefined);
		this.#reattached.resolve();
		this.#broadcasts.syncRoster();
		this.#loops.watch();
		// Before the owner lock, whose taking drains the inboxes.
		await this.#rescanFiles();
		if (!this.#unattended) console.log("omp-agents: an omp session started this server, so it never runs routines, Bots, or the file inboxes.");
		else if (!this.#claimUnattendedWork()) {
			const owner = this.#ownerLock.holder();
			console.log(`omp-agents: the server on port ${owner?.port ?? "?"} (pid ${owner?.pid ?? "?"}) runs routines and the file inboxes; this one takes over when it exits.`);
		}
		for (const inbox of this.#inboxes) inbox.watch();
		for (const run of this.#moduleRuns.values()) run.start();
		this.#endInbox.watch();
		// Once the files are listed, so the notice names the sessions that stopped mid-turn with the last server.
		await this.#notices.check(STOPPED_KINDS);
		await this.#listRegistry();
		if (this.#ownerLock.held) {
			this.#pruneActivity();
			// A restart starts the daily loop over, so the heartbeat runs now too; the runs it finds name its one notice, which a second look at them keeps.
			void this.#notices.check(HEALTH_KINDS);
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
		for (const run of this.#moduleRuns.values()) run.stop();
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
		const { placement } = this.#files.facts;
		const ran = [...this.#sessions.cwds(), ...this.#files.cwds()].filter(cwd => cwd && !placement.gone(cwd)).map(placement.cwdOf);
		return [...new Set(ran.filter(cwd => !inAppData(cwd)))];
	}

	#workspaceCwds(): string[] {
		const { added, hidden } = this.#workspaces.value;
		return [...new Set([...this.knownWorkspaces(), ...added])].filter(cwd => !hidden.includes(cwd));
	}

	/** Deletes the activity rows older than {@link ACTIVITY_KEPT_DAYS}. */
	#pruneActivity(): void {
		this.#activity.prune(Date.now() - ACTIVITY_KEPT_DAYS * DAY_MS);
	}

	/** How `request` joins the server as session `instanceId`: as a Review session, as a Bot's conversation, both, or plain; any loads what the modules the user left on join with, and any but a Bot's can wait on another session, move itself, and schedule follow-ups to itself. */
	#joinFor(request: StartRequest, instanceId: string): SessionJoin {
		const joins = [
			this.#reviewDrafts.join(request),
			this.#bots.join(request),
			this.#moves.join(request, instanceId),
			this.#waits.join(request, instanceId),
			this.#followUps.join(request, instanceId),
			this.#prWatches.join(request, instanceId),
			...moduleJoins(this.#preferences.value),
		];
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
		await endSession(
			{ sessionId, workDir: this.#files.factsOf(sessionId).worktree ?? session.cwd, end: () => session.end() },
			dir => this.#worktrees.removeCheckout(dir, `ended session ${sessionId}`),
			worktree => this.#endedWorktrees.record(sessionId, worktree),
		);
		this.#autoContinue.cancel(sessionId);
	}

	/**
	 * Takes over routines and the file inboxes when no other server runs them, at start or on the minute
	 * tick after the server that ran them is gone, with the same steps either way; whether this server runs them. Losing
	 * them needs no step: every owner action checks the lock as it runs.
	 */
	#claimUnattendedWork(): boolean {
		const was = this.#ownerLock.held;
		if (!this.#unattended) return false;
		const owns = this.#ownerLock.acquire();
		if (owns && !was) {
			console.log("omp-agents: this server now runs routines and the file inboxes.");
			this.#takeOver();
		}
		return owns;
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
		// Every listing reads the eval runs again, so their rows follow the harness that records them.
		await this.#sessions.refreshEvalRuns(this.#files.pathOf);
		// A terminal session that asked to end before the registry listed it.
		void this.#endInbox.drain();
		// Every listing can change a host's row or the registry error; only a session that joins or leaves changes the past list.
		this.#broadcasts.pushRoster();
		if (joinedOrLeft) this.#broadcasts.pushPast();
	}
}
