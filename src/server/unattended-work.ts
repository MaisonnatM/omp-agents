/**
 * The work that runs without a page: the routine and scheduled-send runners, the modules' runs, the continues, the merge
 * queue and the cleanup after a merge, and the file inboxes, each acting only on the server that holds the owner lock.
 */
import { randomUUID } from "node:crypto";
import { fullyAwake } from "../full-wake";
import type { LiveSession } from "../live-session";
import { type ModuleChanges, type ModuleFiles, type ModuleRun, moduleInboxes, moduleRuns, type StoredModuleId } from "../modules";
import { directoryOf } from "../paths";
import { runShell } from "../proc";
import { unapprovedChange } from "../pull-request-approval";
import { GITHUB_MERGES, readPullRequestStates } from "../pull-request-merge";
import { loadPullRequests, repoOf } from "../pull-requests";
import { worktreeAt } from "../git";
import { COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT } from "../routines";
import { agentOn } from "../shared/moves";
import { newSessionRequest, type RosterHost, type StartRequest, type StartResult } from "../shared/sessions";
import type { SourceControl } from "../source-control";
import type { Worktrees } from "../worktrees";
import { configAt } from "../../templates/omp/agent/extensions/land/gate";
import { AutoContinue, occupiedBy } from "./auto-continue";
import { BotInbox } from "./bot-inbox";
import type { Bots } from "./bots";
import type { BotsFile } from "./bots-file";
import type { Broadcasts } from "./broadcasts";
import type { JsonInboxDir } from "./json-inbox";
import type { ListRegistry } from "./list-registry";
import type { LiveSessions } from "./live-sessions";
import { MergeCleanup } from "./merge-cleanup";
import { MergeQueue } from "./merge-queue";
import { RoutineInbox } from "./routine-inbox";
import { RoutineRunner } from "./routine-runner";
import type { RoutinesFile } from "./routines-file";
import type { ScheduledFile } from "./scheduled-file";
import { ScheduledRunner } from "./scheduled-runner";
import { ShepherdInbox } from "./shepherd-inbox";
import type { UsagePoll } from "./usage-poll";
import { botInboxDir, builtInRoutinesFile, mergesFile, routineInboxDir, shepherdInboxDir } from "../paths";
import { addBuiltInRoutines } from "./built-in-routines";
import type { TriggerWatch } from "./routine-triggers";

/** The dashboard's parts the unattended work reads and acts through. */
export interface UnattendedWorkDeps {
	sessions: LiveSessions;
	hosts(): RosterHost[];
	modules: ModuleFiles;
	/** Applies a module change and writes it now; a refused change throws. */
	applyModuleNow<I extends StoredModuleId>(id: I, change: ModuleChanges[I]): boolean;
	lists: ListRegistry;
	broadcasts: Broadcasts;
	routines: RoutinesFile;
	scheduled: ScheduledFile;
	/** What the bell's checks saw last, which tells the routines' triggers what is new. */
	triggerWatch: TriggerWatch;
	botsFile: BotsFile;
	bots: Bots;
	sourceControl: SourceControl;
	worktrees: Worktrees;
	usage: UsagePoll;
	start(request: StartRequest): Promise<StartResult>;
	/** The live session that continues `sessionId`, else that session resumed; rejects when it does not resume. */
	reach(sessionId: string): Promise<LiveSession>;
	/** Ends a live session as **End session** does. */
	endLive(session: LiveSession): Promise<void>;
	workspaceOf(cwd: string): Promise<string>;
	knownWorkspaces(): string[];
	/** Whether this server holds the owner lock. */
	owner(): boolean;
	/** Aborts as the dashboard stops, which stops every routine command still running. */
	stopping: AbortSignal;
}

/** The unattended work's parts, which the dashboard starts, ticks, and stops. */
export interface UnattendedWork {
	runner: RoutineRunner;
	scheduledRunner: ScheduledRunner;
	moduleRuns: Map<StoredModuleId, ModuleRun>;
	autoContinue: AutoContinue;
	mergeCleanup: MergeCleanup;
	mergeQueue: MergeQueue;
	/** The inboxes the owner applies, each a tool's changes to one of the dashboard's files. */
	inboxes: JsonInboxDir<unknown>[];
	/** The steps of taking over routines and the file inboxes from the server that ran them. */
	takeOver(): void;
}

export function unattendedWork(deps: UnattendedWorkDeps): UnattendedWork {
	const { sessions, modules, applyModuleNow, lists, broadcasts, routines, scheduled, triggerWatch, botsFile, bots, worktrees, start: startSession, reach, owner: ownerHeld, stopping } = deps;
	/**
	 * Moves the routines of a file from before every routine had a Bot to their Bots, creating each Bot they need unless it
	 * exists. Only the server that runs routines saves the move, so another, such as a smoke run, never rewrites the files
	 * an older owner still reads; any server reads the routines moved, in memory.
	 */
	const migrateRoutines = (): void => {
		routines.migrate(bot => {
			if (!botsFile.value.some(({ id }) => id === bot.id)) lists.apply("bots", { op: "save", bot });
		});
	};
	/** Adds the built-in routines not added before, disabled, each with its Bot unless that Bot exists; only the server that runs routines adds them. */
	const addBuiltIns = (): void => {
		addBuiltInRoutines(builtInRoutinesFile, {
			hasBot: id => botsFile.value.some(bot => bot.id === id),
			routine: id => routines.value.find(routine => routine.id === id),
			saveBot: bot => lists.apply("bots", { op: "save", bot }),
			saveRoutine: routine => lists.apply("routines", { op: "save", routine }),
		});
	};
	const modulesInboxes = moduleInboxes(modules, applyModuleNow, { active: ownerHeld });
	const routineInbox = new RoutineInbox(routineInboxDir, () => routines.value, change => lists.apply("routines", change), { active: ownerHeld });
	const botInbox = new BotInbox(
		botInboxDir,
		{ bots: () => botsFile.value, save: change => lists.apply("bots", change), tell: (to, text) => bots.message(to, text), now: Date.now },
		{ active: ownerHeld },
	);
	const runner = new RoutineRunner({
		file: routines,
		now: Date.now,
		workspace: botId => botsFile.value.find(({ id }) => id === botId)?.cwd ?? null,
		async exec(command, cwd, env) {
			const dir = await directoryOf(cwd);
			if (!dir) throw new Error(`${cwd.trim()} is not a directory.`);
			return runShell(command, dir, { timeoutMs: COMMAND_TIMEOUT_MS, maxOutput: MAX_COMMAND_OUTPUT, signal: stopping, env });
		},
		fullyAwake,
		onChange: () => broadcasts.pushList("routines"),
		messageBot: (botId, text, fresh) => bots.message(botId, text, fresh),
	});
	const scheduledRunner = new ScheduledRunner({
		file: scheduled,
		start: startSession,
		reach,
		now: Date.now,
		onChange: () => broadcasts.pushList("scheduled"),
	});
	const runs = moduleRuns(modules, applyModuleNow, {
		async start(cwd, prompt, launch) {
			const result = await startSession(newSessionRequest(cwd, prompt, launch));
			if (!result.ok) return { error: result.error };
			const sessionId = sessions.get(result.instanceId)?.sessionId;
			return sessionId ? { sessionId } : { error: "The session exited as it started." };
		},
		async wake(sessionId, text, launch, interrupt = false) {
			const live = sessions.bySessionId(sessionId);
			const session = live ?? (await reach(sessionId));
			// The turn stops, and the user's own messages it held wait until `text` has run; a stopped session has no turn to stop.
			const withdrawn = interrupt && live ? await live.interrupt() : [];
			// Only a session this dashboard started switches models; one running in a terminal keeps its own.
			const owned = sessions.started(session.instanceId);
			if (launch?.model) await owned?.setModel(launch.model, launch.thinking);
			else if (launch?.thinking) await owned?.setThinking(launch.thinking);
			await session.prompt(null, launch?.skill ? `/skill:${launch.skill} ${text}` : text, [], "followUp");
			for (const message of withdrawn) await session.prompt(null, message.text, message.images, "followUp");
			return { resumed: !live };
		},
		working: sessionId => {
			const status = sessions.bySessionId(sessionId)?.row().status;
			return status !== undefined && status !== "idle";
		},
		owner: ownerHeld,
		now: Date.now,
	});
	const autoContinue = new AutoContinue({
		file: scheduled,
		plans: async () => {
			const { plans, error } = await deps.usage.fresh();
			if (error !== null) throw new Error(error);
			return plans;
		},
		now: Date.now,
		onChange: () => broadcasts.pushList("scheduled"),
	});
	// Only the server that holds the owner lock steps the queue and takes the minute tick's look, so only it ends sessions after a merge, and only the ones it started.
	const mergeCleanup = new MergeCleanup({
		sessions: () =>
			deps.hosts().flatMap(host =>
				sessions.started(host.instanceId) !== undefined && deps.sourceControl.cleanUp
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
			await deps.endLive(session);
		},
		deleteBranch: (gitDir, branch, head) => worktrees.deleteMergedBranch(gitDir, branch, head),
	});
	const mergeQueue = new MergeQueue({
		path: mergesFile,
		github: GITHUB_MERGES,
		now: Date.now,
		newId: randomUUID,
		active: ownerHeld,
		onChange: () => broadcasts.pushList("merges"),
		onMerged: pr => void mergeCleanup.merged(pr),
	});
	const shepherdInbox = new ShepherdInbox(
		shepherdInboxDir,
		{
			bots: () => botsFile.value,
			pullRequests: () => loadPullRequests(deps.knownWorkspaces(), true),
			agent: () => agentOn(deps.hosts()),
			start: startSession,
			queueMerge: change => mergeQueue.apply(change),
			unapprovedChange,
			landTarget: cwd => configAt(cwd)?.target ?? null,
			tell: (botId, text) => bots.message(botId, text),
		},
		{ active: ownerHeld },
	);
	const inboxes = [routineInbox, botInbox, shepherdInbox, ...modulesInboxes];
	const takeOver = (): void => {
		// What the server that ran them saved since this one started.
		routines.reload();
		bots.reload();
		migrateRoutines();
		addBuiltIns();
		broadcasts.pushList("routines");
		broadcasts.pushList("bots");
		runner.recover();
		scheduledRunner.recover();
		for (const inbox of inboxes) void inbox.drain();
		for (const run of runs.values()) run.changed();
		// It learned what the triggers see while another server ran routines, which that server fired.
		triggerWatch.forget();
	};
	return { runner, scheduledRunner, moduleRuns: runs, autoContinue, mergeCleanup, mergeQueue, inboxes, takeOver };
}
